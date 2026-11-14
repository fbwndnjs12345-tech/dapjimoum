import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, BookOpen, ExternalLink, LoaderCircle, Pause, Play, RefreshCw, Search } from 'lucide-react';
import { useAppContext } from '../../state/useAppContext';
import { supabase } from '../../lib/supabase/client';
import { renderAdminLayout } from './admin';

type Run = {
  created_by: string; id: string; status: 'running' | 'paused' | 'completed' | 'failed';
  book_ids: string[]; next_index: number; processed_books: number; candidate_count: number;
  api_requests: number; error_count: number; failed_book_ids: string[]; last_error: string | null;
  started_at: string; finished_at: string | null;
  provider_mode: 'naver' | 'kakao' | 'web' | 'combined'; terminal_reason?: string | null;
};

const runStatusLabel: Record<Run['status'], string> = {
  running: '진행 중', paused: '일시정지', completed: '완료', failed: '실패',
};

const errorText = (error: unknown) => error instanceof Error ? error.message : '요청을 처리하지 못했습니다.';
const wait = (ms: number) => new Promise(resolve => window.setTimeout(resolve, ms));

export function AdminLinkSearchPage() {
  const { books, refreshCatalog, navigateTo } = useAppContext();
  const [runs, setRuns] = useState<Run[]>([]);
  const [selectedBookIds, setSelectedBookIds] = useState<string[]>([]);
  const [bookSearch, setBookSearch] = useState('');
  const [includeBooksWithLinks, setIncludeBooksWithLinks] = useState(false);
  const [providerMode, setProviderMode] = useState<'naver' | 'kakao' | 'web' | 'combined' | 'local'>('combined');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [busyRunActionId, setBusyRunActionId] = useState<string | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const pumpGuard = useRef(false);

  const loadRuns = useCallback(async () => {
    setLoading(true);
    setError('');
    const since = new Date(Date.now() - 30 * 86400000).toISOString();
    const { data, error: queryError } = await supabase.from('answer_link_search_runs')
      .select('*').gte('started_at', since).order('started_at', { ascending: false }).limit(200);
    if (queryError) setError(queryError.message);
    else setRuns((data ?? []) as Run[]);
    setLoading(false);
  }, []);

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
    setNotice('검색 작업을 처리하고 있습니다. 실행 기록은 서버에 저장됩니다.');
    try {
      while (true) {
        const result = await invoke({ action: 'batch', runId });
        const { data: latest, error: runError } = await supabase.from('answer_link_search_runs').select('*').eq('id', runId).single();
        if (runError) throw runError;
        const current = latest as Run;
        setRuns(previous => [current, ...previous.filter(run => run.id !== current.id)]);
        if (current.status !== 'running') {
          setNotice(current.status === 'completed' ? '검색 작업이 완료되었습니다.' : current.status === 'paused' ? '검색 작업이 일시정지되었습니다.' : '검색 작업이 실패 상태로 종료되었습니다.');
          break;
        }
        if (result.busy) {
          await wait(1200);
          continue;
        }
        if (result.errors?.length) setError(result.errors.join('\n'));
        if (result.done || current.next_index >= current.book_ids.length) break;
      }
      await Promise.all([loadRuns(), refreshCatalog()]);
    } catch (runError) {
      setError(errorText(runError));
      setNotice('검색 작업이 중단되었습니다. 오류 내용을 확인한 뒤 이어서 실행하거나 실패 교재를 재시도할 수 있습니다.');
      try { await invoke({ action: 'pause', runId, reason: errorText(runError) }); } catch { /* Preserve the original error. */ }
    } finally {
      pumpGuard.current = false;
      setBusy(false);
      setActiveRunId(null);
      await loadRuns();
    }
  }, [invoke, loadRuns, refreshCatalog]);

  useEffect(() => {
    void loadRuns();
    const channel = supabase.channel('admin-search-run-workspace-v2')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'answer_link_search_runs' }, () => { void loadRuns(); })
      .subscribe();
    const timer = window.setInterval(() => { void loadRuns(); }, 10000);
    return () => {
      window.clearInterval(timer);
      void supabase.removeChannel(channel);
    };
  }, [loadRuns]);

  useEffect(() => {
    const active = runs.find(run => run.status === 'running');
    if (active && !pumpGuard.current) void runBatches(active.id);
  }, [runs, runBatches]);

  const selectableBooks = useMemo(() => books.filter(book => {
    if (!bookSearch.trim()) return false;
    const haystack = [book.title, book.publisher, book.subject, book.grade, book.semester, book.series].filter(Boolean).join(' ').toLocaleLowerCase('ko-KR');
    return haystack.includes(bookSearch.trim().toLocaleLowerCase('ko-KR'));
  }).slice(0, 12), [books, bookSearch]);

  const startSearch = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      if (providerMode === 'local') {
        window.open('https://github.com/fbwndnjs12345-tech/dapjimoum/actions/runs/43584387790', '_blank', 'noopener,noreferrer');
        setNotice("Windows 로컬 탐색기 다운로드 기록을 열었습니다. 실행 기록의 Artifacts에서 '답지모음-로컬-탐색기-Windows'를 내려받으세요. 수집 후보는 관리자 검수함에서 확인할 수 있습니다.");
        setBusy(false);
        return;
      }
      const result = await invoke({ action: 'start', includeBooksWithLinks, selectedBookIds, providerMode });
      await loadRuns();
      const newRun = result.run as Run | null;
      if (!newRun || newRun.book_ids.length === 0) {
        setNotice('검색할 교재가 없습니다. 교재 선택과 기존 답지 포함 설정을 확인해 주세요.');
        setBusy(false);
        return;
      }
      void runBatches(newRun.id);
    } catch (startError) {
      setError(errorText(startError));
      setBusy(false);
    }
  };

  const pauseSearch = async (run: Run) => {
    setBusyRunActionId(run.id);
    try {
      await invoke({ action: 'pause', runId: run.id });
      setNotice('검색 작업을 일시정지했습니다. 이미 저장된 결과는 유지됩니다.');
      await loadRuns();
    } catch (pauseError) {
      setError(errorText(pauseError));
    } finally {
      setBusyRunActionId(null);
    }
  };

  const resumeSearch = async (run: Run) => {
    setBusyRunActionId(run.id);
    try {
      await invoke({ action: 'resume', runId: run.id });
      setNotice('저장된 진행 위치부터 검색을 재개합니다.');
      await loadRuns();
      void runBatches(run.id);
    } catch (resumeError) {
      setError(errorText(resumeError));
    } finally {
      setBusyRunActionId(null);
    }
  };

  const retryFailed = async (run: Run) => {
    setBusyRunActionId(run.id);
    try {
      const result = await invoke({ action: 'retry', runId: run.id });
      await loadRuns();
      if (result.run?.id) void runBatches(result.run.id);
    } catch (retryError) {
      setError(errorText(retryError));
    } finally {
      setBusyRunActionId(null);
    }
  };

  const liveRun = runs.find(run => run.id === activeRunId) ?? runs.find(run => run.status === 'running') ?? null;
  const progress = liveRun?.book_ids.length ? Math.min(100, Math.round(liveRun.processed_books / liveRun.book_ids.length * 100)) : 0;
  const pendingRunCount = runs.filter(run => run.status === 'running' || run.status === 'paused').length;

  return renderAdminLayout(
    <div className="mx-auto max-w-6xl space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div><p className="text-xs font-semibold text-[#667085]">답지 자동 수집</p><h2 className="mt-1 text-2xl font-extrabold text-[#191F28]">검색 실행</h2><p className="mt-1 text-sm text-[#667085]">교재를 선택하거나 전체 교재를 검색합니다. 수집된 후보는 별도 검수함에서 승인해야 사이트에 등록됩니다.</p></div>
        <button type="button" onClick={() => navigateTo('/admin/search-history')} className="min-h-10 rounded-xl border border-[#D0D5DD] bg-white px-4 text-sm font-semibold text-[#344054]">검색 기록·후보 검수</button>
      </header>

      {error && <div role="alert" className="flex items-start gap-2 whitespace-pre-wrap rounded-xl border border-[#FDD8D5] bg-[#FFEEEC] p-3 text-sm text-[#B42318]"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{error}</div>}
      {notice && <p role="status" className="rounded-xl border border-[#EAECF0] bg-[#F9FAFB] p-3 text-sm text-[#344054]">{notice}</p>}

      <section className="rounded-2xl border border-[#E5E8EB] bg-white p-4 sm:p-6">
        <div className="flex items-center justify-between gap-2"><div><h3 className="font-bold text-[#191F28]">1. 검색 범위</h3><p className="mt-1 text-xs text-[#667085]">교재를 고르지 않으면 답지가 없는 전체 교재를 검색합니다.</p></div><span className="text-xs text-[#667085]">{selectedBookIds.length ? selectedBookIds.length + '권 선택' : '전체 대상'}</span></div>
        <div className="mt-4 space-y-3">
          <label className="relative block"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#98A2B3]" /><input value={bookSearch} onChange={event => setBookSearch(event.target.value)} placeholder="교재명 또는 출판사 검색" className="min-h-11 w-full rounded-xl border border-[#D0D5DD] pl-9 pr-3 text-sm outline-none focus:border-[#667085]" /></label>
          {selectableBooks.length > 0 && <div className="max-h-60 overflow-auto rounded-xl border border-[#EAECF0]">{selectableBooks.map(book => <button key={book.id} type="button" onClick={() => setSelectedBookIds(ids => ids.includes(book.id) ? ids.filter(id => id !== book.id) : [...ids, book.id])} className="flex min-h-11 w-full items-center justify-between gap-3 border-b border-[#F2F4F6] px-3 py-2 text-left text-sm last:border-0 hover:bg-[#F9FAFB]"><span className="min-w-0"><strong className="block truncate text-[#344054]">{book.title}</strong><span className="text-xs text-[#667085]">{[book.publisher,book.subject,book.grade,book.semester].filter(Boolean).join(' · ')}</span></span><span className="shrink-0 text-xs font-semibold text-[#475467]">{selectedBookIds.includes(book.id) ? '선택됨' : '선택'}</span></button>)}</div>}
          {selectedBookIds.length > 0 && <div className="flex flex-wrap gap-2">{selectedBookIds.map(id => { const book = books.find(item => item.id === id); return <button type="button" key={id} onClick={() => setSelectedBookIds(ids => ids.filter(value => value !== id))} className="rounded-full border border-[#D0D5DD] bg-[#F9FAFB] px-3 py-1.5 text-xs font-semibold text-[#344054]">{book?.title ?? id} ×</button>; })}<button type="button" onClick={() => setSelectedBookIds([])} className="px-2 text-xs font-semibold text-[#667085] underline">선택 초기화</button></div>}
          <label className="flex items-start gap-2 rounded-xl border border-[#EAECF0] p-3 text-xs text-[#475467]"><input type="checkbox" checked={includeBooksWithLinks} onChange={event => setIncludeBooksWithLinks(event.target.checked)} className="mt-0.5 h-4 w-4 accent-[#191F28]" /><span><strong className="block text-[#344054]">기존 답지 링크가 있는 교재도 다시 검색</strong><span className="mt-1 block">기본값은 답지가 없는 교재만 검색합니다. 링크 보완이 필요할 때만 켜세요.</span></span></label>
        </div>
      </section>

      <section className="rounded-2xl border border-[#E5E8EB] bg-white p-4 sm:p-6">
        <h3 className="font-bold text-[#191F28]">2. 검색 출처</h3>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {[
            { value: 'combined', label: '통합 검색', detail: '공개 웹 + 설정된 네이버·카카오 API' },
            { value: 'web', label: '공개 웹 검색', detail: 'Google·Bing·DuckDuckGo 공개 검색 결과' },
            { value: 'naver', label: '네이버 API', detail: '네이버 블로그·카페 검색' },
            { value: 'kakao', label: '카카오 API', detail: '카카오 블로그·카페·웹 검색' },
            { value: 'local', label: 'Windows 로컬 탐색기', detail: '현재 배포된 Windows 프로그램 다운로드' },
          ].map(option => <button key={option.value} type="button" onClick={() => setProviderMode(option.value as typeof providerMode)} className={'rounded-xl border p-3 text-left ' + (providerMode === option.value ? 'border-[#344054] bg-[#F2F4F6]' : 'border-[#EAECF0] bg-white hover:bg-[#F9FAFB]')}><p className="text-sm font-bold text-[#344054]">{option.label}</p><p className="mt-1 text-xs leading-5 text-[#667085]">{option.detail}</p></button>)}
        </div>
        <p className="mt-3 rounded-xl bg-[#F9FAFB] p-3 text-xs leading-5 text-[#667085]">검색 서비스의 API 키·호출 한도·접근 제한에 따라 결과가 달라질 수 있습니다. 통합 검색은 설정된 경로가 실패해도 나머지 경로를 계속 사용하고, 실패 원인을 실행 진단에 기록합니다.</p>
      </section>

      <section className="rounded-2xl border border-[#E5E8EB] bg-white p-4 sm:p-6">
        <h3 className="font-bold text-[#191F28]">3. 검색 실행</h3>
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><p className="text-sm text-[#667085]">{selectedBookIds.length ? '선택한 교재 ' + selectedBookIds.length + '권을 검색합니다.' : '답지가 없는 전체 교재를 검색합니다.'}</p><button type="button" onClick={() => void startSearch()} disabled={busy || pendingRunCount > 0} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[#191F28] px-5 text-sm font-bold text-white disabled:opacity-40"><Play className="h-4 w-4" />{busy ? '검색 준비 중…' : '검색 시작'}</button></div>
        {pendingRunCount > 0 && <p className="mt-3 text-xs text-[#667085]">진행 중이거나 일시정지된 작업이 있습니다. 중복 실행을 방지하기 위해 새 검색을 잠시 막았습니다.</p>}
      </section>

      {liveRun && <section className="rounded-2xl border border-[#D0D5DD] bg-[#F9FAFB] p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-bold text-[#191F28]">현재 검색 진행 상황</h3><p className="mt-1 text-xs text-[#667085]">시작 {new Date(liveRun.started_at).toLocaleString('ko-KR')}</p></div><span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-[#344054]">{runStatusLabel[liveRun.status]}</span></div>
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-[#E5E8EB]"><div className="h-full rounded-full bg-[#344054] transition-all" style={{ width: progress + '%' }} /></div>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4"><div><p className="text-xs text-[#667085]">진행률</p><p className="mt-1 text-xl font-extrabold tabular-nums">{progress}%</p></div><div><p className="text-xs text-[#667085]">처리 교재</p><p className="mt-1 text-xl font-extrabold tabular-nums">{liveRun.processed_books}/{liveRun.book_ids.length}</p></div><div><p className="text-xs text-[#667085]">발견 후보</p><p className="mt-1 text-xl font-extrabold tabular-nums">{liveRun.candidate_count}</p></div><div><p className="text-xs text-[#667085]">검색 요청·오류</p><p className="mt-1 text-xl font-extrabold tabular-nums">{liveRun.api_requests} / {liveRun.error_count}</p></div></div>
        {liveRun.last_error && <p className="mt-3 break-words rounded-lg bg-white p-3 text-xs text-[#B42318]">최근 오류: {liveRun.last_error}</p>}
        <div className="mt-4 flex flex-wrap gap-2">{liveRun.status === 'running' && <button type="button" onClick={() => void pauseSearch(liveRun)} disabled={busyRunActionId === liveRun.id} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-[#D0D5DD] bg-white px-3 text-xs font-semibold text-[#344054] disabled:opacity-40"><Pause className="h-4 w-4" />일시정지</button>}{liveRun.status === 'paused' && <button type="button" onClick={() => void resumeSearch(liveRun)} disabled={busyRunActionId === liveRun.id} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-[#191F28] px-3 text-xs font-bold text-white disabled:opacity-40"><Play className="h-4 w-4" />이어하기</button>}{liveRun.failed_book_ids.length > 0 && <button type="button" onClick={() => void retryFailed(liveRun)} disabled={busyRunActionId === liveRun.id} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-[#D0D5DD] bg-white px-3 text-xs font-semibold text-[#344054] disabled:opacity-40"><RefreshCw className="h-4 w-4" />실패 교재 재검색</button>}</div>
        {busy && <p className="mt-3 flex items-center gap-2 text-xs text-[#667085]"><LoaderCircle className="h-4 w-4 animate-spin" />현재 탭이 검색 배치를 처리하고 있습니다. 서버 예약 작업도 같은 실행 기록을 이어받을 수 있습니다.</p>}
      </section>}

      <section className="rounded-2xl border border-[#E5E8EB] bg-white p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-bold text-[#191F28]">최근 검색 실행 기록</h3><p className="mt-1 text-xs text-[#667085]">최근 30일 · {runs.length}건</p></div><button type="button" onClick={() => void loadRuns()} disabled={loading} className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-[#D0D5DD] px-3 text-xs font-semibold text-[#344054] disabled:opacity-40"><RefreshCw className="h-3.5 w-3.5" />새로고침</button></div>
        {loading ? <p className="py-8 text-center text-sm text-[#667085]">실행 기록을 불러오는 중입니다.</p> : runs.length === 0 ? <p className="py-8 text-center text-sm text-[#667085]">최근 30일 내 실행 기록이 없습니다.</p> : <div className="mt-3 space-y-2">{runs.slice(0, 20).map(run => <article key={run.id} className="rounded-xl border border-[#EAECF0] p-3"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-bold text-[#191F28]">{new Date(run.started_at).toLocaleString('ko-KR')}</p><span className="rounded-full bg-[#F2F4F6] px-2 py-1 text-xs font-semibold text-[#475467]">{runStatusLabel[run.status]}</span></div><p className="mt-1 text-xs text-[#667085]">{run.book_ids.length}권 · 처리 {run.processed_books} · 후보 {run.candidate_count} · 요청 {run.api_requests} · 실패 {run.error_count}</p>{run.last_error && <p className="mt-1 break-words text-xs text-[#B42318]">{run.last_error}</p>}</div><div className="flex flex-wrap gap-2">{run.status === 'paused' && <button type="button" onClick={() => void resumeSearch(run)} disabled={busyRunActionId === run.id || busy} className="min-h-9 rounded-lg border border-[#D0D5DD] px-3 text-xs font-semibold disabled:opacity-40">이어하기</button>}{run.status === 'running' && <button type="button" onClick={() => void pauseSearch(run)} disabled={busyRunActionId === run.id} className="min-h-9 rounded-lg border border-[#D0D5DD] px-3 text-xs font-semibold disabled:opacity-40">일시정지</button>}{run.failed_book_ids.length > 0 && <button type="button" onClick={() => void retryFailed(run)} disabled={busyRunActionId === run.id || busy} className="min-h-9 rounded-lg border border-[#D0D5DD] px-3 text-xs font-semibold disabled:opacity-40">실패 재검색</button>}</div></div></article>)}</div>}
        <button type="button" onClick={() => navigateTo('/admin/search-history')} className="mt-4 inline-flex min-h-10 items-center gap-2 text-xs font-bold text-[#344054] underline">전체 실행 기록과 후보 검수함 열기 <ExternalLink className="h-3.5 w-3.5" /></button>
      </section>

      <p className="rounded-xl border border-[#EAECF0] bg-[#F9FAFB] p-3 text-xs leading-5 text-[#667085]">검색 결과는 후보로만 저장됩니다. 실제 답지인지 확인한 뒤 검수함에서 승인해야 공개 교재 페이지에 반영됩니다. 자동 검색은 서버 예약 작업이 구성된 경우 브라우저를 닫아도 이어집니다.</p>
    </div>
  );
}
