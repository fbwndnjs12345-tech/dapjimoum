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
      headers: { Range: 'bytes=0-2047', 'User-Agent': 'DapjiMoum-LinkHealth/1.0 (+https://dapjimoum.pages.dev)' },
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
async function readSignature(response: Response): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  try { const { value } = await reader.read(); return (value ?? new Uint8Array()).slice(0, 16); }
  finally { await reader.cancel().catch(() => undefined); }
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
  let payload: { limit?: number };
  try { payload = await request.json(); } catch { payload = {}; }
  const limit = Math.max(1, Math.min(10, Number(payload.limit ?? 10)));
  const cutoff = new Date(Date.now() - 7 * 86400000).toISOString();
  const { data: links, error: linksError } = await admin.from('answer_links')
    .select('id,book_id,title,url,link_type')
    .or('health_checked_at.is.null,health_checked_at.lt.' + cutoff)
    .order('health_checked_at', { ascending: true, nullsFirst: true }).limit(limit);
  if (linksError) return json({ error: '검사할 답지 링크를 불러오지 못했습니다: ' + linksError.message }, 500);
  const summary = { checked: 0, healthy: 0, broken: 0, redirected: 0, invalidPdf: 0, rateLimited: 0, temporaryErrors: 0, directDownloads: 0, landingPages: 0, queued: 0 };
  const errors: string[] = [];
  for (const link of links ?? []) {
    let status: 'healthy' | 'broken' | 'redirected' | 'invalid_pdf' | 'rate_limited' | 'temporary_error' = 'temporary_error';
    let httpStatus: number | null = null, contentType: string | null = null, fileSize: number | null = null, finalUrl: string | null = null, fileName: string | null = null;
    let isDownload = false, errorMessage: string | null = null;
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
        const signature = new TextDecoder().decode(await readSignature(response));
        const mime = (contentType ?? '').toLowerCase();
        const path = new URL(finalUrl).pathname.toLowerCase();
        const pdfExpected = link.link_type === 'pdf' || /\.pdf$/i.test(path) || mime.includes('application/pdf');
        const pdfValid = signature.startsWith('%PDF-');
        const attachment = /attachment/i.test(response.headers.get('content-disposition') ?? '');
        const otherFile = attachment || mime.includes('application/zip') || mime.includes('application/octet-stream')
          || mime.includes('officedocument') || /\.(zip|hwp|hwpx|docx?|xlsx?|pptx?)$/i.test(path);
        if (pdfExpected && !pdfValid) {
          status = 'invalid_pdf'; errorMessage = 'PDF 주소로 표시되지만 실제 PDF 파일 시그니처가 확인되지 않습니다.';
        } else {
          status = 'healthy'; isDownload = pdfValid || otherFile;
          if (!isDownload) errorMessage = '페이지 접속은 정상이지만 직접 다운로드 파일은 확인되지 않았습니다.';
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
    if (['broken', 'redirected', 'invalid_pdf'].includes(status) || status === 'healthy' && !isDownload && ['answer', 'pdf', '다운로드', 'download'].includes(String(link.link_type).toLowerCase())) {
      const { error: queueError } = await admin.from('answer_link_search_queue').insert({ book_id: link.book_id, reason: 'link_health', priority: 200, available_at: new Date().toISOString() });
      if (!queueError) summary.queued++;
      else if (queueError.code === '23505') await admin.from('answer_link_search_queue').update({ priority: 200, updated_at: new Date().toISOString() }).eq('book_id', link.book_id).in('status', ['queued', 'running']);
      else errors.push(link.id + ': 대체 답지 검색 대기열 추가 실패 - ' + queueError.message);
    }
  }
  return json({ summary, errors: errors.slice(0, 20), hasMore: (links?.length ?? 0) === limit });
});
