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

function safeExternalUrl(value: string) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return false;
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return false;
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':')) return false;
    if (/^(10\.|127\.|169\.254\.|192\.168\.|0\.)/.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false;
    if (host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:')) return false;
    return true;
  } catch { return false; }
}

async function firstBytes(response: Response, count = 5): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  try {
    const { value } = await reader.read();
    const bytes = value ?? new Uint8Array();
    return bytes.slice(0, count);
  } finally {
    await reader.cancel().catch(() => undefined);
  }
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

  const summary = { checked: 0, healthy: 0, broken: 0, redirected: 0, invalidPdf: 0, rateLimited: 0, temporaryErrors: 0, queued: 0 };
  const errors: string[] = [];
  for (const link of links ?? []) {
    let status: 'healthy' | 'broken' | 'redirected' | 'invalid_pdf' | 'rate_limited' | 'temporary_error' = 'temporary_error';
    let httpStatus: number | null = null;
    let contentType: string | null = null;
    let fileSize: number | null = null;
    let errorMessage: string | null = null;
    try {
      if (!safeExternalUrl(link.url)) throw new Error('안전하지 않은 외부 URL이어서 검사하지 않았습니다.');
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 90000);
      try {
        await reserveSlot();
        let response = await fetch(link.url, { method: 'HEAD', redirect: 'manual', signal: controller.signal });
        let usedGet = false;
        const headType = response.headers.get('content-type') ?? '';
        const pdfExpectedFromUrl = /\.pdf(?:$|[?#])/i.test(link.url);
        if (response.status === 405 || response.status === 501 || (response.ok && (pdfExpectedFromUrl || headType.toLowerCase().includes('application/pdf')))) {
          await response.body?.cancel().catch(() => undefined);
          await reserveSlot();
          response = await fetch(link.url, { method: 'GET', headers: { Range: 'bytes=0-1023' }, redirect: 'manual', signal: controller.signal });
          usedGet = true;
        }
        httpStatus = response.status;
        contentType = response.headers.get('content-type');
        const lengthHeader = response.headers.get('content-length');
        const contentRange = response.headers.get('content-range');
        const totalFromRange = contentRange?.match(/\/(\d+)$/)?.[1];
        fileSize = totalFromRange ? Number(totalFromRange) : lengthHeader && /^\d+$/.test(lengthHeader) ? Number(lengthHeader) : null;
        if (response.status >= 300 && response.status < 400) {
          status = 'redirected';
          errorMessage = '외부 페이지가 리디렉션을 반환했습니다. 새 주소를 관리자에게 확인해야 합니다.';
        } else if (response.status === 404 || response.status === 410) {
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
          const expectsPdf = /\.pdf(?:$|[?#])/i.test(link.url) || (contentType ?? '').toLowerCase().includes('application/pdf');
          if (expectsPdf) {
            if (!usedGet || response.bodyUsed) {
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
    }).eq('id', link.id);
    if (updateError) errors.push(link.id + ': ' + updateError.message);
    summary.checked += 1;
    if (status === 'healthy') summary.healthy += 1;
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
