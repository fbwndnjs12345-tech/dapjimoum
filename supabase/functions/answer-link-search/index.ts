import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.117.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: corsHeaders });
const PAGE_SIZE = 1000;
const BATCH_SIZE = 3;

function readSupabaseKey(legacyName: string, keySetName: string): string | undefined {
  const legacyKey = Deno.env.get(legacyName);
  if (legacyKey) return legacyKey;
  try {
    const keySet = JSON.parse(Deno.env.get(keySetName) ?? '{}') as Record<string, string>;
    return keySet.default ?? Object.values(keySet)[0];
  } catch { return undefined; }
}

type BookRow = {
  id: string; title: string; publisher: string | null; subject: string | null;
  grade: string | null; semester: string | null; series: string | null;
};

function canonicalUrl(value: string): string {
  const cleaned = value.trim();
  const match = cleaned.match(/^([A-Za-z][A-Za-z0-9+.-]*:\/\/)([^/?#]*)(.*)$/);
  if (!match) return cleaned;
  const scheme = match[1].toLowerCase();
  let authority = match[2].toLowerCase();
  let suffix = match[3];
  if (scheme === 'https://' && authority.endsWith(':443')) authority = authority.slice(0, -4);
  if (scheme === 'http://' && authority.endsWith(':80')) authority = authority.slice(0, -3);
  if (!suffix || suffix.startsWith('?') || suffix.startsWith('#')) suffix = `/${suffix}`;
  return `${scheme}${authority}${suffix}`;
}

function isSafeSearchUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return false;
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return false;
    if (/^(10\.|127\.|169\.254\.|192\.168\.|0\.)/.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false;
    if (host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:')) return false;
    return true;
  } catch { return false; }
}

function normalizeSearchText(value: string): string {
  return value.toLocaleLowerCase('ko-KR')
    .replace(/&amp;/g, '&')
    .replace(/[()［］【】「」『』,.:·_\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanBookTitle(book: BookRow): string {
  return book.title
    .replace(/\s*\((?:NE능률|능률|천재교육|비상교육|미래엔|동아출판|금성출판사|YBM|지학사|좋은책신사고|교학사|천재|비상)\)\s*/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function queriesFor(book: BookRow): string[] {
  const title = cleanBookTitle(book);
  const identity = [book.publisher, book.grade, book.semester, book.series].filter(Boolean).join(' ');
  const variants = [
    `"${title}" ${identity} 정답과 해설`,
    `"${title}" 답지 PDF`,
    `"${title}" site:tistory.com OR site:blog.naver.com OR site:cafe.naver.com 답지`,
  ];
  return [...new Set(variants.map(value => value.replace(/\s+/g, ' ').trim()))];
}

function matchAssessment(book: BookRow, title: string, snippet: string, url: string) {
  const publisher = normalizeSearchText(book.publisher ?? '');
  const bookTitle = normalizeSearchText(cleanBookTitle(book));
  const rawPath = new URL(url).pathname;
  let decodedPath = rawPath;
  try { decodedPath = decodeURIComponent(rawPath); } catch { /* Keep the encoded path when malformed. */ }
  const sourceText = normalizeSearchText(`${title} ${snippet} ${decodedPath}`);
  const ignored = new Set(['중학', '초등', '고등', '공통', '개정', '교육', '정답과', '정답', '해설', '답지', '답안', 'pdf']);
  const tokens = [...new Set(bookTitle.match(/[가-힣a-z0-9]+/g) ?? [])]
    .filter(token => token.length > 1 && !ignored.has(token) && !/^[1-3]학년$/.test(token) && !/^[12]학기$/.test(token) && token !== publisher);
  const numericTokens = tokens.filter(token => /\d/.test(token) && !/^[1-3]학년$/.test(token) && !/^[12]학기$/.test(token));
  const matchedTokens = tokens.filter(token => sourceText.includes(token));
  const titleRatio = tokens.length ? matchedTokens.length / tokens.length : 0;
  const answerSignal = /답지|정답|해설|답안|정답지|\bpdf\b/i.test(sourceText) || /\.pdf(?:$|[?#])/i.test(url);
  const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  const blockedHosts = new Set(['github.com','wikipedia.org','namu.wiki','google.com','bing.com','naver.com','daum.net','kakao.com','gmail.com']);
  const isBlockedHost = [...blockedHosts].some(domain => host === domain || host.endsWith(`.${domain}`));
  const likelyCommunity = /(^|\.)(tistory\.com|blog\.naver\.com|cafe\.naver\.com|m\.blog\.naver\.com)$/.test(host);
  const isPdf = /\.pdf(?:$|[?#])/i.test(url);
  const numericMatch = numericTokens.every(token => sourceText.includes(token));
  const hasDistinctiveMatch = matchedTokens.length > 0;
  const relevant = !isBlockedHost && hasDistinctiveMatch && numericMatch &&
    titleRatio >= (tokens.length <= 2 ? 0.5 : 0.4) &&
    answerSignal;
  const likely = relevant && answerSignal && titleRatio >= 0.75;
  return {
    relevant,
    match_status: likely ? 'likely' : relevant ? 'uncertain' : 'mismatch',
  };
}

function classifySource(hostname: string, publisher: string | null): 'official' | 'general' | 'unknown' {
  const host = hostname.toLowerCase().replace(/^www\./, '');
  if (/(^|\.)(tistory\.com|blog\.naver\.com|cafe\.naver\.com)$/.test(host)) return 'general';
  const officialDomains: Record<string, string[]> = {
    'ne능률': ['neungyule.com', 'nebooks.co.kr'],
    '능률': ['neungyule.com', 'nebooks.co.kr'],
    '천재교육': ['chunjae.co.kr', 'chunjae.com'],
    '비상교육': ['visang.com', 'visangbook.com'],
    '미래엔': ['mirae-n.com', 'mirae-n.co.kr'],
    '동아출판': ['doeapub.com', 'dongapublishing.com'],
    '좋은책신사고': ['sinsago.co.kr'],
  };
  const domains = officialDomains[(publisher ?? '').toLowerCase()] ?? [];
  if (domains.some(domain => host === domain || host.endsWith(`.${domain}`))) return 'official';
  return host ? 'general' : 'unknown';
}

type HtmlSearchResult = { title: string; url: string; description: string; meta_url: { hostname: string }; provider?: string };

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

function stripHtml(value: string): string {
  return decodeHtml(value.replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')).trim();
}

function decodeBase64Url(value: string): string | null {
  try {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch { return null; }
}

function extractHref(raw: string, base: string): string | null {
  try {
    const decoded = decodeHtml(raw.replace(/^['"]|['"]$/g, ''));
    const parsed = new URL(decoded, base);
    if (parsed.hostname.endsWith('google.com') && parsed.pathname === '/url') {
      const target = parsed.searchParams.get('q') ?? parsed.searchParams.get('url');
      if (target) return new URL(target).toString();
    }
    if ((parsed.hostname === 'bing.com' || parsed.hostname.endsWith('.bing.com')) && parsed.pathname === '/ck/a') {
      const encoded = parsed.searchParams.get('u');
      if (encoded?.startsWith('a1')) {
        const target = decodeBase64Url(encoded.slice(2));
        if (target && /^https?:\/\//i.test(target)) return new URL(target).toString();
      }
      const target = parsed.searchParams.get('url');
      if (target) return new URL(target).toString();
      return null;
    }
    if (parsed.hostname.includes('duckduckgo.com') && parsed.pathname.includes('/l/')) {
      const target = parsed.searchParams.get('uddg');
      if (target) return new URL(target).toString();
    }
    return parsed.toString();
  } catch { return null; }
}

function parseSearchHtml(engine: string, html: string, base: string): HtmlSearchResult[] {
  const results: HtmlSearchResult[] = [];
  const seen = new Set<string>();
  const blocks: string[] = [];
  if (engine === 'google') {
    for (const match of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?<h3\b[\s\S]*?<\/h3>[\s\S]*?)<\/a>/gi)) {
      blocks.push(match[0]);
    }
  } else if (engine === 'bing') {
    for (const match of html.matchAll(/<li\b[^>]*class=["'][^"']*b_algo[^"']*["'][^>]*>[\s\S]*?<\/li>/gi)) blocks.push(match[0]);
  } else {
    for (const match of html.matchAll(/<div\b[^>]*class=["'][^"']*result[^"']*["'][^>]*>[\s\S]*?<\/div>/gi)) blocks.push(match[0]);
  }
  for (const block of blocks) {
    const anchor = engine === 'duckduckgo'
      ? block.match(/<a\b[^>]*class=["'][^"']*result__a[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i)
      : engine === 'bing'
        ? block.match(/<h2\b[^>]*>[\s\S]*?<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/h2>/i)
        : block.match(/<a\b[^>]*href=["']([^"']+)["'][^>]*>[\s\S]*?<h3\b[^>]*>([\s\S]*?)<\/h3>[\s\S]*?<\/a>/i);
    if (!anchor) continue;
    const url = extractHref(anchor[1], base);
    if (!url || !isSafeSearchUrl(url)) continue;
    const title = stripHtml(anchor[2]);
    if (!title || seen.has(canonicalUrl(url))) continue;
    seen.add(canonicalUrl(url));
    const snippetMatch = engine === 'duckduckgo'
      ? block.match(/<a\b[^>]*class=["'][^"']*result__snippet[^"']*["'][^>]*>([\s\S]*?)<\/a>|<div\b[^>]*class=["'][^"']*result__snippet[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)
      : block.match(/<(?:p|div)\b[^>]*class=["'][^"']*(?:b_caption|snippet|VwiC3b)[^"']*["'][^>]*>([\s\S]*?)<\/(?:p|div)>/i);
    const description = stripHtml(snippetMatch?.[1] ?? snippetMatch?.[2] ?? '');
    results.push({ title, url, description, meta_url: { hostname: new URL(url).hostname }, provider: `${engine}_html` });
  }
  return results.slice(0, 10);
}

async function searchPublicHtml(engine: 'google' | 'bing' | 'duckduckgo', query: string, signal: AbortSignal): Promise<HtmlSearchResult[]> {
  const encoded = encodeURIComponent(query);
  const endpoints: Record<typeof engine, string> = {
    google: `https://www.google.com/search?q=${encoded}&num=10&hl=ko&gl=kr`,
    bing: `https://www.bing.com/search?q=${encoded}&count=10&setlang=ko-KR`,
    duckduckgo: `https://html.duckduckgo.com/html/?q=${encoded}`,
  };
  const response = await fetch(endpoints[engine], {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.7',
    },
    redirect: 'follow',
    signal,
  });
  if (!response.ok) throw new Error(`${engine} 검색 페이지 응답 오류 (${response.status})`);
  const html = await response.text();
  if (/captcha|unusual traffic|자동화된 요청|verify you are human|robot check/i.test(html)) {
    throw new Error(`${engine} 검색 페이지에서 자동 요청 확인이 발생했습니다.`);
  }
  const results = parseSearchHtml(engine, html, endpoints[engine]);
  if (!results.length) throw new Error(`${engine} 검색 결과를 읽지 못했습니다.`);
  return results;
}

async function searchKakao(query: string, apiKey: string, signal: AbortSignal): Promise<HtmlSearchResult[]> {
  const endpoints = [
    { provider: 'kakao_blog', url: 'https://dapi.kakao.com/v2/search/blog' },
    { provider: 'kakao_cafe', url: 'https://dapi.kakao.com/v2/search/cafe' },
    { provider: 'kakao_web', url: 'https://dapi.kakao.com/v2/search/web' },
  ] as const;
  const settled = await Promise.allSettled(endpoints.map(async ({ provider, url }) => {
    const endpoint = new URL(url);
    endpoint.searchParams.set('query', query);
    endpoint.searchParams.set('size', '10');
    endpoint.searchParams.set('sort', 'accuracy');
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: { Authorization: `KakaoAK ${apiKey}`, Accept: 'application/json' },
      signal,
    });
    if (!response.ok) {
      const detail = response.status === 401 ? 'REST API 키 인증 실패' :
        response.status === 429 ? '카카오 API 쿼터 초과 또는 요청 제한' :
        `HTTP ${response.status}`;
      throw new Error(`Daum ${provider} ${detail}`);
    }
    const body = await response.json() as { documents?: Array<{ title?: string; contents?: string; url?: string; blogname?: string; cafename?: string }> };
    return (body.documents ?? []).flatMap((doc) => {
      const url = doc.url?.trim() ?? '';
      if (!url || !isSafeSearchUrl(url)) return [];
      const host = new URL(url).hostname;
      return [{
        title: stripHtml(doc.title ?? ''),
        url,
        description: stripHtml(doc.contents ?? ''),
        meta_url: { hostname: host },
        provider,
      }];
    });
  }));
  const results: HtmlSearchResult[] = [];
  const errors: string[] = [];
  for (let i = 0; i < settled.length; i++) {
    const item = settled[i];
    if (item.status === 'fulfilled') results.push(...item.value);
    else errors.push(item.reason instanceof Error ? item.reason.message : 'Daum 검색 실패');
  }
  if (!results.length && errors.length === endpoints.length) throw new Error(errors.join(' / ').slice(0, 1000));
  return results;
}

async function searchNaverApiHub(query: string, clientId: string, clientSecret: string, signal: AbortSignal): Promise<HtmlSearchResult[]> {
  const endpoints = [
    { provider: 'naver_blog', path: '/search/v1/blog' },
    { provider: 'naver_cafe', path: '/search/v1/cafearticle' },
  ] as const;
  const settled = await Promise.allSettled(endpoints.map(async ({ provider, path }) => {
    const endpoint = new URL(`https://naverapihub.apigw.ntruss.com${path}`);
    endpoint.searchParams.set('query', query);
    endpoint.searchParams.set('display', '10');
    endpoint.searchParams.set('format', 'json');
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        'X-NCP-APIGW-API-KEY-ID': clientId,
        'X-NCP-APIGW-API-KEY': clientSecret,
        Accept: 'application/json',
      },
      signal,
    });
    if (!response.ok) {
      const detail = response.status === 401 || response.status === 403 ? '인증 또는 API 권한 확인 필요' :
        response.status === 429 ? '월 호출 한도 또는 초당 요청 제한' : `HTTP ${response.status}`;
      throw new Error(`NAVER API HUB ${provider}: ${detail}`);
    }
    const body = await response.json() as { items?: Array<{ title?: string; link?: string; description?: string }> };
    return (body.items ?? []).flatMap(item => {
      const url = item.link?.trim() ?? '';
      if (!url || !isSafeSearchUrl(url)) return [];
      return [{
        title: stripHtml(item.title ?? ''),
        url,
        description: stripHtml(item.description ?? ''),
        meta_url: { hostname: new URL(url).hostname },
        provider,
      }];
    });
  }));
  const results: HtmlSearchResult[] = [];
  const errors: string[] = [];
  for (const item of settled) {
    if (item.status === 'fulfilled') results.push(...item.value);
    else errors.push(item.reason instanceof Error ? item.reason.message : 'NAVER API HUB 검색 실패');
  }
  if (!results.length && errors.length === endpoints.length) throw new Error(errors.join(' / ').slice(0, 1000));
  return results;
}

async function searchWithProviders(query: string, signal: AbortSignal, mode: 'naver' | 'kakao' | 'web' | 'combined', kakaoKey?: string, naverCredentials?: { clientId: string; clientSecret: string }) {
  const tasks: Array<Promise<HtmlSearchResult[]>> = [];
  if (mode === 'web' || mode === 'combined') tasks.push(searchWithoutApi(query, signal));
  if ((mode === 'kakao' || mode === 'combined') && kakaoKey) tasks.push(searchKakao(query, kakaoKey, signal));
  if ((mode === 'naver' || mode === 'combined') && naverCredentials) tasks.push(searchNaverApiHub(query, naverCredentials.clientId, naverCredentials.clientSecret, signal));
  if (!tasks.length) throw new Error(mode === 'naver' ? '네이버 API 키가 설정되지 않았습니다.' : '카카오 API 키가 설정되지 않았습니다.');
  const settled = await Promise.allSettled(tasks);
  const results: HtmlSearchResult[] = [];
  const errors: string[] = [];
  for (const item of settled) {
    if (item.status === 'fulfilled') results.push(...item.value);
    else errors.push(item.reason instanceof Error ? item.reason.message : '검색 실패');
  }
  const unique = new Map<string, HtmlSearchResult>();
  for (const item of results) {
    const identity = canonicalUrl(item.url);
    if (!unique.has(identity)) unique.set(identity, item);
  }
  if (!unique.size && errors.length === settled.length) throw new Error(errors.join(' / ').slice(0, 1000));
  return { results: [...unique.values()], warnings: errors };
}

async function searchWithoutApi(query: string, signal: AbortSignal) {
  const engines = ['google', 'bing', 'duckduckgo'] as const;
  const settled = await Promise.allSettled(engines.map(engine => searchPublicHtml(engine, query, signal)));
  const results: HtmlSearchResult[] = [];
  const errors: string[] = [];
  for (let i = 0; i < settled.length; i++) {
    const item = settled[i];
    if (item.status === 'fulfilled') results.push(...item.value);
    else errors.push(`${engines[i]}: ${item.reason instanceof Error ? item.reason.message : '검색 실패'}`);
  }
  const unique = new Map<string, HtmlSearchResult>();
  for (const item of results) if (!unique.has(canonicalUrl(item.url))) unique.set(canonicalUrl(item.url), item);
  if (!unique.size && errors.length) throw new Error(errors.join(' / ').slice(0, 1000));
  return [...unique.values()];
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'POST 요청만 허용됩니다.' }, 405);

  const authHeader = request.headers.get('Authorization') ?? '';
  const bearer = authHeader.match(/^Bearer\s+(.+)$/i)?.[1];
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = readSupabaseKey('SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEYS');
  const serviceKey = readSupabaseKey('SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEYS');
  if (!bearer || !supabaseUrl || !anonKey || !serviceKey) return json({ error: '인증 또는 서버 설정을 확인해 주세요.' }, 401);

  const isServiceInvocation = bearer === serviceKey;
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  let actorUserId: string;
  if (isServiceInvocation) {
    const { data: adminRow, error: adminError } = await admin.from('admin_users').select('user_id').order('created_at', { ascending: true }).limit(1).maybeSingle();
    if (adminError || !adminRow?.user_id) return json({ error: '예약 검색을 실행할 관리자 계정을 확인할 수 없습니다.' }, 403);
    actorUserId = adminRow.user_id;
  } else {
    const authClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${bearer}` } } });
    const { data: authData, error: authError } = await authClient.auth.getUser(bearer);
    if (authError || !authData.user) return json({ error: '로그인이 필요합니다.' }, 401);
    const { data: adminRow, error: adminError } = await admin.from('admin_users').select('user_id').eq('user_id', authData.user.id).maybeSingle();
    if (adminError || !adminRow) return json({ error: '관리자 권한이 필요합니다.' }, 403);
    actorUserId = authData.user.id;
  }

  let payload: { action?: string; runId?: string; selectedBookIds?: string[]; includeBooksWithLinks?: boolean; reason?: string; providerMode?: 'naver' | 'kakao' | 'web' | 'combined' };
  try { payload = await request.json(); } catch { return json({ error: '요청 본문이 올바르지 않습니다.' }, 400); }
  const action = payload.action;
  const kakaoRestApiKey = Deno.env.get('KAKAO_REST_API_KEY')?.trim();
  const naverClientId = Deno.env.get('NAVER_API_HUB_CLIENT_ID')?.trim();
  const naverClientSecret = Deno.env.get('NAVER_API_HUB_CLIENT_SECRET')?.trim();
  const naverCredentials = naverClientId && naverClientSecret ? { clientId: naverClientId, clientSecret: naverClientSecret } : undefined;
  const providerMode = payload.providerMode ?? 'combined';
  if (!['naver', 'kakao', 'web', 'combined'].includes(providerMode)) return json({ error: '지원하지 않는 검색 경로입니다.' }, 400);

  if (action === 'start' || action === 'scheduled_start' || action === 'scheduled_queue_start') {
    const { data: activeRuns, error: activeRunsError } = await admin.from('answer_link_search_runs').select('id,status,book_ids,processed_books,candidate_count,api_requests,provider_mode,started_at').in('status',['running','paused']).order('started_at',{ascending:false}).limit(1);
    if (activeRunsError) return json({ error: '기존 검색 작업 확인 실패: ' + activeRunsError.message }, 500);
    if (activeRuns?.length) return json({ error: '이미 공용 검색 작업이 실행 중입니다. 모든 관리자에게 표시되는 기존 작업을 이어서 관리해 주세요.', activeRun: activeRuns[0] }, 409);
    if (providerMode === 'naver' && !naverCredentials) return json({ error: '네이버 API가 선택되었지만 Client ID 또는 Client Secret이 설정되지 않았습니다. Supabase Edge Function Secrets를 확인하세요.' }, 400);
    if (providerMode === 'kakao' && !kakaoRestApiKey) return json({ error: '카카오 API가 선택되었지만 REST API 키가 설정되지 않았습니다. Supabase Edge Function Secrets를 확인하세요.' }, 400);
    let selectedIds = Array.isArray(payload.selectedBookIds) ? [...new Set(payload.selectedBookIds.filter(id => typeof id === 'string'))] : [];
    let queueReason: 'new_book' | 'user_request' | 'link_health' | 'manual' = 'manual';
    if (action === 'scheduled_queue_start') {
      const { data: queued, error: queueError } = await admin.from('answer_link_search_queue').select('book_id,reason,priority').eq('status','queued').lte('available_at',new Date().toISOString()).order('priority',{ascending:false}).order('created_at',{ascending:true}).limit(200);
      if (queueError) return json({ error: '검색 대기열 조회 실패: ' + queueError.message }, 500);
      selectedIds = [...new Set((queued ?? []).map(row => row.book_id))];
      if (!selectedIds.length) return json({ queued: false, message: '처리할 자동 검색 대기 항목이 없습니다.' });
      queueReason = queued?.some(row => row.reason === 'user_request') ? 'user_request' : queued?.some(row => row.reason === 'link_health') ? 'link_health' : 'new_book';
    }
    const books: BookRow[] = [];
    if (selectedIds.length) {
      for (let offset = 0; offset < selectedIds.length; offset += PAGE_SIZE) {
        const ids = selectedIds.slice(offset, offset + PAGE_SIZE);
        const { data, error } = await admin.from('books').select('id,title,publisher,subject,grade,semester,series').in('id', ids);
        if (error) return json({ error: `교재 목록 조회 실패: ${error.message}` }, 500);
        books.push(...(data ?? []) as BookRow[]);
      }
    } else {
      for (let offset = 0; ; offset += PAGE_SIZE) {
        const { data, error } = await admin.from('books').select('id,title,publisher,subject,grade,semester,series').order('created_at', { ascending: false }).range(offset, offset + PAGE_SIZE - 1);
        if (error) return json({ error: `교재 목록 조회 실패: ${error.message}` }, 500);
        const page = (data ?? []) as BookRow[];
        books.push(...page);
        if (page.length < PAGE_SIZE) break;
      }
    }

    let targets = books;
    if (!selectedIds.length && !payload.includeBooksWithLinks) {
      const linkedIds = new Set<string>();
      for (let offset = 0; ; offset += PAGE_SIZE) {
        const { data, error } = await admin.from('answer_links').select('book_id').range(offset, offset + PAGE_SIZE - 1);
        if (error) return json({ error: `기존 답지 링크 조회 실패: ${error.message}` }, 500);
        const page = data ?? [];
        page.forEach(row => linkedIds.add(row.book_id));
        if (page.length < PAGE_SIZE) break;
      }
      targets = books.filter(book => !linkedIds.has(book.id));
    }

    if (!targets.length) return json({ run: null, queued: false, message: '검색할 교재가 없습니다.' });
    const triggerSource = action === 'scheduled_start' ? 'daily_schedule' : action === 'scheduled_queue_start' ? queueReason : 'manual';
    const { data: run, error } = await admin.from('answer_link_search_runs').insert({
      created_by: actorUserId,
      status: 'running',
      provider_mode: providerMode,
      book_ids: targets.map(book => book.id),
      trigger_source: triggerSource,
    }).select('id,status,book_ids,started_at,provider_mode').single();
    if (error?.code === '23505') {
      const { data: activeRun } = await admin.from('answer_link_search_runs').select('id,status,book_ids,processed_books,candidate_count,api_requests,provider_mode,started_at').eq('status','running').maybeSingle();
      return json({ error: '다른 관리자가 먼저 검색 작업을 시작했습니다. 기존 공용 작업을 확인해 주세요.', activeRun }, 409);
    }
    if (error) return json({ error: '검색 작업을 만들지 못했습니다: ' + error.message }, 500);
    const targetIds = targets.map(book => book.id);
    const { error: queueUpdateError } = await admin.from('answer_link_search_queue').update({ status: 'running', run_id: run.id, updated_at: new Date().toISOString() }).in('book_id', targetIds).in('status', ['queued','running']);
    if (queueUpdateError) return json({ error: '검색 작업은 생성했지만 자동 대기열 연결에 실패했습니다: ' + queueUpdateError.message, run }, 500);
    return json({ run });
  }

  if (action === 'pause' || action === 'resume') {
    if (!payload.runId) return json({ error: '검색 작업 ID가 필요합니다.' }, 400);
    const status = action === 'pause' ? 'paused' : 'running';
    const { data, error } = await admin.from('answer_link_search_runs').update({
      status,
      // Do not steal an in-flight batch on pause/resume. Its lease is released by
      // finish_answer_link_search_batch, or expires after two minutes if its tab dies.
      finished_at: action === 'pause' ? new Date().toISOString() : null,
      ...(action === 'pause' && typeof payload.reason === 'string' ? { last_error: payload.reason.slice(0, 1500) } : {}),
    }).eq('id', payload.runId).select('id,status').maybeSingle();
    if (error) return json({ error: error.message }, 500);
    if (!data) return json({ error: '검색 작업을 찾을 수 없습니다.' }, 404);
    return json({ run: data });
  }

  if (action === 'retry') {
    if (!payload.runId) return json({ error: '검색 작업 ID가 필요합니다.' }, 400);
    const { data: previous, error: previousError } = await admin.from('answer_link_search_runs').select('failed_book_ids,provider_mode').eq('id', payload.runId).maybeSingle();
    if (previousError) return json({ error: previousError.message }, 500);
    if (!previous) return json({ error: '검색 작업을 찾을 수 없거나 접근 권한이 없습니다.' }, 404);
    const failedIds = previous.failed_book_ids ?? [];
    if (failedIds.length === 0) return json({ error: '재시도할 실패 교재가 없습니다.' }, 400);
    const { data: run, error } = await admin.from('answer_link_search_runs').insert({ created_by: actorUserId, status: 'running', provider_mode: previous.provider_mode ?? 'combined', book_ids: failedIds, trigger_source: 'retry' }).select('id,status,book_ids,started_at,provider_mode').single();
    if (error?.code === '23505') return json({ error: '이미 다른 검색 작업이 실행 중입니다. 기존 작업을 먼저 확인해 주세요.' }, 409);
    if (error) return json({ error: error.message }, 500);
    return json({ run });
  }

  if (action === 'batch') {
    if (!payload.runId) return json({ error: '검색 작업 ID가 필요합니다.' }, 400);
    const { data: ownedRun, error: ownedRunError } = await admin.from('answer_link_search_runs').select('id,provider_mode').eq('id', payload.runId).maybeSingle();
    if (ownedRunError) return json({ error: ownedRunError.message }, 500);
    if (!ownedRun) return json({ error: '검색 작업을 찾을 수 없거나 접근 권한이 없습니다.' }, 404);
    const runProviderMode = (ownedRun.provider_mode ?? 'combined') as 'naver' | 'kakao' | 'web' | 'combined';
    if (runProviderMode === 'naver' && !naverCredentials) return json({ error: '이 작업은 네이버 API로 시작되었지만 현재 API 인증 정보가 없습니다. Secrets 설정 후 다시 이어서 실행하세요.' }, 400);
    if (runProviderMode === 'kakao' && !kakaoRestApiKey) return json({ error: '이 작업은 카카오 API로 시작되었지만 현재 API 키가 없습니다. Secrets 설정 후 다시 이어서 실행하세요.' }, 400);
    const lockToken = crypto.randomUUID();
    const { data: claim, error: claimError } = await admin.rpc('claim_answer_link_search_batch', { p_run_id: payload.runId, p_lock_token: lockToken, p_batch_size: BATCH_SIZE });
    if (claimError) return json({ error: `검색 배치를 가져오지 못했습니다: ${claimError.message}` }, 500);
    if (!claim) return json({ busy: true });
    const bookIds = (claim.book_ids ?? []) as string[];
    if (!bookIds.length) return json({ busy: false, done: true });

    const { data: batchBooks, error: booksError } = await admin.from('books').select('id,title,publisher,subject,grade,semester,series').in('id', bookIds);
    if (booksError) {
      await admin.rpc('finish_answer_link_search_batch', { p_run_id: payload.runId, p_lock_token: lockToken, p_processed: 0, p_candidates: 0, p_api_requests: 0, p_failed_book_ids: [], p_error: booksError.message });
      return json({ error: booksError.message }, 500);
    }

    const bookById = new Map(((batchBooks ?? []) as BookRow[]).map(book => [book.id, book]));
    let processed = 0;
    let candidateCount = 0;
    let apiRequests = 0; // Legacy database column; counts public HTML search-page requests.
    const failedBookIds: string[] = [];
    const errors: string[] = [];
    for (const bookId of bookIds) {
      const book = bookById.get(bookId);
      if (!book) {
        errors.push(`교재 ${bookId}: 검색 중 삭제되었거나 조회할 수 없습니다.`);
        processed += 1;
        continue;
      }
      try {
        const queries = queriesFor(book);
        const results: HtmlSearchResult[] = [];
        const resultQueries: string[] = [];
        const providerWarnings: string[] = [];
        const diagnostics: Array<{
          query: string; startedAt: string; durationMs: number;
          status: 'succeeded' | 'partial' | 'no_results' | 'failed' | 'filtered_all';
          resultCount: number; candidateCount: number; filteredCount: number;
          warnings: string[]; providersAttempted: string[]; providersWithResults: string[];
          errorMessage: string | null;
        }> = [];
        const attemptedProviders = runProviderMode === 'web'
          ? ['google_html', 'bing_html', 'duckduckgo_html']
          : runProviderMode === 'kakao'
            ? ['kakao_blog', 'kakao_cafe', 'kakao_web']
            : runProviderMode === 'naver'
              ? ['naver_blog', 'naver_cafe']
              : ['google_html', 'bing_html', 'duckduckgo_html', ...(kakaoRestApiKey ? ['kakao_blog', 'kakao_cafe', 'kakao_web'] : []), ...(naverCredentials ? ['naver_blog', 'naver_cafe'] : [])];
        const queryResults = await Promise.allSettled(queries.map(async query => {
          const started = Date.now();
          const startedAt = new Date(started).toISOString();
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 12_000);
          try {
            return { query, startedAt, durationMs: Date.now() - started, result: await searchWithProviders(query, controller.signal, runProviderMode, kakaoRestApiKey, naverCredentials) };
          } finally { clearTimeout(timeout); }
        }));
        for (let index = 0; index < queryResults.length; index++) {
          const item = queryResults[index];
          if (item.status === 'rejected') {
            const message = item.reason instanceof Error ? item.reason.message : '검색 실패';
            providerWarnings.push(message);
            diagnostics.push({
              query: queries[index], startedAt: new Date().toISOString(), durationMs: 0,
              status: 'failed', resultCount: 0, candidateCount: 0, filteredCount: 0,
              warnings: [message], providersAttempted: attemptedProviders, providersWithResults: [], errorMessage: message,
            });
            continue;
          }
          const { query, result, startedAt, durationMs } = item.value;
          results.push(...result.results);
          resultQueries.push(...result.results.map(() => query));
          providerWarnings.push(...result.warnings);
          const providersWithResults = [...new Set(result.results.map(row => row.provider ?? 'unknown'))];
          diagnostics.push({
            query, startedAt, durationMs,
            status: result.results.length ? (result.warnings.length ? 'partial' : 'succeeded') : (result.warnings.length ? 'failed' : 'no_results'),
            resultCount: result.results.length, candidateCount: 0, filteredCount: 0,
            warnings: result.warnings, providersAttempted: attemptedProviders, providersWithResults, errorMessage: result.warnings.join(' / ').slice(0, 1200) || null,
          });
        }
        apiRequests += queries.length * (runProviderMode === 'web' ? 3 : runProviderMode === 'kakao' ? 3 : runProviderMode === 'naver' ? 2 : 3 + (kakaoRestApiKey ? 3 : 0) + (naverCredentials ? 2 : 0));
        if (providerWarnings.length) errors.push(`${book.title}: 일부 검색 경로 실패 - ${[...new Set(providerWarnings)].join(' / ').slice(0, 800)}`);

        const diagnosticByQuery = new Map(diagnostics.map(item => [item.query, item]));
        const { data: existingLinks, error: linksError } = await admin.from('answer_links').select('url').eq('book_id', book.id);
        if (linksError) throw linksError;
        const existingUrls = new Set((existingLinks ?? []).map(row => canonicalUrl(row.url)));
        const unique = new Map<string, { title: string; url: string; snippet: string; host: string; query: string; provider?: string; match_status: string; link_type: string }>();
        for (const [resultIndex, result] of results.entries()) {
          const candidateUrl = result.url?.trim() ?? '';
          const diagnostic = diagnosticByQuery.get(resultQueries[resultIndex] ?? '');
          if (!candidateUrl || !isSafeSearchUrl(candidateUrl)) {
            if (diagnostic) diagnostic.filteredCount += 1;
            continue;
          }
          const identity = canonicalUrl(candidateUrl);
          if (unique.has(identity)) continue;
          const title = (result.title ?? '').trim().slice(0, 500);
          const snippet = (result.description ?? '').trim().slice(0, 2000);
          const url = new URL(candidateUrl);
          const assessment = matchAssessment(book, title, snippet, candidateUrl);
          if (!assessment.relevant) {
            if (diagnostic) diagnostic.filteredCount += 1;
            continue;
          }
          if (diagnostic) diagnostic.candidateCount += 1;
          unique.set(identity, {
            title: title || url.hostname,
            url: candidateUrl,
            snippet,
            host: result.meta_url?.hostname ?? url.hostname,
            query: resultQueries[resultIndex] ?? '',
            provider: result.provider,
            match_status: assessment.match_status,
            link_type: url.pathname.toLowerCase().endsWith('.pdf') ? 'PDF' : '웹페이지',
          });
        }

        for (const diagnostic of diagnostics) {
          if (diagnostic.resultCount > 0 && diagnostic.candidateCount === 0 && diagnostic.filteredCount > 0) diagnostic.status = 'filtered_all';
        }
        const { error: diagnosticError } = await admin.from('answer_link_search_attempts').insert(diagnostics.map(diagnostic => ({
          run_id: payload.runId,
          book_id: book.id,
          provider_mode: runProviderMode,
          query: diagnostic.query,
          status: diagnostic.status,
          providers_attempted: diagnostic.providersAttempted,
          providers_with_results: diagnostic.providersWithResults,
          result_count: diagnostic.resultCount,
          candidate_count: diagnostic.candidateCount,
          filtered_count: diagnostic.filteredCount,
          duration_ms: diagnostic.durationMs,
          warnings: diagnostic.warnings,
          error_code: diagnostic.status === 'failed' ? (diagnostic.errorMessage?.match(/(401|403|429|timeout|abort|인증|한도|차단)/i)?.[0] ?? 'provider_error') : null,
          error_message: diagnostic.errorMessage,
          details: { result_count_by_provider: diagnostic.providersWithResults.reduce<Record<string, number>>((counts, provider) => { counts[provider] = (counts[provider] ?? 0) + 1; return counts; }, {}) },
          started_at: diagnostic.startedAt,
          finished_at: new Date().toISOString(),
        })));
        if (diagnosticError) errors.push(`${book.title}: 검색 진단 저장 실패 - ${diagnosticError.message}`);

        for (const candidate of unique.values()) {
          const identity = canonicalUrl(candidate.url);
          const isDuplicate = existingUrls.has(identity);
          const record = {
            run_id: payload.runId,
            book_id: book.id,
            title: candidate.title,
            url: candidate.url,
            url_identity: identity,
            source_name: candidate.host,
            link_type: candidate.link_type,
            source_type: classifySource(candidate.host, book.publisher),
            query: candidate.provider ? `[${candidate.provider}] ${candidate.query}` : candidate.query,
            snippet: candidate.snippet,
            match_status: candidate.match_status,
            status: isDuplicate ? 'duplicate' : 'pending',
          };
          if (isDuplicate) {
            const { data: updated, error: updateError } = await admin.from('answer_link_candidates').update({ status: 'duplicate', run_id: payload.runId }).eq('book_id', book.id).eq('url_identity', identity).eq('status', 'pending').select('id');
            if (updateError) throw updateError;
            if (!updated?.length) {
              const { error: duplicateInsertError } = await admin.from('answer_link_candidates').upsert(record, { onConflict: 'book_id,url_identity', ignoreDuplicates: true });
              if (duplicateInsertError) throw duplicateInsertError;
            }
          } else {
            const { data, error: insertError } = await admin.from('answer_link_candidates').upsert(record, { onConflict: 'book_id,url_identity', ignoreDuplicates: true }).select('id');
            if (insertError) throw insertError;
            if (data?.length) candidateCount += 1;
          }
        }
      } catch (error) {
        failedBookIds.push(book.id);
        const message = error instanceof Error ? error.message : '검색 중 오류가 발생했습니다.';
        errors.push(`${book.title}: ${message}`);
      }
      processed += 1;
    }

    const { error: finishError } = await admin.rpc('finish_answer_link_search_batch', {
      p_run_id: payload.runId,
      p_lock_token: lockToken,
      p_processed: processed,
      p_candidates: candidateCount,
      p_api_requests: apiRequests,
      p_failed_book_ids: failedBookIds,
      p_error: errors.length ? errors.join(' | ').slice(0, 1500) : null,
    });
    if (finishError) return json({ error: `검색 결과를 저장하지 못했습니다: ${finishError.message}` }, 500);
    return json({ processed, candidates: candidateCount, searchRequests: apiRequests, failed: failedBookIds.length, errors });
  }

  return json({ error: '지원하지 않는 작업입니다.' }, 400);
});
