import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Check, ExternalLink, LoaderCircle, Play, RefreshCw, Search, ShieldCheck, X } from 'lucide-react';
import { useAppContext } from '../../state/useAppContext';
import { supabase } from '../../lib/supabase/client';
import { renderAdminLayout } from './admin';

type Run = {
  created_by: string;
  id: string; status: 'running' | 'paused' | 'completed' | 'failed'; book_ids: string[];
  next_index: number; processed_books: number; candidate_count: number; api_requests: number;
  error_count: number; failed_book_ids: string[]; last_error: string | null; started_at: string; finished_at: string | null; provider_mode: 'naver' | 'kakao' | 'web' | 'combined';
};
type Candidate = {
  id: string; run_id: string | null; book_id: string; title: string; url: string; source_name: string | null;
  link_type: string; source_type: 'official' | 'general' | 'unknown'; query: string; snippet: string | null;
  match_status: 'likely' | 'uncertain' | 'mismatch'; status: 'pending' | 'approved' | 'rejected' | 'duplicate' | 'unverified';
  review_note: string | null; created_at: string;
  reviewed_by: string | null; reviewed_at: string | null;
  books: { title: string; publisher: string | null; subject: string | null; grade: string | null; semester: string | null } | null;
};
type SearchFilter = 'all' | Candidate['status'] | 'official' | 'general' | 'verified' | 'unverified' | 'duplicate';

function errorText(error: unknown) {
  if (error instanceof Error) return error.message;
  return '요청을 처리하지 못했습니다.';
}

export function AdminLinkSearchPage() {
  const { books, refreshCatalog } = useAppContext();
  const [runs, setRuns] = useState<Run[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [filter, setFilter] = useState<SearchFilter>('pending');
  const [query, setQuery] = useState('');
  const [publisherFilter, setPublisherFilter] = useState('전체');
  const [subjectFilter, setSubjectFilter] = useState('전체');
  const [gradeFilter, setGradeFilter] = useState('전체');
  const [includeBooksWithLinks, setIncludeBooksWithLinks] = useState(false);
  const [providerMode, setProviderMode] = useState<'naver' | 'kakao' | 'web' | 'combined' | 'local'>('combined');
  const [selectedBookIds, setSelectedBookIds] = useState<string[]>([]);
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<string[]>([]);
  const [bookSearch, setBookSearch] = useState('');
  const [page, setPage] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pumpGuard = useRef(false);
  const PAGE_SIZE = 25;

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError('');
    const candidatePromise = (async (): Promise<Candidate[]> => {
        const records: Candidate[] = [];
        for (let offset = 0; ; offset += 1000) {
          const response = await supabase.from('answer_link_candidates').select('*, books(title,publisher,subject,grade,semester)').order('created_at', { ascending: false }).range(offset, offset + 999);
          if (response.error) throw response.error;
          const page = (response.data ?? []) as Candidate[];
          records.push(...page);
          if (page.length < 1000) return records;
        }
      })();
    const [runResponse, candidateResult] = await Promise.all([
      supabase.from('answer_link_search_runs').select('*').order('started_at', { ascending: false }).limit(20),
      candidatePromise.then(data => ({ data, error: null as Error | null })).catch(loadError => ({ data: [] as Candidate[], error: loadError as Error })),
    ]);
    if (candidateResult.error) {
      setError(errorText(candidateResult.error));
      setRuns([]);
      setCandidates([]);
    } else if (runResponse.error || !runResponse.data) {
      setError(runResponse.error?.message ?? '검색 작업 기록을 불러오지 못했습니다.');
      setRuns([]);
      setCandidates([]);
    } else {
      setRuns(runResponse.data as Run[]);
      setCandidates(candidateResult.data);
    }
    setIsLoading(false);
  }, []);

  useEffect(() => { void loadData(); }, [loadData]);

  const invoke = useCallback(async (body: Record<string, unknown>) => {
    const { data, error: invokeError } = await supabase.functions.invoke('answer-link-search', { body });
    if (invokeError) {
      const context = (invokeError as { context?: Response }).context;
      if (context) {
        try {
          const responseBody = await context.clone().json();
          throw new Error(responseBody.error ?? invokeError.message);
        } catch (parseError) {
          if (parseError instanceof Error && parseError.message !== 'Unexpected end of JSON input') throw parseError;
        }
      }
      throw invokeError;
    }
    if (data?.error) throw new Error(data.error);
    return data;
  }, []);

  const runBatches = useCallback(async (runId: string) => {
    if (pumpGuard.current) return;
    pumpGuard.current = true;
    setBusy(true);
    setActiveRunId(runId);
    setError('');
    setNotice('검색 배치를 처리하고 있습니다. 페이지를 닫아도 진행 상태는 저장되며, 다시 열어 이어서 실행할 수 있습니다.');
    try {
      while (true) {
        const result = await invoke({ action: 'batch', runId });
        await loadData();
        const { data: latest, error: runError } = await supabase.from('answer_link_search_runs').select('*').eq('id', runId).single();
        if (runError) throw runError;
        const current = latest as Run;
        if (current.status !== 'running') {
          setNotice(current.status === 'completed' ? '검색 작업이 완료되었습니다.' : '검색 작업이 중지되었습니다.');
          break;
        }
        if (result.busy) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          continue;
        }
        if (result.errors?.length) setError(result.errors.join('\n'));
        if (result.done || current.next_index >= current.book_ids.length) break;
      }
      await loadData();
      await refreshCatalog();
    } catch (runError) {
      setError(errorText(runError));
      setNotice('검색이 중단되었습니다. 환경 설정을 확인한 뒤 이어서 실행하거나 실패 교재를 재시도할 수 있습니다.');
      try { await invoke({ action: 'pause', runId, reason: errorText(runError) }); } catch { /* A failed pause is shown in the saved run status on refresh. */ }
    } finally {
      pumpGuard.current = false;
      setBusy(false);
      setActiveRunId(null);
      await loadData();
    }
  }, [invoke, loadData, refreshCatalog]);

  const startSearch = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      if (providerMode === 'local') {
        window.open('https://github.com/fbwndnjs12345-tech/dapjimoum/actions/workflows/build-local-answer-finder.yml', '_blank', 'noopener,noreferrer');
        setNotice('로컬 프로그램 빌드 페이지를 열었습니다. Windows용 탐색기를 내려받아 실행하면 후보가 이 관리자 검토 목록에 등록됩니다.');
        setBusy(false);
        return;
      }
      const result = await invoke({ action: 'start', includeBooksWithLinks, selectedBookIds, providerMode });
      await loadData();
      const newRun = result.run as Run;
      if (newRun.book_ids.length === 0) {
        setNotice('검색 대상 교재가 없습니다.');
        setBusy(false);
        return;
      }
      void runBatches(newRun.id);
    } catch (startError) { setError(errorText(startError)); setBusy(false); }
  };

  const pauseSearch = async (runId: string) => {
    try { await invoke({ action: 'pause', runId }); setNotice('검색 작업을 중지했습니다. 진행 상태는 저장되었습니다.'); await loadData(); }
    catch (pauseError) { setError(errorText(pauseError)); }
  };

  const resumeSearch = async (run: Run) => {
    try { await invoke({ action: 'resume', runId: run.id }); void runBatches(run.id); }
    catch (resumeError) { setError(errorText(resumeError)); }
  };

  const continueSearch = async (run: Run) => {
    if (busy) return;
    if (run.status === 'paused') await resumeSearch(run);
    else if (run.status === 'running') void runBatches(run.id);
  };

  const retryFailed = async (run: Run) => {
    try {
      const result = await invoke({ action: 'retry', runId: run.id });
      await loadData();
      void runBatches((result.run as Run).id);
    } catch (retryError) { setError(errorText(retryError)); }
  };

  const updateCandidateStatus = async (candidate: Candidate, status: 'approved' | 'rejected') => {
    if (status === 'approved' && candidate.match_status !== 'likely' && !window.confirm('교재 일치 여부가 불확실한 후보입니다. 링크를 검토한 뒤 승인하시겠습니까?')) return;
    const reviewNote = null;
    setError('');
    try {
      if (status === 'approved') {
        const { data, error: approvalError } = await supabase.rpc('approve_answer_link_candidate', { p_candidate_id: candidate.id });
        if (approvalError) throw approvalError;
        setNotice(data === 'duplicate' ? '이미 등록된 URL이라 중복 후보로 표시했습니다.' : '후보를 승인해 답지 링크에 등록했습니다. 실제 URL 검증 상태는 미검증으로 유지됩니다.');
        await refreshCatalog();
      } else {
        const { error: rejectError } = await supabase.rpc('reject_answer_link_candidate', { p_candidate_id: candidate.id, p_review_note: reviewNote });
        if (rejectError) throw rejectError;
        setNotice('후보를 거절했습니다.');
      }
      await loadData();
    } catch (updateError) { setError(errorText(updateError)); }
  };

  const updateSourceType = async (candidate: Candidate, sourceType: Candidate['source_type']) => {
    try {
      const { error: sourceError } = await supabase.rpc('set_answer_link_candidate_source_type', { p_candidate_id: candidate.id, p_source_type: sourceType });
      if (sourceError) throw sourceError;
      await loadData();
    } catch (sourceError) { setError(errorText(sourceError)); }
  };

  const approveSelected = async () => {
    const selected = candidates.filter(candidate => selectedCandidateIds.includes(candidate.id) && candidate.status === 'pending' && candidate.match_status === 'likely');
    if (!selected.length) { setError('일치 가능성이 높은 검토 대기 후보를 선택해 주세요.'); return; }
    if (!window.confirm(`${selected.length}개 후보를 승인합니다. 기존 URL 중복은 승인 단계에서 다시 확인됩니다. 진행할까요?`)) return;
    setBusy(true);
    setError('');
    let approved = 0;
    let duplicate = 0;
    const failures: string[] = [];
    for (const candidate of selected) {
      const { data, error: approvalError } = await supabase.rpc('approve_answer_link_candidate', { p_candidate_id: candidate.id });
      if (approvalError) failures.push(`${candidate.title}: ${approvalError.message}`);
      else if (data === 'duplicate') duplicate += 1;
      else approved += 1;
    }
    setBusy(false);
    setSelectedCandidateIds([]);
    setNotice(`일괄 처리: ${approved}개 승인, ${duplicate}개 중복 처리${failures.length ? `, ${failures.length}개 실패` : ''}`);
    if (failures.length) setError(failures.join('\n'));
    await Promise.all([loadData(), refreshCatalog()]);
  };

  // 일치 가능성이 높은 대기 후보는 선택/페이지 이동 없이 한 번에 승인한다.
  const approveAllLikely = async () => {
    const eligible = candidates.filter(candidate => candidate.status === 'pending' && candidate.match_status === 'likely');
    if (!eligible.length) { setNotice('일괄 승인할 후보가 없습니다.'); return; }
    if (!window.confirm(`일치 가능성이 높은 후보 ${eligible.length}개를 모두 답지 링크로 등록합니다. 중복 URL은 자동 제외됩니다. 진행할까요?`)) return;
    setBusy(true);
    setError('');
    setNotice('후보를 승인하고 있습니다. 창을 닫지 마세요.');
    let approved = 0;
    let duplicate = 0;
    const failures: string[] = [];
    try {
      for (let offset = 0; offset < eligible.length; offset += 5) {
        const group = eligible.slice(offset, offset + 5);
        const results = await Promise.all(group.map(async candidate => {
          const result = await supabase.rpc('approve_answer_link_candidate', { p_candidate_id: candidate.id });
          return { candidate, ...result };
        }));
        for (const result of results) {
          if (result.error) failures.push(`${result.candidate.title}: ${result.error.message}`);
          else if (result.data === 'duplicate') duplicate += 1;
          else approved += 1;
        }
        setNotice(`승인 처리 중: ${Math.min(offset + group.length, eligible.length)}/${eligible.length}`);
      }
      setSelectedCandidateIds([]);
      setNotice(`일괄 처리 완료: ${approved}개 승인, ${duplicate}개 중복 제외, ${failures.length}개 실패`);
      if (failures.length) setError(failures.join('\n'));
      await Promise.all([loadData(), refreshCatalog()]);
    } catch (approvalError) {
      setError(errorText(approvalError));
    } finally {
      setBusy(false);
    }
  };

  const uniqueValues = (key: 'publisher' | 'subject' | 'grade') => [...new Set(candidates.map(item => item.books?.[key]?.trim()).filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b, 'ko'));
  const filteredCandidates = useMemo(() => candidates.filter(candidate => {
    const fields = [candidate.title, candidate.url, candidate.source_name, candidate.books?.title, candidate.books?.publisher, candidate.books?.subject, candidate.books?.grade, candidate.books?.semester].filter(Boolean).join(' ').toLocaleLowerCase('ko-KR');
    if (query.trim() && !fields.includes(query.trim().toLocaleLowerCase('ko-KR'))) return false;
    if (publisherFilter !== '전체' && candidate.books?.publisher !== publisherFilter) return false;
    if (subjectFilter !== '전체' && candidate.books?.subject !== subjectFilter) return false;
    if (gradeFilter !== '전체' && candidate.books?.grade !== gradeFilter) return false;
    if (filter === 'official') return candidate.source_type === 'official';
    if (filter === 'general') return candidate.source_type === 'general';
    if (filter === 'verified') return candidate.match_status === 'likely';
    if (filter === 'unverified') return candidate.status === 'unverified' || candidate.match_status !== 'likely';
    if (filter === 'duplicate') return candidate.status === 'duplicate';
    return filter === 'all' || candidate.status === filter;
  }), [candidates, filter, gradeFilter, publisherFilter, query, subjectFilter]);
  const totalPages = Math.max(1, Math.ceil(filteredCandidates.length / PAGE_SIZE));
  const pageRows = filteredCandidates.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const pageEligibleCandidates = pageRows.filter(candidate => candidate.status === 'pending' && candidate.match_status === 'likely');
  const selectableBooks = books.filter(book => bookSearch.trim() && [book.title, book.publisher, book.subject, book.grade, book.semester].some(value => value?.toLocaleLowerCase('ko-KR').includes(bookSearch.trim().toLocaleLowerCase('ko-KR')))).slice(0, 10);
  const pendingCount = candidates.filter(candidate => candidate.status === 'pending').length;

  const content = <div className="space-y-6">
    <header className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
      <div><h2 className="text-xl font-extrabold text-[#191F28]">답지 링크 자동 검색</h2><p className="mt-1 text-sm text-[#667085]">검색 결과는 검토 후보로만 저장됩니다. 관리자 승인 전에는 교재 답지 목록에 등록되지 않습니다.</p></div>
      <button onClick={() => void loadData()} disabled={isLoading || busy} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-[#D0D5DD] bg-white px-4 text-sm font-semibold text-[#344054] hover:bg-[#F9FAFB] disabled:opacity-50"><RefreshCw className="h-4 w-4" />새로고침</button>
    </header>

    {error && <div role="alert" className="whitespace-pre-wrap rounded-xl border border-[#FDD8D5] bg-[#FFEEEC] p-3 text-sm text-[#B42318]">{error}</div>}
    {notice && <div role="status" className="rounded-xl border border-[#EAECF0] bg-[#F9FAFB] p-3 text-sm text-[#344054]">{notice}</div>}

    <section className="rounded-2xl border border-[#E5E8EB] bg-white p-4 sm:p-5 space-y-4">
      <div><h3 className="font-bold text-[#191F28]">검색 실행</h3><p className="mt-1 text-xs text-[#667085]">검색할 경로를 직접 선택합니다. 선택한 경로만 호출하며, 작업을 이어가거나 실패 교재를 재시도해도 같은 설정을 유지합니다.</p></div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {([
          ['combined', '통합 검색', '네이버 + 카카오 + 웹 검색'],
          ['naver', '네이버 API', '블로그·카페 검색'],
          ['kakao', '카카오 API', '다음 블로그·카페·웹문서'],
          ['web', '공개 웹 검색', 'Google·Bing·DuckDuckGo'],
          ['local', '로컬 프로그램', 'Windows 브라우저 탐색기'],
        ] as const).map(([value, title, description]) => <button key={value} type="button" onClick={() => setProviderMode(value)} className={`rounded-xl border p-3 text-left transition ${providerMode === value ? 'border-[#191F28] bg-[#F2F4F7] ring-1 ring-[#191F28]' : 'border-[#D0D5DD] bg-white hover:bg-[#F9FAFB]'}`}><span className="block text-sm font-bold text-[#191F28]">{title}</span><span className="mt-1 block text-[11px] leading-4 text-[#667085]">{description}</span></button>)}
      </div>
      {providerMode === 'local' ? <div className="rounded-xl border border-[#D0D5DD] bg-[#F9FAFB] p-3 text-xs leading-5 text-[#475467]">로컬 탐색기는 Windows PC에서 실행됩니다. GitHub Actions에서 최신 Windows 프로그램을 내려받아 실행하세요. Supabase 관리자 로그인을 연결하면 검색 후보가 이 검토 목록으로 전송됩니다. <a className="font-bold underline" href="https://github.com/fbwndnjs12345-tech/dapjimoum/actions/workflows/build-local-answer-finder.yml" target="_blank" rel="noreferrer">로컬 프로그램 다운로드 페이지 열기</a></div> : <div className="rounded-xl border border-[#EAECF0] bg-[#F9FAFB] p-3 text-xs leading-5 text-[#475467]">{providerMode === 'naver' ? 'NAVER_API_HUB_CLIENT_ID와 NAVER_API_HUB_CLIENT_SECRET 설정이 필요합니다.' : providerMode === 'kakao' ? 'KAKAO_REST_API_KEY 설정이 필요합니다.' : providerMode === 'web' ? '별도 API 키 없이 공개 검색 페이지를 조회합니다. 검색엔진의 자동화 차단에 따라 결과가 제한될 수 있습니다.' : '설정된 네이버·카카오 API와 공개 웹 검색을 함께 조회합니다. API가 설정되지 않은 경로는 건너뛰고, 실패한 경로는 오류로 기록합니다.'}</div>}
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-2">
          <label htmlFor="search-book-picker" className="text-xs font-bold text-[#344054]">선택 교재 검색 (선택 사항)</label>
          <div className="relative"><Search className="absolute left-3 top-3 h-4 w-4 text-[#98A2B3]" /><input id="search-book-picker" value={bookSearch} onChange={event => setBookSearch(event.target.value)} placeholder="교재명·출판사로 검색" className="w-full rounded-xl border border-[#D0D5DD] py-2.5 pl-9 pr-3 text-sm outline-none focus:border-[#667085]" /></div>
          {selectableBooks.length > 0 && <div className="max-h-36 overflow-auto rounded-xl border border-[#EAECF0]">{selectableBooks.map(book => <button key={book.id} type="button" onClick={() => { setSelectedBookIds(ids => ids.includes(book.id) ? ids.filter(id => id !== book.id) : [...ids, book.id]); setBookSearch(''); }} className="block w-full border-b border-[#F2F4F6] px-3 py-2 text-left text-xs hover:bg-[#F9FAFB]">{selectedBookIds.includes(book.id) ? '✓ ' : ''}{book.title} · {book.publisher} · {book.grade} {book.semester}</button>)}</div>}
          {selectedBookIds.length > 0 && <div className="flex flex-wrap gap-2">{selectedBookIds.map(id => { const book = books.find(item => item.id === id); return <button type="button" key={id} onClick={() => setSelectedBookIds(ids => ids.filter(item => item !== id))} className="rounded-full border border-[#D0D5DD] px-2.5 py-1 text-xs text-[#344054]">{book?.title ?? id} ×</button>; })}</div>}
        </div>
        <div className="flex flex-col justify-end gap-3">
          <label className="flex items-start gap-2 text-xs text-[#475467]"><input type="checkbox" checked={includeBooksWithLinks} onChange={event => setIncludeBooksWithLinks(event.target.checked)} className="mt-0.5 accent-[#191F28]" />이미 답지 링크가 있는 교재도 재검색</label>
          <p className="text-xs text-[#667085]">선택된 교재가 있으면 선택 교재만 검색합니다. 없으면 {includeBooksWithLinks ? '전체 교재' : '답지 링크 미등록 교재'}를 검색합니다.</p>
          <button type="button" onClick={() => void startSearch()} disabled={busy || isLoading} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#191F28] px-4 py-3 text-sm font-bold text-white hover:bg-[#333D4B] disabled:opacity-50"><Play className="h-4 w-4" />{providerMode === 'local' ? '로컬 프로그램 열기' : '검색 시작'}</button>
        </div>
      </div>
    </section>

    <section className="rounded-2xl border border-[#E5E8EB] bg-white p-4 sm:p-5 space-y-3">
      <div className="flex items-center justify-between gap-3"><div><h3 className="font-bold text-[#191F28]">검색 작업 기록</h3><p className="mt-1 text-xs text-[#667085]">최근 20개 작업 · 최근 검색 페이지 요청 {runs.reduce((sum, run) => sum + run.api_requests, 0).toLocaleString()}회 · 검토 대기 후보 {pendingCount}개</p></div></div>
      {runs.length === 0 ? <p className="rounded-xl border border-[#EAECF0] bg-[#F9FAFB] p-5 text-center text-sm text-[#667085]">검색 작업 기록이 없습니다.</p> : <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-xs"><thead className="border-b border-[#EAECF0] text-[#667085]"><tr><th className="px-3 py-2">시작 시각</th><th className="px-3 py-2">상태</th><th className="px-3 py-2">진행</th><th className="px-3 py-2">후보/검색 요청/실패</th><th className="px-3 py-2 text-right">작업</th></tr></thead><tbody className="divide-y divide-[#F2F4F6]">{runs.map(run => <tr key={run.id}><td className="px-3 py-3">{new Date(run.started_at).toLocaleString('ko-KR')}</td><td className="px-3 py-3">{run.status === 'running' ? '진행 중' : run.status === 'paused' ? '중지됨' : run.status === 'completed' ? '완료' : '오류'}</td><td className="px-3 py-3">{run.processed_books}/{run.book_ids.length}</td><td className="px-3 py-3">{run.candidate_count} / {run.api_requests} / {run.error_count}<p className="mt-1 text-[10px] text-[#667085]">{run.provider_mode === 'naver' ? '네이버 API' : run.provider_mode === 'kakao' ? '카카오 API' : run.provider_mode === 'web' ? '공개 웹' : '통합'}</p></td><td className="px-3 py-3 text-right space-x-2">{run.status === 'running' && <><button type="button" onClick={() => void continueSearch(run)} disabled={busy} className="rounded-lg border border-[#D0D5DD] px-2.5 py-1.5 font-semibold disabled:opacity-50">배치 실행/이어하기</button><button type="button" onClick={() => void pauseSearch(run.id)} className="rounded-lg border border-[#D0D5DD] px-2.5 py-1.5 font-semibold">중지</button></>}{run.status === 'paused' && <button type="button" onClick={() => void continueSearch(run)} disabled={busy} className="rounded-lg border border-[#D0D5DD] px-2.5 py-1.5 font-semibold disabled:opacity-50">이어하기</button>}{run.failed_book_ids.length > 0 && <button type="button" onClick={() => void retryFailed(run)} disabled={busy} className="rounded-lg border border-[#D0D5DD] px-2.5 py-1.5 font-semibold disabled:opacity-50">실패 재시도</button>}</td></tr>)}</tbody></table></div>}
      {activeRunId && busy && <div role="status" className="flex items-center gap-2 text-xs text-[#475467]"><LoaderCircle className="h-4 w-4 animate-spin" />현재 검색 작업은 페이지를 열어 둔 동안 자동으로 다음 배치를 요청합니다.</div>}
    </section>

    <section className="rounded-2xl border border-[#E5E8EB] bg-white p-4 sm:p-5 space-y-4">
      <div className="flex flex-col justify-between gap-3 xl:flex-row xl:items-center"><div><h3 className="font-bold text-[#191F28]">검색 후보 검토</h3><p className="mt-1 text-xs text-[#667085]">후보 {filteredCandidates.length}개 · 페이지 {Math.min(page + 1, totalPages)}/{totalPages}</p></div><div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:flex">
        <input value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} placeholder="교재·제목·URL 검색" className="col-span-2 min-h-10 rounded-lg border border-[#D0D5DD] px-3 text-xs outline-none focus:border-[#667085] xl:w-56" />
        <select value={filter} onChange={event => { setFilter(event.target.value as SearchFilter); setPage(0); }} className="min-h-10 rounded-lg border border-[#D0D5DD] px-2 text-xs"><option value="pending">검토 대기</option><option value="all">전체 상태</option><option value="approved">승인</option><option value="rejected">거절</option><option value="duplicate">중복</option><option value="unverified">확인 불가·불확실</option><option value="verified">일치 가능성 높음</option><option value="official">공식 출처</option><option value="general">일반 출처</option></select>
        <select value={publisherFilter} onChange={event => { setPublisherFilter(event.target.value); setPage(0); }} className="min-h-10 rounded-lg border border-[#D0D5DD] px-2 text-xs"><option>전체</option>{uniqueValues('publisher').map(value => <option key={value}>{value}</option>)}</select>
        <select value={subjectFilter} onChange={event => { setSubjectFilter(event.target.value); setPage(0); }} className="min-h-10 rounded-lg border border-[#D0D5DD] px-2 text-xs"><option>전체</option>{uniqueValues('subject').map(value => <option key={value}>{value}</option>)}</select>
        <select value={gradeFilter} onChange={event => { setGradeFilter(event.target.value); setPage(0); }} className="min-h-10 rounded-lg border border-[#D0D5DD] px-2 text-xs"><option value="전체">전체 학년</option>{uniqueValues('grade').map(value => <option key={value}>{value}</option>)}</select>
      </div></div>
      {pendingCount > 0 && <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[#F8FAFC] p-3"><div className="text-xs text-[#475467]">검토 대기 {pendingCount}개 · 일치 가능성 높음 {candidates.filter(candidate => candidate.status === 'pending' && candidate.match_status === 'likely').length}개</div><div className="flex flex-wrap gap-2"><label className="flex items-center gap-2 text-xs text-[#475467]"><input type="checkbox" checked={pageEligibleCandidates.length > 0 && pageEligibleCandidates.every(candidate => selectedCandidateIds.includes(candidate.id))} onChange={event => setSelectedCandidateIds(current => event.target.checked ? [...new Set([...current, ...pageEligibleCandidates.map(candidate => candidate.id)])] : current.filter(id => !pageEligibleCandidates.some(candidate => candidate.id === id)))} className="accent-[#191F28]" />현재 페이지 선택</label><button type="button" onClick={() => void approveSelected()} disabled={busy || selectedCandidateIds.length === 0} className="min-h-10 rounded-xl border border-[#D0D5DD] bg-white px-3 py-2 text-xs font-bold text-[#344054] disabled:opacity-40">선택 승인 ({selectedCandidateIds.filter(id => candidates.some(candidate => candidate.id === id && candidate.status === 'pending' && candidate.match_status === 'likely')).length})</button><button type="button" onClick={() => void approveAllLikely()} disabled={busy || !candidates.some(candidate => candidate.status === 'pending' && candidate.match_status === 'likely')} className="min-h-10 rounded-xl bg-[#191F28] px-4 py-2 text-xs font-bold text-white disabled:opacity-40">일치 가능 후보 전체 승인</button></div></div>}
      {isLoading ? <p role="status" className="p-8 text-center text-sm text-[#667085]">검색 결과를 불러오는 중입니다.</p> : pageRows.length === 0 ? <p className="rounded-xl border border-[#EAECF0] bg-[#F9FAFB] p-8 text-center text-sm text-[#667085]">조건에 맞는 후보가 없습니다.</p> : <div className="overflow-x-auto rounded-xl border border-[#EAECF0]"><table className="w-full min-w-[1240px] text-left text-xs"><thead className="bg-[#F9FAFB] text-[#475467]"><tr><th className="w-10 px-3 py-3">선택</th><th className="px-3 py-3">교재</th><th className="px-3 py-3">검색 후보</th><th className="px-3 py-3">출처·유형</th><th className="px-3 py-3">교재 일치</th><th className="px-3 py-3">상태</th><th className="px-3 py-3">검색 쿼리</th><th className="px-3 py-3">검토</th></tr></thead><tbody className="divide-y divide-[#EAECF0]">{pageRows.map(candidate => <tr key={candidate.id} className="align-top"><td className="px-3 py-3">{candidate.status === 'pending' && candidate.match_status === 'likely' && <input type="checkbox" aria-label={`${candidate.title} 선택`} checked={selectedCandidateIds.includes(candidate.id)} onChange={event => setSelectedCandidateIds(ids => event.target.checked ? [...new Set([...ids, candidate.id])] : ids.filter(id => id !== candidate.id))} className="accent-[#191F28]" />}</td><td className="max-w-56 break-words px-3 py-3"><strong className="text-[#191F28]">{candidate.books?.title ?? '교재 없음'}</strong><p className="mt-1 text-[#667085]">{[candidate.books?.publisher, candidate.books?.subject, candidate.books?.grade, candidate.books?.semester].filter(Boolean).join(' · ')}</p></td><td className="max-w-[340px] break-words px-3 py-3"><a href={candidate.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-[#191F28] underline">{candidate.title}<ExternalLink className="h-3 w-3 shrink-0" /></a><p className="mt-1 break-all text-[#667085]">{candidate.url}</p>{candidate.snippet && <p className="mt-2 line-clamp-3 leading-5 text-[#475467]">{candidate.snippet}</p>}</td><td className="max-w-40 break-words px-3 py-3">{candidate.source_name || '출처 미확인'}<p className="mt-1 text-[#667085]">{candidate.source_type === 'official' ? '공식 출처' : candidate.source_type === 'general' ? '일반 출처' : '출처 미분류'} · {candidate.link_type}</p>{candidate.status === 'pending' && <select aria-label="출처 유형 분류" value={candidate.source_type} onChange={event => void updateSourceType(candidate, event.target.value as Candidate['source_type'])} className="mt-2 rounded-md border border-[#D0D5DD] px-2 py-1 text-[11px]"><option value="unknown">미분류</option><option value="official">공식 출처 확인</option><option value="general">일반 출처 확인</option></select>}</td><td className="px-3 py-3">{candidate.match_status === 'likely' ? <span className="inline-flex items-center gap-1 font-semibold text-[#027A48]"><ShieldCheck className="h-3.5 w-3.5" />일치 가능성 높음</span> : candidate.match_status === 'mismatch' ? '불일치 가능' : '관리자 확인 필요'}</td><td className="px-3 py-3">{candidate.status === 'pending' ? '검토 대기' : candidate.status === 'approved' ? '승인' : candidate.status === 'rejected' ? '거절' : candidate.status === 'duplicate' ? '중복' : '확인 불가'}{candidate.reviewed_by && <p className="mt-1 break-all text-[10px] text-[#667085]">관리자 {candidate.reviewed_by.slice(0, 8)} · {candidate.reviewed_at ? new Date(candidate.reviewed_at).toLocaleString('ko-KR') : '시간 미등록'}</p>}{candidate.review_note && <p className="mt-1 whitespace-normal text-[10px] text-[#667085]">사유: {candidate.review_note}</p>}</td><td className="max-w-56 break-words px-3 py-3 text-[#667085]">{candidate.query}</td><td className="whitespace-nowrap px-3 py-3">{candidate.status === 'pending' && <div className="flex gap-1.5"><button type="button" onClick={() => void updateCandidateStatus(candidate, 'approved')} className="inline-flex items-center gap-1 rounded-lg bg-[#191F28] px-2.5 py-2 font-bold text-white"><Check className="h-3.5 w-3.5" />승인</button><button type="button" onClick={() => void updateCandidateStatus(candidate, 'rejected')} className="inline-flex items-center gap-1 rounded-lg border border-[#D0D5DD] px-2.5 py-2 font-bold text-[#344054]"><X className="h-3.5 w-3.5" />거절</button></div>}</td></tr>)}</tbody></table></div>}
      <div className="flex items-center justify-between"><button type="button" onClick={() => setPage(value => Math.max(0, value - 1))} disabled={page === 0} className="rounded-lg border border-[#D0D5DD] px-3 py-2 text-xs font-semibold disabled:opacity-40">이전</button><span className="text-xs text-[#667085]">{pageRows.length ? page * PAGE_SIZE + 1 : 0}–{Math.min((page + 1) * PAGE_SIZE, filteredCandidates.length)} / {filteredCandidates.length}</span><button type="button" onClick={() => setPage(value => Math.min(totalPages - 1, value + 1))} disabled={page + 1 >= totalPages} className="rounded-lg border border-[#D0D5DD] px-3 py-2 text-xs font-semibold disabled:opacity-40">다음</button></div>
    </section>

    <div className="flex items-start gap-2 rounded-xl border border-[#EAECF0] bg-[#F9FAFB] p-3 text-xs leading-5 text-[#475467]"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><p>자동 검색 후보는 실제 답지 여부가 확인되지 않은 외부 검색 결과입니다. 승인 후에도 <strong>검증 상태는 미검증</strong>으로 등록되며, 출판사 공식 출처 여부도 자동으로 단정하지 않습니다.</p></div>
  </div>;

  return renderAdminLayout(content);
}
