import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.117.3';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });

function hasVerifiedServiceRole(token: string): boolean {
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  try {
    const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
    return (JSON.parse(atob(padded)) as { role?: string }).role === 'service_role';
  } catch { return false; }
}
function readKey(legacyName: string, keySetName: string): string | undefined {
  const legacy = Deno.env.get(legacyName);
  if (legacy) return legacy;
  try { const set = JSON.parse(Deno.env.get(keySetName) ?? '{}') as Record<string, string>; return set.default ?? Object.values(set)[0]; }
  catch { return undefined; }
}
function safeExternalUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return false;
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return false;
    if (host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:')) return false;
    const ip = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (ip) {
      const [a,b] = ip.slice(1).map(Number);
      if ([a,b,...ip.slice(3).map(Number)].some(n => n > 255) || a === 0 || a === 10 || a === 127 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168 || a >= 224) return false;
    }
    return true;
  } catch { return false; }
}
async function reserveSlot(admin: ReturnType<typeof createClient>, rpm: number): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt++) {
    const { data, error } = await admin.rpc('reserve_answer_search_request', { p_limit: rpm });
    if (error) throw new Error('요청 한도 확인 실패: ' + error.message);
    if (data === true) return;
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  throw new Error('요청 한도 대기 시간이 초과되었습니다.');
}
async function fetchFollowingRedirects(initialUrl: string, admin: ReturnType<typeof createClient>, rpm: number, signal: AbortSignal) {
  let currentUrl = initialUrl;
  for (let redirects = 0; redirects <= 5; redirects++) {
    if (!safeExternalUrl(currentUrl)) throw new Error('안전하지 않은 리디렉션 주소여서 검사를 중단했습니다.');
    await reserveSlot(admin, rpm);
    const response = await fetch(currentUrl, {
      method: 'GET',
      headers: { Range: 'bytes=0-131071', 'User-Agent': 'DapjiMoum-LinkHealth/1.0 (+https://dapjimoum.pages.dev)' },
      redirect: 'manual', signal,
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      await response.body?.cancel().catch(() => undefined);
      if (!location) throw new Error('리디렉션 응답에 이동 주소가 없습니다.');
      if (redirects === 5) throw new Error('리디렉션 횟수가 5회를 초과했습니다.');
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }
    return { response, finalUrl: currentUrl };
  }
  throw new Error('리디렉션 검사에 실패했습니다.');
}
async function readPrefix(response: Response, maxBytes = 131072): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < maxBytes) {
      const { value, done } = await reader.read();
      if (done || !value?.length) break;
      const chunk = value.slice(0, Math.max(0, maxBytes - total));
      chunks.push(chunk);
      total += chunk.length;
    }
  } finally { await reader.cancel().catch(() => undefined); }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
  return output;
}
function extractDownloadCandidates(html: string, baseUrl: string): string[] {
  const found = new Map<string, number>();
  const anchor = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = anchor.exec(html)) !== null) {
    const href = match[1].replace(/&amp;/gi, '&').replace(/&#x2f;/gi, '/').replace(/&#47;/gi, '/').trim();
    const label = match[2].replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').toLowerCase();
    try {
      const url = new URL(href, baseUrl);
      if (!safeExternalUrl(url.toString())) continue;
      const target = (url.pathname + url.search).toLowerCase();
      const score = (/\.pdf(?:$|[?#])/.test(target) ? 10 : 0)
        + (/(download|attach|file|pdf)/i.test(target) ? 5 : 0)
        + (/(정답|해설|답지|다운로드|첨부|answer|solution|pdf)/i.test(label) ? 5 : 0);
      if (score > 0) found.set(url.toString(), Math.max(score, found.get(url.toString()) ?? 0));
    } catch { /* Ignore malformed links. */ }
  }
  const rawUrls = html.match(/https?:\/\/[^"'\s<>]+/gi) ?? [];
  for (const raw of rawUrls) {
    const cleaned = raw.replace(/&amp;/gi, '&').replace(/[),.;]+$/, '');
    if (!/\.pdf(?:$|[?#])|download|attach|file/i.test(cleaned)) continue;
    try {
      const url = new URL(cleaned);
      if (safeExternalUrl(url.toString())) found.set(url.toString(), Math.max(8, found.get(url.toString()) ?? 0));
    } catch { /* Ignore malformed URLs. */ }
  }
  return [...found.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([url]) => url);
}
async function inspectDownloadCandidate(url: string, admin: ReturnType<typeof createClient>, rpm: number, signal: AbortSignal) {
  const { response, finalUrl } = await fetchFollowingRedirects(url, admin, rpm, signal);
  const contentType = response.headers.get('content-type');
  const contentDisposition = response.headers.get('content-disposition') ?? '';
  const contentRange = response.headers.get('content-range');
  const lengthHeader = response.headers.get('content-length');
  const totalFromRange = contentRange?.match(/\/(\d+)$/)?.[1];
  const fileSize = totalFromRange ? Number(totalFromRange) : lengthHeader && /^\d+$/.test(lengthHeader) ? Number(lengthHeader) : null;
  const fileName = filenameFrom(response, finalUrl);
  const bytes = await readPrefix(response, 16);
  const signature = new TextDecoder().decode(bytes);
  const mime = (contentType ?? '').toLowerCase();
  const path = new URL(finalUrl).pathname.toLowerCase();
  const pdf = signature.startsWith('%PDF-');
  const otherFile = /attachment/i.test(contentDisposition) || mime.includes('application/octet-stream') || mime.includes('application/zip')
    || mime.includes('officedocument') || /\.(zip|hwp|hwpx|docx?|xlsx?|pptx?)$/i.test(path);
  return { isDownload: pdf || otherFile, finalUrl, contentType, fileSize, fileName, statusCode: response.status };
}
function assessContentMatch(book: { title?: string; subject?: string; grade?: string } | null, fileName: string | null) {
  if (!book?.title || !fileName) return { status: 'uncertain' as const, note: '교재명 또는 파일명이 없어 내용 일치 여부를 판정할 수 없습니다.' };
  let decodedName = fileName;
  try { decodedName = decodeURIComponent(fileName); } catch { /* Keep the original filename. */ }
  const title = book.title.toLowerCase();
  const file = decodedName.toLowerCase();
  const volumePattern = /(?:초등|중학|중등|고등)?\s*([1-3])\s*[-–]\s*([1-2])/i;
  const titleVolume = title.match(volumePattern);
  const fileVolume = file.match(volumePattern);
  if (titleVolume && fileVolume && (titleVolume[1] !== fileVolume[1] || titleVolume[2] !== fileVolume[2])) {
    return { status: 'mismatch' as const, note: '교재 학기·권수 표기가 파일명과 다릅니다.' };
  }
  const subjectGroups: Record<string, string[]> = {
    '국어': ['국어'],
    '영어': ['영어', 'english', 'voca', 'grammar', 'reading', 'listening', 'word', '문법', '독해', '리딩'],
    '수학': ['수학', 'math', '미적분', '확률', '통계', '대수', '기하'],
    '과학': ['과학', '물리', '화학', '생명', '지구'],
    '역사': ['역사', '한국사', '세계사', '동아시아사'],
    '사회': ['사회', '한국사', '세계사', '동아시아사', '지리', '경제', '정치', '윤리'],
  };
  const targetSubject = book.subject ?? '';
  const targetTerms = subjectGroups[targetSubject];
  if (targetTerms && !targetTerms.some(term => file.includes(term))) {
    const otherSubjectTerms = Object.entries(subjectGroups)
      .filter(([subject]) => subject !== targetSubject)
      .flatMap(([, terms]) => terms);
    if (otherSubjectTerms.some(term => file.includes(term))) {
      return { status: 'mismatch' as const, note: '파일명에 표시된 과목이 등록된 교재 과목과 다릅니다.' };
    }
  }
  const generic = new Set(['중학','중등','고등','초등','수학','과학','국어','영어','역사','사회','정답','해설','답지','정답과','평가문제집','자습서','개정','자료','및','본문','별책','빠른','정답표','pdf','answer','solution','the','book']);
  const tokens = title.match(/[가-힣]{2,}|[a-z]{2,}|\d+/gi) ?? [];
  const distinctive = tokens.filter(token => !generic.has(token.toLowerCase()) && !/^(?:20)?2[0-9]$/.test(token));
  const fileCompact = file.replace(/[^가-힣a-z0-9]/gi, '');
  const overlap = distinctive.filter(token => fileCompact.includes(token.toLowerCase().replace(/[^가-힣a-z0-9]/gi, '')));
  if (titleVolume && fileVolume && overlap.length > 0) {
    return { status: 'matched' as const, note: '교재명 핵심어와 학기 표기가 파일명에서 확인됩니다.' };
  }
  if (overlap.length >= 2) return { status: 'matched' as const, note: '교재명 핵심어가 파일명에서 확인됩니다.' };
  return { status: 'uncertain' as const, note: '파일은 다운로드되지만 파일명만으로 교재 일치 여부를 확정할 수 없습니다.' };
}

function filenameFrom(response: Response, finalUrl: string): string | null {
  const disposition = response.headers.get('content-disposition') ?? '';
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const plain = disposition.match(/filename="?([^";]+)"?/i)?.[1];
  if (encoded) { try { return decodeURIComponent(encoded); } catch { return encoded; } }
  if (plain) return plain.trim();
  try { const name = new URL(finalUrl).pathname.split('/').filter(Boolean).pop(); return name ? decodeURIComponent(name) : null; }
  catch { return null; }
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
    const { data: roleData, error: roleError } = await admin.from('admin_user_roles').select('admin_role_permissions(permission_key)').eq('user_id', userData.user.id).maybeSingle();
    if (roleError) return json({ error: roleError.message }, 500);
    const permissions = (roleData?.admin_role_permissions ?? []) as Array<{ permission_key: string }>;
    if (!permissions.some(item => item.permission_key === 'links.update')) return json({ error: '답지 링크 검사 권한이 없습니다.' }, 403);
  }
  const { data: settings } = await admin.from('answer_link_search_settings').select('requests_per_minute').eq('singleton', true).maybeSingle();
  const rpm = Math.max(1, Math.min(300, Number(settings?.requests_per_minute ?? 30)));
  let payload: { limit?: number; offset?: number; force?: boolean };
  try { payload = await request.json(); } catch { payload = {}; }
  const limit = Math.max(1, Math.min(10, Number(payload.limit ?? 10)));
  const offset = Math.max(0, Math.min(10000, Number(payload.offset ?? 0)));
  const cutoff = new Date(Date.now() - 7 * 86400000).toISOString();
  const retryCutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  let linksQuery = admin.from('answer_links').select('id,book_id,title,url,link_type,book:books!answer_links_book_id_fkey(title,subject,grade)');
  if (!payload.force) linksQuery = linksQuery.or('health_checked_at.is.null,health_checked_at.lt.' + cutoff + ',and(health_status.in.(temporary_error,rate_limited),health_checked_at.lt.' + retryCutoff + ')');
  const { data: links, error: linksError } = await linksQuery
    .order('id', { ascending: true }).range(offset, offset + limit - 1);
  if (linksError) return json({ error: '검사할 답지 링크를 불러오지 못했습니다: ' + linksError.message }, 500);
  const summary = { checked: 0, healthy: 0, broken: 0, redirected: 0, invalidPdf: 0, rateLimited: 0, temporaryErrors: 0, directDownloads: 0, landingPages: 0, matchedDownloads: 0, mismatchedDownloads: 0, uncertainDownloads: 0, queued: 0 };
  const errors: string[] = [];
  for (const link of links ?? []) {
    let status: 'healthy' | 'broken' | 'redirected' | 'invalid_pdf' | 'rate_limited' | 'temporary_error' = 'temporary_error';
    let httpStatus: number | null = null, contentType: string | null = null, fileSize: number | null = null, finalUrl: string | null = null, fileName: string | null = null;
    let isDownload = false, matchStatus: 'unknown' | 'matched' | 'mismatch' | 'uncertain' | 'not_applicable' = 'unknown', matchNote: string | null = null, errorMessage: string | null = null;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      if (!safeExternalUrl(link.url)) throw new Error('안전하지 않은 외부 URL이어서 검사하지 않았습니다.');
      const result = await fetchFollowingRedirects(link.url, admin, rpm, controller.signal);
      const response = result.response;
      finalUrl = result.finalUrl;
      httpStatus = response.status;
      contentType = response.headers.get('content-type');
      const contentRange = response.headers.get('content-range');
      const lengthHeader = response.headers.get('content-length');
      const totalFromRange = contentRange?.match(/\/(\d+)$/)?.[1];
      fileSize = totalFromRange ? Number(totalFromRange) : lengthHeader && /^\d+$/.test(lengthHeader) ? Number(lengthHeader) : null;
      fileName = filenameFrom(response, finalUrl);
      if (response.status === 404 || response.status === 410) {
        status = 'broken'; errorMessage = '페이지 또는 파일이 삭제되었거나 존재하지 않습니다.';
        await response.body?.cancel().catch(() => undefined);
      } else if (response.status === 429) {
        status = 'rate_limited'; errorMessage = '외부 사이트가 요청을 제한했습니다.';
        await response.body?.cancel().catch(() => undefined);
      } else if (response.status >= 500 || !response.ok) {
        status = 'temporary_error'; errorMessage = '외부 사이트 HTTP 응답 오류 (' + response.status + ')';
        await response.body?.cancel().catch(() => undefined);
      } else {
        const bookInfo = (Array.isArray(link.book) ? link.book[0] : link.book) as { title?: string; subject?: string; grade?: string } | null;
        const prefix = await readPrefix(response, 131072);
        const signature = new TextDecoder().decode(prefix.slice(0, 16));
        const mime = (contentType ?? '').toLowerCase();
        const path = new URL(finalUrl).pathname.toLowerCase();
        const pdfExpected = link.link_type === 'pdf' || /\.pdf$/i.test(path) || mime.includes('application/pdf');
        const pdfValid = signature.startsWith('%PDF-');
        const attachment = /attachment/i.test(response.headers.get('content-disposition') ?? '');
        const otherFile = attachment || mime.includes('application/octet-stream') || mime.includes('application/zip') || mime.includes('officedocument')
          || /\.(zip|hwp|hwpx|docx?|xlsx?|pptx?)$/i.test(path);
        if (pdfValid || otherFile) {
          status = 'healthy';
          isDownload = true;
          const match = assessContentMatch(bookInfo, fileName);
          matchStatus = match.status;
          matchNote = match.note;
        } else {
          const htmlPrefix = new TextDecoder().decode(prefix);
          const looksHtml = mime.includes('text/html') || mime.includes('application/xhtml')
            || /^\s*<(?:!doctype\s+html|html|head|body)\b/i.test(htmlPrefix);
          if (looksHtml) {
            const candidates = extractDownloadCandidates(htmlPrefix, finalUrl);
            for (const candidate of candidates) {
              try {
                const discovered = await inspectDownloadCandidate(candidate, admin, rpm, controller.signal);
                if (discovered.isDownload) {
                  isDownload = true;
                  finalUrl = discovered.finalUrl;
                  contentType = discovered.contentType;
                  fileSize = discovered.fileSize;
                  fileName = discovered.fileName;
                  httpStatus = discovered.statusCode;
                  const match = assessContentMatch(bookInfo, fileName);
                  matchStatus = match.status;
                  matchNote = match.note;
                  break;
                }
              } catch { /* Keep checking other candidate links. */ }
            }
          }
          if (pdfExpected && !isDownload) {
            status = 'invalid_pdf';
            errorMessage = 'PDF 다운로드 파일을 찾지 못했거나 파일 시그니처가 올바르지 않습니다.';
          } else {
            status = 'healthy';
            if (!isDownload) { matchStatus = 'not_applicable'; errorMessage = '페이지 접속은 정상이지만 페이지 안에서 직접 다운로드 파일을 확인하지 못했습니다.'; }
          }
        }
      }
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : '링크 검사 중 알 수 없는 오류가 발생했습니다.';
      status = /429|요청 한도/.test(errorMessage) ? 'rate_limited' : /리디렉션|안전하지 않은/.test(errorMessage) ? 'redirected' : 'temporary_error';
    } finally { clearTimeout(timeout); }
    const checkedAt = new Date().toISOString();
    const { error: updateError } = await admin.from('answer_links').update({
      health_status: status, health_checked_at: checkedAt, last_checked_at: checkedAt,
      health_http_status: httpStatus, health_content_type: contentType, health_error: errorMessage,
      health_file_size_bytes: fileSize, health_final_url: finalUrl, health_is_download: isDownload, health_file_name: fileName,
      health_match_status: matchStatus, health_match_note: matchNote,
    }).eq('id', link.id);
    if (updateError) errors.push(link.id + ': ' + updateError.message);
    summary.checked++;
    if (status === 'healthy') summary.healthy++;
    else if (status === 'broken') summary.broken++;
    else if (status === 'redirected') summary.redirected++;
    else if (status === 'invalid_pdf') summary.invalidPdf++;
    else if (status === 'rate_limited') summary.rateLimited++;
    else summary.temporaryErrors++;
    if (isDownload) summary.directDownloads++;
    else if (status === 'healthy') summary.landingPages++;
    if (matchStatus === 'matched') summary.matchedDownloads++;
    else if (matchStatus === 'mismatch') summary.mismatchedDownloads++;
    else if (matchStatus === 'uncertain') summary.uncertainDownloads++;
    if (['broken', 'redirected', 'invalid_pdf'].includes(status) || status === 'healthy' && !isDownload && (['answer', 'pdf', '다운로드', 'download'].includes(String(link.link_type).toLowerCase()) || /(답지|정답|해설|다운로드|answer|solution|pdf)/i.test(String(link.title))) || matchStatus === 'mismatch') {
      const { error: queueError } = await admin.from('answer_link_search_queue').insert({ book_id: link.book_id, reason: 'link_health', priority: 200, available_at: new Date().toISOString() });
      if (!queueError) summary.queued++;
      else if (queueError.code === '23505') await admin.from('answer_link_search_queue').update({ priority: 200, updated_at: new Date().toISOString() }).eq('book_id', link.book_id).in('status', ['queued', 'running']);
      else errors.push(link.id + ': 대체 답지 검색 대기열 추가 실패 - ' + queueError.message);
    }
  }
  return json({ summary, errors: errors.slice(0, 20), offset, nextOffset: offset + summary.checked, hasMore: (links?.length ?? 0) === limit });
});
