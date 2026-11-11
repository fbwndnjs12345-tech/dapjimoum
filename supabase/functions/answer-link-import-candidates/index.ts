import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.117.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: corsHeaders });

function readSupabaseKey(legacyName: string, keySetName: string): string | undefined {
  const legacy = Deno.env.get(legacyName);
  if (legacy) return legacy;
  try {
    const keySet = JSON.parse(Deno.env.get(keySetName) ?? '{}') as Record<string, string>;
    return keySet.default ?? Object.values(keySet)[0];
  } catch { return undefined; }
}

function canonicalUrl(value: string): string {
  const url = new URL(value.trim());
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('HTTP(S) URL만 등록할 수 있습니다.');
  }
  url.hash = '';
  url.hostname = url.hostname.toLowerCase();
  if ((url.protocol === 'https:' && url.port === '443') || (url.protocol === 'http:' && url.port === '80')) url.port = '';
  return url.toString();
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'POST 요청만 허용됩니다.' }, 405);

  const bearer = (request.headers.get('Authorization') ?? '').match(/^Bearer\s+(.+)$/i)?.[1];
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = readSupabaseKey('SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEYS');
  const serviceKey = readSupabaseKey('SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEYS');
  if (!bearer || !supabaseUrl || !anonKey || !serviceKey) return json({ error: '인증 또는 서버 설정을 확인해 주세요.' }, 401);

  const auth = createClient(supabaseUrl, anonKey, { auth: { persistSession: false }, global: { headers: { Authorization: 'Bearer ' + bearer } } });
  const { data: authData, error: authError } = await auth.auth.getUser(bearer);
  if (authError || !authData.user) return json({ error: '로그인이 필요합니다.' }, 401);

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: adminRow, error: adminError } = await admin.from('admin_users').select('user_id').eq('user_id', authData.user.id).maybeSingle();
  if (adminError || !adminRow) return json({ error: '관리자 권한이 필요합니다.' }, 403);

  let payload: { candidates?: unknown };
  try { payload = await request.json(); } catch { return json({ error: 'JSON 요청 본문이 올바르지 않습니다.' }, 400); }
  if (!Array.isArray(payload.candidates) || payload.candidates.length < 1 || payload.candidates.length > 100) {
    return json({ error: '후보는 한 번에 1~100개씩 전송해야 합니다.' }, 400);
  }

  const rows = [];
  try {
    for (const raw of payload.candidates) {
      if (!raw || typeof raw !== 'object') continue;
      const item = raw as Record<string, unknown>;
      const bookId = typeof item.book_id === 'string' ? item.book_id : '';
      const title = typeof item.title === 'string' ? item.title.trim().slice(0, 500) : '';
      const rawUrl = typeof item.url === 'string' ? item.url : '';
      if (!bookId || !title || !rawUrl) continue;
      const urlIdentity = canonicalUrl(rawUrl);
      const url = new URL(urlIdentity);
      const matchStatus = ['likely', 'uncertain', 'mismatch'].includes(String(item.match_status)) ? String(item.match_status) : 'uncertain';
      const linkType = item.link_type === 'PDF' ? 'PDF' : '웹페이지';
      rows.push({
        book_id: bookId,
        title,
        url: urlIdentity,
        url_identity: urlIdentity,
        source_name: url.hostname,
        link_type: linkType,
        source_type: 'unknown',
        query: 'local-publisher-crawl',
        snippet: typeof item.snippet === 'string' ? item.snippet.slice(0, 2000) : null,
        match_status: matchStatus,
        status: 'pending',
      });
    }
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : '후보 데이터가 올바르지 않습니다.' }, 400);
  }
  if (!rows.length) return json({ error: '등록할 수 있는 후보가 없습니다. 교재 ID와 URL을 확인하세요.' }, 400);

  const { data, error } = await admin.from('answer_link_candidates')
    .upsert(rows, { onConflict: 'book_id,url_identity', ignoreDuplicates: true })
    .select('id');
  if (error) return json({ error: '후보 저장 실패: ' + error.message }, 500);
  return json({ inserted: data?.length ?? 0, received: rows.length, duplicates: rows.length - (data?.length ?? 0) });
});
