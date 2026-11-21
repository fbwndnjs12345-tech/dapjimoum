import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.117.3';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });


function hasVerifiedServiceRole(token: string): boolean {
  // Edge gateway validates the JWT signature while verify_jwt is enabled.
  // Decode only the verified role claim to identify internal service-role requests.
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  try {
    const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
    const payload = JSON.parse(atob(padded)) as { role?: string };
    return payload.role === 'service_role';
  } catch {
    return false;
  }
}

function readKey(legacyName: string, keySetName: string): string | undefined {
  const legacy = Deno.env.get(legacyName);
  if (legacy) return legacy;
  try {
    const set = JSON.parse(Deno.env.get(keySetName) ?? '{}') as Record<string, string>;
    return set.default ?? Object.values(set)[0];
  } catch { return undefined; }
}

function isPublicIPv4(value: string): boolean {
  const parts = value.split('.').map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b, c] = parts;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)))) return false;
  if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

function isPublicIPv6(value: string): boolean {
  const address = value.split('%')[0].toLowerCase();
  if (address.includes('.')) return false;
  const sections = address.split('::');
  if (sections.length > 2) return false;
  const left = sections[0] ? sections[0].split(':') : [];
  const right = sections.length === 2 && sections[1] ? sections[1].split(':') : [];
  const missing = 8 - left.length - right.length;
  const groups = sections.length === 2
    ? [...left, ...Array(Math.max(0, missing)).fill('0'), ...right]
    : left;
  if (groups.length !== 8 || groups.some(group => !/^[0-9a-f]{1,4}$/.test(group))) return false;
  const first = parseInt(groups[0], 16);
  const second = parseInt(groups[1], 16);
  return first >= 0x2000 && first <= 0x3fff
    && first !== 0x2002
    && !(first === 0x2001 && (second === 0x0db8 || second <= 0x0020));
}

async function safeExternalUrl(value: string): Promise<boolean> {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return false;
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')
        || host.endsWith('.internal') || host.endsWith('.test') || host.endsWith('.invalid')
        || host.endsWith('.example') || host.endsWith('.onion')) return false;
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':')) return false;
    const [ipv4, ipv6] = await Promise.all([
      Deno.resolveDns(host, 'A').catch(() => [] as string[]),
      Deno.resolveDns(host, 'AAAA').catch(() => [] as string[]),
    ]);
    const addresses = [...ipv4, ...ipv6];
    return addresses.length > 0 && ipv4.every(isPublicIPv4) && ipv6.every(isPublicIPv6);
  } catch { return false; }
}

type SafeFetchResult = { response: Response; finalUrl: string; redirects: number };
async function fetchFollowingSafeRedirects(
  initialUrl: string,
  init: RequestInit,
  reserveSlot: () => Promise<void>,
  signal: AbortSignal,
  maxRedirects = 5,
): Promise<SafeFetchResult> {
  let current = initialUrl;
  for (let redirects = 0; redirects <= maxRedirects; redirects++) {
    if (!await safeExternalUrl(current)) throw new Error('리디렉션 대상이 안전한 공개 URL이 아닙니다.');
    await reserveSlot();
    const response = await fetch(current, { ...init, redirect: 'manual', signal });
    if (response.status < 300 || response.status >= 400) return { response, finalUrl: current, redirects };
    const location = response.headers.get('location');
    await response.body?.cancel().catch(() => undefined);
    if (!location) throw new Error('리디렉션 응답에 Location 헤더가 없습니다.');
    if (redirects === maxRedirects) throw new Error('안전한 리디렉션 최대 횟수(5회)를 초과했습니다.');
    current = new URL(location, current).toString();
  }
  throw new Error('리디렉션 처리에 실패했습니다.');
}

async function firstBytes(response: Response, count = 5): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < count) {
      const { value, done } = await reader.read();
      if (done || !value?.length) break;
      const part = value.slice(0, count - total);
      chunks.push(part);
      total += part.length;
    }
    const result = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
    return result;
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

function filenameFromResponse(response: Response, finalUrl: string): string | null {
  const disposition = response.headers.get('content-disposition') ?? '';
  const encoded = disposition.match(/filename\*\s*=\s*UTF-8''([^;]+)/i)?.[1];
  const plain = disposition.match(/filename\s*=\s*"?([^";]+)"?/i)?.[1];
  let filename = encoded ?? plain ?? '';
  try { filename = decodeURIComponent(filename.replace(/^["']|["']$/g, '')); } catch { /* Keep raw header value. */ }
  if (!filename) {
    try { filename = decodeURIComponent(new URL(finalUrl).pathname.split('/').pop() ?? ''); } catch { /* Ignore malformed path encoding. */ }
  }
  return filename ? filename.slice(0, 500) : null;
}

function normalizedFileText(value: string): string {
  return value.toLocaleLowerCase('ko-KR').replace(/[^가-힣a-z0-9]/g, '');
}

function assessFileName(book: Record<string, unknown> | undefined, filename: string | null) {
  if (!filename) return { status: 'unknown' as const, note: '다운로드 파일 이름을 확인하지 못했습니다.' };
  if (!book) return { status: 'uncertain' as const, note: '교재 메타데이터를 조회하지 못해 파일명 대조를 생략했습니다.' };
  const fileText = normalizedFileText(filename);
  const expected = [book.series, book.subject, book.grade, book.semester, book.edition, book.curriculum_revision]
    .map(value => String(value ?? '').trim()).filter(Boolean);
  const hits = expected.filter(value => fileText.includes(normalizedFileText(value)));
  const expectedGrade = String(book.grade ?? '').match(/중\s*([1-3])/);
  const actualGrades = [...filename.matchAll(/중\s*([1-3])/g)].map(match => match[1]);
  if (expectedGrade && actualGrades.length && !actualGrades.includes(expectedGrade[1])) {
    return { status: 'mismatch' as const, note: '파일명 학년이 교재 학년과 다릅니다.' };
  }
  const expectedSemester = String(book.semester ?? '').match(/([12])\s*학기/);
  const actualSemesters = [...filename.matchAll(/([12])\s*학기/g)].map(match => match[1]);
  if (expectedSemester && actualSemesters.length && !actualSemesters.includes(expectedSemester[1])) {
    return { status: 'mismatch' as const, note: '파일명 학기가 교재 학기와 다릅니다.' };
  }
  const expectedPair = String(book.title ?? '').match(/(?<![0-9])([1-3])\s*[-–]\s*([12])(?![0-9])/);
  const actualPair = filename.match(/(?<![0-9])([1-3])\s*[-–]\s*([12])(?![0-9])/);
  if (expectedPair && actualPair && (expectedPair[1] !== actualPair[1] || expectedPair[2] !== actualPair[2])) {
    return { status: 'mismatch' as const, note: '파일명에 표시된 학년·학기가 교재 정보와 다릅니다.' };
  }
  const expectedIsbn = String(book.isbn13 ?? '').replace(/[^0-9Xx]/g, '');
  const actualIsbn = filename.match(/(?<![0-9])\d{13}(?![0-9])/)?.[0] ?? '';
  if (expectedIsbn && actualIsbn && expectedIsbn !== actualIsbn) {
    return { status: 'mismatch' as const, note: '파일명 ISBN이 교재 ISBN과 다릅니다.' };
  }
  if (expected.length && hits.length === expected.length) {
    return { status: 'matched' as const, note: '파일명에서 교재 시리즈·과목·학년·학기 정보가 일치합니다.' };
  }
  return { status: 'uncertain' as const, note: '파일명만으로 교재 판본을 확정할 수 없어 관리자 확인이 필요합니다.' };
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers });
  if (request.method !== 'POST') return json({ error: 'POST 요청만 허용됩니다.' }, 405);

  const bearer = (request.headers.get('Authorization') ?? '').match(/^Bearer\s+(.+)$/i)?.[1];
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = readKey('SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEYS');
  const serviceKey = readKey('SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEYS');
  if (!bearer || !supabaseUrl || !anonKey || !serviceKey) return json({ error: '인증 또는 서버 설정을 확인해 주세요.' }, 401);

  const isService = bearer === serviceKey || hasVerifiedServiceRole(bearer);
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  if (!isService) {
    const auth = createClient(supabaseUrl, anonKey, { auth: { persistSession: false }, global: { headers: { Authorization: 'Bearer ' + bearer } } });
    const { data: userData, error: authError } = await auth.auth.getUser(bearer);
    if (authError || !userData.user) return json({ error: '로그인이 필요합니다.' }, 401);
    const { data: roleData, error: roleError } = await admin.from('admin_user_roles')
      .select('admin_role_permissions(permission_key)').eq('user_id', userData.user.id).maybeSingle();
    if (roleError) return json({ error: roleError.message }, 500);
    const permissions = (roleData?.admin_role_permissions ?? []) as Array<{ permission_key: string }>;
    if (!permissions.some(item => item.permission_key === 'links.update')) return json({ error: '답지 링크 검사 권한이 없습니다.' }, 403);
  }

  const { data: settings } = await admin.from('answer_link_search_settings')
    .select('requests_per_minute').eq('singleton', true).maybeSingle();
  const rpm = Math.max(1, Math.min(300, Number(settings?.requests_per_minute ?? 30)));
  const reserveSlot = async () => {
    for (let attempt = 0; attempt < 30; attempt++) {
      const { data, error } = await admin.rpc('reserve_answer_search_request', { p_limit: rpm });
      if (error) throw new Error('요청 한도 확인 실패: ' + error.message);
      if (data === true) return;
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    throw new Error('요청 한도 대기 시간이 초과되었습니다.');
  };

  let payload: { limit?: number };
  try { payload = await request.json(); } catch { payload = {}; }
  const limit = Math.max(1, Math.min(100, Number(payload.limit ?? 50)));
  const cutoff = new Date(Date.now() - 7 * 86400000).toISOString();
  const { data: links, error: linksError } = await admin.from('answer_links')
    .select('id,book_id,title,url')
    .or('health_checked_at.is.null,health_checked_at.lt.' + cutoff)
    .order('health_checked_at', { ascending: true, nullsFirst: true })
    .limit(limit);
  if (linksError) return json({ error: '검사할 답지 링크를 불러오지 못했습니다: ' + linksError.message }, 500);
  const bookIds = [...new Set((links ?? []).map(link => link.book_id).filter(Boolean))];
  const { data: bookRows, error: booksError } = bookIds.length
    ? await admin.from('books').select('id,title,publisher,subject,grade,semester,series,edition,curriculum_revision,isbn13').in('id', bookIds)
    : { data: [], error: null };
  if (booksError) return json({ error: '교재 정보를 불러오지 못했습니다: ' + booksError.message }, 500);
  const bookById = new Map((bookRows ?? []).map(book => [book.id, book]));

  const summary = { checked: 0, healthy: 0, broken: 0, redirected: 0, invalidPdf: 0, rateLimited: 0, temporaryErrors: 0, queued: 0 };
  const errors: string[] = [];
  for (const link of links ?? []) {
    let status: 'healthy' | 'broken' | 'redirected' | 'invalid_pdf' | 'rate_limited' | 'temporary_error' = 'temporary_error';
    let httpStatus: number | null = null;
    let contentType: string | null = null;
    let fileSize: number | null = null;
    let errorMessage: string | null = null;
    let finalUrl = link.url;
    let fileName: string | null = null;
    let isDownload = false;
    let matchStatus: 'unknown' | 'matched' | 'mismatch' | 'uncertain' | 'not_applicable' = 'unknown';
    let matchNote: string | null = null;
    try {
      if (!await safeExternalUrl(link.url)) throw new Error('안전하지 않은 공개 URL이어서 검사하지 않았습니다.');
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);
      try {
        const head = await fetchFollowingSafeRedirects(link.url, { method: 'HEAD' }, reserveSlot, controller.signal);
        let response = head.response;
        finalUrl = head.finalUrl;
        let redirectCount = head.redirects;
        let usedGet = false;
        const headType = response.headers.get('content-type') ?? '';
        const pdfExpectedFromUrl = /\.pdf(?:$|[?#])/i.test(finalUrl);
        if (response.status === 403 || response.status === 405 || response.status === 501
            || (response.ok && (pdfExpectedFromUrl || headType.toLowerCase().includes('application/pdf')))) {
          await response.body?.cancel().catch(() => undefined);
          const get = await fetchFollowingSafeRedirects(
            finalUrl,
            { method: 'GET', headers: { Range: 'bytes=0-1023' } },
            reserveSlot,
            controller.signal,
          );
          response = get.response;
          finalUrl = get.finalUrl;
          redirectCount += get.redirects;
          usedGet = true;
        }
        httpStatus = response.status;
        contentType = response.headers.get('content-type');
        const lengthHeader = response.headers.get('content-length');
        const contentRange = response.headers.get('content-range');
        const totalFromRange = contentRange?.match(/\/(\d+)$/)?.[1];
        fileSize = totalFromRange ? Number(totalFromRange) : lengthHeader && /^\d+$/.test(lengthHeader) ? Number(lengthHeader) : null;
        if (response.status === 404 || response.status === 410) {
          status = 'broken';
          errorMessage = '페이지가 삭제되었거나 찾을 수 없습니다.';
        } else if (response.status === 429) {
          status = 'rate_limited';
          errorMessage = '외부 사이트가 요청을 제한했습니다.';
        } else if (response.status >= 500) {
          status = 'temporary_error';
          errorMessage = '외부 사이트 서버 오류 (' + response.status + ')';
        } else if (!response.ok) {
          status = 'temporary_error';
          errorMessage = 'HTTP 응답 오류 (' + response.status + ')';
        } else {
          fileName = filenameFromResponse(response, finalUrl);
          const disposition = response.headers.get('content-disposition') ?? '';
          isDownload = /attachment/i.test(disposition)
            || /application\/(?:pdf|octet-stream|zip|vnd\.)/i.test(contentType ?? '')
            || /\.pdf(?:$|[?#])/i.test(finalUrl);
          const expectsPdf = /\.pdf(?:$|[?#])/i.test(finalUrl)
            || (contentType ?? '').toLowerCase().includes('application/pdf');
          if (expectsPdf) {
            if (!usedGet) {
              status = 'temporary_error';
              errorMessage = 'PDF 응답 본문을 확인하지 못했습니다.';
            } else {
              const bytes = await firstBytes(response, 5);
              const signature = new TextDecoder().decode(bytes);
              if (signature.startsWith('%PDF-')) status = 'healthy';
              else {
                status = 'invalid_pdf';
                errorMessage = 'PDF 주소로 표시되지만 파일 시그니처가 확인되지 않습니다.';
              }
            }
          } else {
            status = 'healthy';
            await response.body?.cancel().catch(() => undefined);
          }
          if (isDownload) {
            const assessment = assessFileName(bookById.get(link.book_id), fileName);
            matchStatus = assessment.status;
            matchNote = assessment.note;
          } else {
            matchStatus = 'not_applicable';
            matchNote = '일반 웹페이지 링크이므로 파일명 대조 대상이 아닙니다.';
          }
        }
      } finally {
        clearTimeout(timeout);
      }
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : '링크 검사 중 알 수 없는 오류가 발생했습니다.';
      status = /429|요청 한도/.test(errorMessage) ? 'rate_limited' : 'temporary_error';
    }

    const checkedAt = new Date().toISOString();
    const { error: updateError } = await admin.from('answer_links').update({
      health_status: status,
      health_checked_at: checkedAt,
      last_checked_at: checkedAt,
      health_http_status: httpStatus,
      health_content_type: contentType,
      health_error: errorMessage,
      health_file_size_bytes: fileSize,
      health_final_url: finalUrl,
      health_is_download: isDownload,
      health_file_name: fileName,
      health_match_status: matchStatus,
      health_match_note: matchNote,
    }).eq('id', link.id);
    if (updateError) errors.push(link.id + ': ' + updateError.message);
    summary.checked += 1;
    if (status === 'healthy') summary.healthy += 1;
    if (typeof redirectCount !== 'undefined' && redirectCount > 0) summary.redirected += 1;
    else if (status === 'broken') summary.broken += 1;
    else if (status === 'redirected') summary.redirected += 1;
    else if (status === 'invalid_pdf') summary.invalidPdf += 1;
    else if (status === 'rate_limited') summary.rateLimited += 1;
    else summary.temporaryErrors += 1;

    if (['broken', 'redirected', 'invalid_pdf'].includes(status)) {
      const { error: queueError } = await admin.from('answer_link_search_queue').insert({
        book_id: link.book_id, reason: 'link_health', priority: 200, available_at: new Date().toISOString(),
      });
      if (!queueError) summary.queued += 1;
      else if (queueError.code === '23505') {
        await admin.from('answer_link_search_queue').update({ priority: 200, updated_at: new Date().toISOString() })
          .eq('book_id', link.book_id).in('status', ['queued', 'running']);
      } else errors.push(link.id + ': 대체 답지 검색 대기열 추가 실패 - ' + queueError.message);
    }
  }

  return json({ summary, errors: errors.slice(0, 20) });
});
