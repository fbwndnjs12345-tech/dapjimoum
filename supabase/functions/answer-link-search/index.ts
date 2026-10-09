import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.117.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: corsHeaders });
const PAGE_SIZE = 1000;
const BATCH_SIZE = 5;

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

function queryFor(book: BookRow, extra = false): string {
  const details = [book.publisher, book.subject, book.grade, book.semester, book.series]
    .map(value => value?.trim()).filter(Boolean).join(' ');
  return extra
    ? `"${book.title}" ${details} 정답 해설 공식 자료실`
    : `"${book.title}" ${details} 정답과 해설`;
}

function matchAssessment(book: BookRow, title: string, snippet: string) {
  const source = `${title} ${snippet}`.toLocaleLowerCase('ko-KR');
  const titleTokens = book.title.toLocaleLowerCase('ko-KR').split(/\s+/).filter(token => token.length > 1);
  const titleMatches = titleTokens.filter(token => source.includes(token)).length;
  const titleRatio = titleTokens.length ? titleMatches / titleTokens.length : 0;
  const publisherMatches = Boolean(book.publisher && source.includes(book.publisher.toLocaleLowerCase('ko-KR')));
  const gradeMatches = Boolean(book.grade && source.includes(book.grade.toLocaleLowerCase('ko-KR')));
  const likely = titleRatio >= 0.8 && (publisherMatches || gradeMatches);
  return { match_status: likely ? 'likely' : titleRatio < 0.25 ? 'mismatch' : 'uncertain' };
}

async function searchBrave(query: string, apiKey: string, signal: AbortSignal) {
  const url = new URL('https://api.search.brave.com/res/v1/web/search');
  url.searchParams.set('q', query);
  url.searchParams.set('count', '10');
  url.searchParams.set('country', 'KR');
  url.searchParams.set('search_lang', 'ko');
  const response = await fetch(url, {
    headers: { 'Accept': 'application/json', 'X-Subscription-Token': apiKey },
    signal,
  });
  if (!response.ok) {
    const message = response.status === 429 ? '검색 API 요청 한도에 도달했습니다.' : `Brave 검색 API 오류 (${response.status})`;
    throw Object.assign(new Error(message), { status: response.status });
  }
  const body = await response.json();
  return (body?.web?.results ?? []) as Array<{ title?: string; url?: string; description?: string; meta_url?: { hostname?: string; netloc?: string } }>;
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

  const authClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${bearer}` } } });
  const { data: authData, error: authError } = await authClient.auth.getUser(bearer);
  if (authError || !authData.user) return json({ error: '로그인이 필요합니다.' }, 401);

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: adminRow, error: adminError } = await admin.from('admin_users').select('user_id').eq('user_id', authData.user.id).maybeSingle();
  if (adminError || !adminRow) return json({ error: '관리자 권한이 필요합니다.' }, 403);

  let payload: { action?: string; runId?: string; selectedBookIds?: string[]; includeBooksWithLinks?: boolean; reason?: string };
  try { payload = await request.json(); } catch { return json({ error: '요청 본문이 올바르지 않습니다.' }, 400); }
  const action = payload.action;

  if (action === 'start') {
    const selectedIds = Array.isArray(payload.selectedBookIds) ? [...new Set(payload.selectedBookIds.filter(id => typeof id === 'string'))] : [];
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

    const { data: run, error } = await admin.from('answer_link_search_runs').insert({
      created_by: authData.user.id,
      status: 'running',
      book_ids: targets.map(book => book.id),
    }).select('id,status,book_ids,started_at').single();
    if (error) return json({ error: `검색 작업을 만들지 못했습니다: ${error.message}` }, 500);
    return json({ run });
  }

  if (action === 'pause' || action === 'resume') {
    if (!payload.runId) return json({ error: '검색 작업 ID가 필요합니다.' }, 400);
    const status = action === 'pause' ? 'paused' : 'running';
    const { data, error } = await admin.from('answer_link_search_runs').update({
      status,
      lock_token: null,
      locked_until: null,
      finished_at: action === 'pause' ? new Date().toISOString() : null,
      ...(action === 'pause' && typeof payload.reason === 'string' ? { last_error: payload.reason.slice(0, 1500) } : {}),
    }).eq('id', payload.runId).select('id,status').single();
    if (error) return json({ error: error.message }, 500);
    return json({ run: data });
  }

  if (action === 'retry') {
    if (!payload.runId) return json({ error: '검색 작업 ID가 필요합니다.' }, 400);
    const { data: previous, error: previousError } = await admin.from('answer_link_search_runs').select('failed_book_ids').eq('id', payload.runId).single();
    if (previousError) return json({ error: previousError.message }, 500);
    const failedIds = previous.failed_book_ids ?? [];
    if (failedIds.length === 0) return json({ error: '재시도할 실패 교재가 없습니다.' }, 400);
    const { data: run, error } = await admin.from('answer_link_search_runs').insert({ created_by: authData.user.id, status: 'running', book_ids: failedIds }).select('id,status,book_ids,started_at').single();
    if (error) return json({ error: error.message }, 500);
    return json({ run });
  }

  if (action === 'batch') {
    if (!payload.runId) return json({ error: '검색 작업 ID가 필요합니다.' }, 400);
    const apiKey = Deno.env.get('BRAVE_SEARCH_API_KEY');
    if (!apiKey) return json({ error: 'BRAVE_SEARCH_API_KEY 서버 설정이 필요합니다.' }, 503);
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
    let apiRequests = 0;
    const failedBookIds: string[] = [];
    const errors: string[] = [];
    let rateLimited = false;
    for (const bookId of bookIds) {
      const book = bookById.get(bookId);
      if (!book) {
        errors.push(`교재 ${bookId}: 검색 중 삭제되었거나 조회할 수 없습니다.`);
        processed += 1;
        continue;
      }
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        const controller = new AbortController();
        timeout = setTimeout(() => controller.abort(), 12_000);
        const primaryQuery = queryFor(book);
        await new Promise(resolve => setTimeout(resolve, 350));
        apiRequests += 1;
        let results = await searchBrave(primaryQuery, apiKey, controller.signal);
        let resultQueries = results.map(() => primaryQuery);
        if (results.length < 3) {
          await new Promise(resolve => setTimeout(resolve, 350));
          apiRequests += 1;
          const extraQuery = queryFor(book, true);
          const extraResults = await searchBrave(extraQuery, apiKey, controller.signal);
          results = [...results, ...extraResults];
          resultQueries = [...resultQueries, ...extraResults.map(() => extraQuery)];
        }
        clearTimeout(timeout);
        timeout = undefined;

        const { data: existingLinks, error: linksError } = await admin.from('answer_links').select('url').eq('book_id', book.id);
        if (linksError) throw linksError;
        const existingUrls = new Set((existingLinks ?? []).map(row => canonicalUrl(row.url)));
        const unique = new Map<string, { title: string; url: string; snippet: string; host: string; query: string; match_status: string; link_type: string }>();
        for (const [resultIndex, result] of results.entries()) {
          const candidateUrl = result.url?.trim() ?? '';
          if (!candidateUrl || !isSafeSearchUrl(candidateUrl)) continue;
          const identity = canonicalUrl(candidateUrl);
          if (unique.has(identity)) continue;
          const title = (result.title ?? '').trim().slice(0, 500);
          const snippet = (result.description ?? '').trim().slice(0, 2000);
          const url = new URL(candidateUrl);
          unique.set(identity, {
            title: title || url.hostname,
            url: candidateUrl,
            snippet,
            host: result.meta_url?.hostname ?? result.meta_url?.netloc ?? url.hostname,
            query: resultQueries[resultIndex] ?? primaryQuery,
            match_status: matchAssessment(book, title, snippet).match_status,
            link_type: url.pathname.toLowerCase().endsWith('.pdf') ? 'PDF' : '웹페이지',
          });
        }

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
            source_type: 'unknown',
            query: candidate.query,
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
        if (timeout) clearTimeout(timeout);
        failedBookIds.push(book.id);
        const message = error instanceof Error ? error.message : '검색 중 오류가 발생했습니다.';
        errors.push(`${book.title}: ${message}`);
        if ((error as { status?: number }).status === 429) { rateLimited = true; break; }
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
    return json({ processed, candidates: candidateCount, apiRequests, failed: failedBookIds.length, rateLimited, errors });
  }

  return json({ error: '지원하지 않는 작업입니다.' }, 400);
});
