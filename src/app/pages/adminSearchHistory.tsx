import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, ArrowDown, ArrowUp, Check, Download, ExternalLink, FileSpreadsheet, RefreshCw, Search, ShieldCheck, X } from 'lucide-react';
import { supabase } from '../../lib/supabase/client';
import { useAppContext } from '../../state/useAppContext';
import { renderAdminLayout } from './admin';

type Run = {
  id: string; status: 'running' | 'paused' | 'completed' | 'failed'; book_ids: string[];
  next_index: number; processed_books: number; candidate_count: number; api_requests: number;
  error_count: number; failed_book_ids: string[]; last_error: string | null;
  started_at: string; finished_at: string | null; provider_mode: string;
  terminal_reason?: string | null; completed_with_warnings?: boolean;
};
type Candidate = {
  id: string; run_id: string | null; book_id: string; title: string; url: string;
  source_name: string | null; link_type: string; source_type: string; query: string;
  snippet: string | null; match_status: 'likely' | 'uncertain' | 'mismatch'; match_score: number;
  match_evidence: { matched_tokens?: string[]; missing_tokens?: string[]; title_ratio?: number; numeric_match?: boolean; answer_signal?: boolean; publisher_match?: boolean; pdf_url?: boolean; source_host?: string };
  status: 'pending' | 'approved' | 'rejected' | 'duplicate' | 'unverified';
  review_note: string | null; reviewed_by: string | null; reviewed_at: string | null;
  created_at: string;
  books: { title: string; publisher: string | null; subject: string | null; grade: string | null; semester: string | null } | null;
};
type QueueItem = {
  id: string; book_id: string; reason: 'new_book' | 'user_request' | 'link_health' | 'manual';
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  priority: number; requested_count: number; retry_count: number; available_at: string;
  last_error: string | null; books: { title: string }[] | null;
};
type Attempt = {
  id: string; run_id: string; book_id: string; provider_mode: string; query: string;
  status: 'succeeded' | 'partial' | 'no_results' | 'failed' | 'filtered_all';
  providers_attempted: string[]; providers_with_results: string[];
  result_count: number; candidate_count: number; filtered_count: number;
  duration_ms: number; warnings: string[]; error_code: string | null; error_message: string | null;
  started_at: string; finished_at: string;
};

const terminalReasonLabel: Record<string, string> = {
  found_candidates: '후보 발견', no_search_results: '검색 결과 없음', all_filtered: '교재 불일치로 제외',
  provider_failures: '검색 출처 장애', partial_provider_failure: '일부 출처 장애', book_failures: '교재 처리 실패',
  cancelled: '취소됨', unknown_legacy: '과거 기록 · 원인 미확인',
};

const statusLabel: Record<Run['status'], string> = {
  running: '진행 중', paused: '일시정지', completed: '완료', failed: '실패',
};
const candidateStatusLabel: Record<Candidate['status'], string> = {
  pending: '검수 대기', approved: '승인', rejected: '거절', duplicate: '중복', unverified: '확인 필요',
};
const errorMessage = (error: unknown) => error instanceof Error ? error.message : '요청을 처리하지 못했습니다.';

function downloadText(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function xmlEscape(value: unknown) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeStoredZip(files: Array<{ name: string; content: string }>) {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let localOffset = 0;
  const w16 = (view: DataView, offset: number, value: number) => view.setUint16(offset, value, true);
  const w32 = (view: DataView, offset: number, value: number) => view.setUint32(offset, value, true);
  for (const file of files) {
    const name = encoder.encode(file.name);
    const data = encoder.encode(file.content);
    const crc = crc32(data);
    const local = new Uint8Array(30 + name.length + data.length);
    const lv = new DataView(local.buffer);
    w32(lv, 0, 0x04034b50); w16(lv, 4, 20); w16(lv, 6, 0); w16(lv, 8, 0);
    w16(lv, 10, 0); w16(lv, 12, 0); w32(lv, 14, crc); w32(lv, 18, data.length);
    w32(lv, 22, data.length); w16(lv, 26, name.length); w16(lv, 28, 0);
    local.set(name, 30); local.set(data, 30 + name.length); localParts.push(local);
    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    w32(cv, 0, 0x02014b50); w16(cv, 4, 20); w16(cv, 6, 20); w16(cv, 8, 0);
    w16(cv, 10, 0); w16(cv, 12, 0); w16(cv, 14, 0); w32(cv, 16, crc);
    w32(cv, 20, data.length); w32(cv, 24, data.length); w16(cv, 28, name.length);
    w16(cv, 30, 0); w16(cv, 32, 0); w16(cv, 34, 0); w16(cv, 36, 0);
    w32(cv, 38, 0); w32(cv, 42, localOffset); central.set(name, 46); centralParts.push(central);
    localOffset += local.length;
  }
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  w32(ev, 0, 0x06054b50); w16(ev, 4, 0); w16(ev, 6, 0);
  w16(ev, 8, files.length); w16(ev, 10, files.length); w32(ev, 12, centralSize);
  w32(ev, 16, localOffset); w16(ev, 20, 0);
  return new Blob([...localParts, ...centralParts, end], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

function downloadXlsx(filename: string, rows: Array<Record<string, unknown>>) {
  const headers = Object.keys(rows[0] ?? { run_id: '', book: '', publisher: '', title: '', url: '', source: '', query: '', match_status: '', status: '', created_at: '', reviewed_at: '' });
  const allRows = [headers, ...rows.map(row => headers.map(header => row[header] ?? ''))];
  const columnName = (index: number) => {
    let value = index + 1; let name = '';
    while (value) { const remainder = (value - 1) % 26; name = String.fromCharCode(65 + remainder) + name; value = Math.floor((value - 1) / 26); }
    return name;
  };
  const sheetRows = allRows.map((row, rowIndex) => '<row r="' + (rowIndex + 1) + '">' + row.map((value, colIndex) => '<c r="' + columnName(colIndex) + (rowIndex + 1) + '" t="inlineStr"><is><t xml:space="preserve">' + xmlEscape(value) + '</t></is></c>').join('') + '</row>').join('');
  const files = [
    { name: '[Content_Types].xml', content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>' },
    { name: '_rels/.rels', content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { name: 'xl/workbook.xml', content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="검색 후보" sheetId="1" r:id="rId1"/></sheets></workbook>' },
    { name: 'xl/_rels/workbook.xml.rels', content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>' },
    { name: 'xl/worksheets/sheet1.xml', content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' + sheetRows + '</sheetData></worksheet>' },
  ];
  const blob = makeStoredZip(files);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function csvCell(value: unknown) {
  const text = String(value ?? '');
  return '"' + text.replace(/"/g, '""') + '"';
}

export function AdminSearchHistoryPage() {
  const { refreshCatalog, navigateTo } = useAppContext();
  const [runs, setRuns] = useState<Run[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [queueItems, setQueueItems] = useState<QueueItem[]>([]);
  const [queueError, setQueueError] = useState('');
  const [queueLoading, setQueueLoading] = useState(false);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [attemptError, setAttemptError] = useState('');
  const [attemptLoading, setAttemptLoading] = useState(false);
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<string[]>([]);
  const [selectedRunId, setSelectedRunId] = useState('all');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('pending');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const since = new Date(Date.now() - 30 * 86400000).toISOString();
    const [runResponse, firstCandidatePage] = await Promise.all([
      supabase.from('answer_link_search_runs').select('*').gte('started_at', since).order('started_at', { ascending: false }).limit(500),
      supabase.from('answer_link_candidates').select('*, books(title,publisher,subject,grade,semester)').order('created_at', { ascending: false }).range(0, 999),
    ]);
    if (runResponse.error || firstCandidatePage.error) {
      setError(runResponse.error?.message ?? firstCandidatePage.error?.message ?? '검색 기록을 불러오지 못했습니다.');
    } else {
      const allCandidates = [...(firstCandidatePage.data ?? [])] as Candidate[];
      for (let offset = 1000; ; offset += 1000) {
        const page = await supabase.from('answer_link_candidates').select('*, books(title,publisher,subject,grade,semester)').order('created_at', { ascending: false }).range(offset, offset + 999);
        if (page.error) { setError(page.error.message); break; }
        allCandidates.push(...(page.data ?? []) as Candidate[]);
        if ((page.data ?? []).length < 1000) break;
      }
      setRuns((runResponse.data ?? []) as Run[]);
      setCandidates(allCandidates);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
    const channel = supabase.channel('admin-search-history-v2')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'answer_link_search_runs' }, () => { void load(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'answer_link_candidates' }, () => { void load(); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [load]);

  const loadQueue = useCallback(async () => {
    setQueueLoading(true);
    setQueueError('');
    const { data, error: queryError } = await supabase.from('answer_link_search_queue')
      .select('id,book_id,reason,status,priority,requested_count,retry_count,available_at,last_error,books(title)')
      .in('status', ['queued', 'running']).order('priority', { ascending: false }).order('created_at', { ascending: true }).limit(200);
    if (queryError) {
      setQueueItems([]);
      setQueueError(queryError.code === '42501' ? '이 계정에는 자동 검색 대기열을 관리할 권한이 없습니다.' : '대기열은 진단 스키마 적용 후 표시됩니다.');
    } else setQueueItems((data ?? []) as QueueItem[]);
    setQueueLoading(false);
  }, []);

  useEffect(() => {
    void loadQueue();
    const channel = supabase.channel('admin-search-queue-v2')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'answer_link_search_queue' }, () => { void loadQueue(); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [loadQueue]);

  const changeQueuePriority = async (item: QueueItem, delta: number) => {
    const nextPriority = Math.max(0, Math.min(1000, item.priority + delta));
    const { error: updateError } = await supabase.from('answer_link_search_queue').update({ priority: nextPriority, updated_at: new Date().toISOString() }).eq('id', item.id);
    if (updateError) setQueueError(updateError.message);
    else await loadQueue();
  };

  useEffect(() => {
    let active = true;
    const loadAttempts = async () => {
      setAttemptLoading(true);
      setAttemptError('');
      let request = supabase.from('answer_link_search_attempts').select('*').order('started_at', { ascending: false }).limit(100);
      if (selectedRunId !== 'all') request = request.eq('run_id', selectedRunId);
      const response = await request;
      if (!active) return;
      if (response.error) {
        setAttempts([]);
        setAttemptError(response.error.message.toLowerCase().includes('permission') || response.error.code === '42501'
          ? '이 계정에는 상세 검색 진단을 조회할 권한이 없습니다.'
          : '상세 진단 로그는 데이터베이스 진단 마이그레이션 적용 후 표시됩니다.');
      } else {
        setAttempts((response.data ?? []) as Attempt[]);
      }
      setAttemptLoading(false);
    };
    void loadAttempts();
    const channel = supabase.channel('admin-search-attempts-' + selectedRunId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'answer_link_search_attempts' }, () => { void loadAttempts(); })
      .subscribe();
    return () => { active = false; void supabase.removeChannel(channel); };
  }, [selectedRunId]);

  const visibleCandidates = useMemo(() => candidates.filter(candidate => {
    if (selectedRunId !== 'all' && candidate.run_id !== selectedRunId) return false;
    if (statusFilter !== 'all' && candidate.status !== statusFilter) return false;
    const haystack = [candidate.title, candidate.url, candidate.source_name, candidate.query, candidate.books?.title, candidate.books?.publisher].filter(Boolean).join(' ').toLocaleLowerCase('ko-KR');
    return !query.trim() || haystack.includes(query.trim().toLocaleLowerCase('ko-KR'));
  }), [candidates, selectedRunId, statusFilter, query]);

  const selectedRun = selectedRunId === 'all' ? null : runs.find(run => run.id === selectedRunId) ?? null;
  const exportRows = () => visibleCandidates.map(candidate => ({
    run_id: candidate.run_id, book: candidate.books?.title ?? '', publisher: candidate.books?.publisher ?? '',
    title: candidate.title, url: candidate.url, source: candidate.source_name ?? '',
    query: candidate.query, match_status: candidate.match_status, status: candidate.status,
    created_at: candidate.created_at, reviewed_at: candidate.reviewed_at ?? '',
  }));
  const exportCsv = () => {
    const rows = exportRows();
    const keys = Object.keys(rows[0] ?? { run_id: '', book: '', publisher: '', title: '', url: '', source: '', query: '', match_status: '', status: '', created_at: '', reviewed_at: '' });
    downloadText('dapjimoum-search-candidates.csv', '\uFEFF' + [keys.map(csvCell).join(','), ...rows.map(row => keys.map(key => csvCell((row as Record<string, unknown>)[key])).join(','))].join('\r\n'), 'text/csv;charset=utf-8');
  };

  const bulkReview = async (action: 'approve' | 'reject') => {
    const targets = visibleCandidates.filter(candidate => selectedCandidateIds.includes(candidate.id) && (candidate.status === 'pending' || candidate.status === 'unverified'));
    if (!targets.length || busyId) return;
    if (!window.confirm('선택한 ' + targets.length + '개 후보를 ' + (action === 'approve' ? '승인하고 사이트에 등록' : '거절') + '할까요?')) return;
    setBusyId('bulk');
    setError('');
    setNotice('');
    let success = 0;
    let duplicates = 0;
    const failures: string[] = [];
    for (const candidate of targets) {
      const result = action === 'approve'
        ? await supabase.rpc('approve_answer_link_candidate', { p_candidate_id: candidate.id })
        : await supabase.rpc('reject_answer_link_candidate', { p_candidate_id: candidate.id, p_review_note: '관리자 일괄 검수에서 거절' });
      if (result.error) failures.push(candidate.title + ': ' + result.error.message);
      else if (action === 'approve' && result.data === 'duplicate') duplicates += 1;
      else success += 1;
    }
    setSelectedCandidateIds([]);
    if (action === 'approve' && success > 0) await refreshCatalog();
    setNotice('처리 완료: ' + success + '개 성공, ' + duplicates + '개 중복' + (failures.length ? ', ' + failures.length + '개 실패' : '') + '.');
    if (failures.length) setError(failures.slice(0, 5).join(' / '));
    await load();
    setBusyId(null);
  };

  const review = async (candidate: Candidate, action: 'approve' | 'reject') => {
    if (busyId) return;
    if (action === 'approve' && !window.confirm('이 후보를 승인하고 공개 답지 링크로 등록할까요? 교재·판본·파일 내용을 확인한 뒤 진행하세요.')) return;
    setBusyId(candidate.id);
    setError('');
    setNotice('');
    try {
      if (action === 'approve') {
        const { data, error: rpcError } = await supabase.rpc('approve_answer_link_candidate', { p_candidate_id: candidate.id });
        if (rpcError) throw rpcError;
        if (data === 'duplicate') setNotice('이미 등록된 링크여서 중복으로 처리했습니다.');
        else {
          const { data: saved, error: verifyError } = await supabase.from('answer_links').select('id').eq('book_id', candidate.book_id).eq('url', candidate.url).maybeSingle();
          if (verifyError) throw verifyError;
          if (!saved) throw new Error('승인 결과를 답지 링크 테이블에서 확인하지 못했습니다.');
          setNotice('답지 링크를 등록했습니다.');
          await refreshCatalog();
        }
      } else {
        const { error: rpcError } = await supabase.rpc('reject_answer_link_candidate', { p_candidate_id: candidate.id, p_review_note: '관리자 검수에서 거절' });
        if (rpcError) throw rpcError;
        setNotice('후보를 거절했습니다.');
      }
      await load();
    } catch (reviewError) {
      setError(errorMessage(reviewError));
    } finally {
      setBusyId(null);
    }
  };

  const pendingCount = candidates.filter(candidate => candidate.status === 'pending' || candidate.status === 'unverified').length;
  const zeroCandidateRun = selectedRun && selectedRun.status === 'completed' && selectedRun.candidate_count === 0;

  return renderAdminLayout(
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div><p className="text-xs font-semibold text-[#667085]">답지 자동 검색</p><h2 className="mt-1 text-2xl font-extrabold text-[#191F28]">실행 기록과 전체 후보</h2><p className="mt-1 text-sm text-[#667085]">실행별 후보를 분리해 확인하거나 전체 실행의 후보를 한곳에서 검수합니다.</p></div>
        <div className="flex flex-wrap gap-2"><button type="button" onClick={() => void load()} disabled={loading} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-[#D0D5DD] bg-white px-3 text-sm font-semibold text-[#344054]"><RefreshCw className="h-4 w-4" />새로고침</button><button type="button" onClick={() => navigateTo('/admin/link-search')} className="min-h-10 rounded-xl bg-[#191F28] px-4 text-sm font-bold text-white">새 검색 실행</button></div>
      </div>

      {error && <div role="alert" className="flex items-start gap-2 rounded-xl border border-[#FDD8D5] bg-[#FFEEEC] p-3 text-sm text-[#B42318]"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{error}</div>}
      {notice && <p role="status" className="rounded-xl border border-[#D0D5DD] bg-[#F9FAFB] p-3 text-sm text-[#344054]">{notice}</p>}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-2xl border border-[#E5E8EB] bg-white p-4"><p className="text-xs text-[#667085]">최근 30일 실행</p><p className="mt-1 text-2xl font-extrabold tabular-nums">{runs.length}</p></div>
        <div className="rounded-2xl border border-[#E5E8EB] bg-white p-4"><p className="text-xs text-[#667085]">전체 후보</p><p className="mt-1 text-2xl font-extrabold tabular-nums">{candidates.length}</p></div>
        <div className="rounded-2xl border border-[#E5E8EB] bg-white p-4"><p className="text-xs text-[#667085]">검수 대기</p><p className="mt-1 text-2xl font-extrabold tabular-nums">{pendingCount}</p></div>
        <div className="rounded-2xl border border-[#E5E8EB] bg-white p-4"><p className="text-xs text-[#667085]">실패 교재</p><p className="mt-1 text-2xl font-extrabold tabular-nums">{runs.reduce((sum, run) => sum + run.failed_book_ids.length, 0)}</p></div>
      </div>

      <section className="rounded-2xl border border-[#E5E8EB] bg-white p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-bold text-[#191F28]">검색 실행 기록</h3><p className="mt-1 text-xs text-[#667085]">최근 30일 기록 · 실행을 선택하면 해당 실행에서 발견한 후보만 표시됩니다.</p></div><button type="button" onClick={() => setSelectedRunId('all')} className="min-h-9 rounded-lg border border-[#D0D5DD] px-3 text-xs font-semibold">전체 후보 보기</button></div>
        {loading ? <p className="py-8 text-center text-sm text-[#667085]">기록을 불러오는 중입니다.</p> : runs.length === 0 ? <p className="mt-4 rounded-xl bg-[#F9FAFB] p-6 text-center text-sm text-[#667085]">최근 30일 내 검색 실행 기록이 없습니다.</p> : <div className="mt-4 grid gap-2 lg:grid-cols-2">{runs.map(run => {
          const progress = run.book_ids.length ? Math.min(100, Math.round(run.processed_books / run.book_ids.length * 100)) : 100;
          const isSelected = selectedRunId === run.id;
          return <button type="button" key={run.id} onClick={() => setSelectedRunId(run.id)} aria-pressed={isSelected} className={'rounded-xl border p-3 text-left transition-colors ' + (isSelected ? 'border-[#344054] bg-[#F2F4F6]' : 'border-[#EAECF0] bg-white hover:bg-[#F9FAFB]')}>
            <div className="flex items-start justify-between gap-2"><div><p className="text-sm font-bold text-[#191F28]">{new Date(run.started_at).toLocaleString('ko-KR')}</p><p className="mt-1 text-xs text-[#667085]">{run.book_ids.length.toLocaleString()}개 교재 · {run.provider_mode}</p></div><span className="rounded-full bg-[#F2F4F6] px-2.5 py-1 text-xs font-semibold text-[#344054]">{statusLabel[run.status]}</span></div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#EAECF0]"><div className="h-full rounded-full bg-[#475467]" style={{ width: progress + '%' }} /></div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[#475467]"><span>처리 {run.processed_books}/{run.book_ids.length}</span><span>후보 {run.candidate_count}</span><span>요청 {run.api_requests}</span><span>오류 {run.error_count}</span></div>
            {run.last_error && <p className="mt-2 line-clamp-2 break-words text-xs text-[#B42318]">마지막 오류: {run.last_error}</p>}
          </button>;
        })}</div>}
      </section>

      <section className="space-y-3 rounded-2xl border border-[#E5E8EB] bg-white p-4 sm:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div><p className="text-xs font-semibold text-[#667085]">{selectedRun ? '선택한 실행' : '통합 보기'}</p><h3 className="mt-1 text-lg font-extrabold text-[#191F28]">{selectedRun ? new Date(selectedRun.started_at).toLocaleString('ko-KR') : '전체 실행의 후보'}</h3><p className="mt-1 text-xs text-[#667085]">{selectedRun ? '이 실행에서 수집된 후보만 표시합니다.' : '최근 실행에서 수집된 후보를 통합해 표시합니다.'}</p></div>
          <div className="grid grid-cols-3 gap-2 sm:flex"><button type="button" onClick={exportCsv} disabled={!visibleCandidates.length} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-[#D0D5DD] px-3 text-xs font-semibold disabled:opacity-40"><Download className="h-4 w-4" />CSV</button><button type="button" onClick={() => downloadXlsx('dapjimoum-search-candidates.xlsx', exportRows())} disabled={!visibleCandidates.length} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-[#D0D5DD] px-3 text-xs font-semibold disabled:opacity-40"><FileSpreadsheet className="h-4 w-4" />Excel</button><button type="button" onClick={() => downloadText('dapjimoum-search-candidates.json', JSON.stringify(exportRows(), null, 2), 'application/json;charset=utf-8')} disabled={!visibleCandidates.length} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-[#D0D5DD] px-3 text-xs font-semibold disabled:opacity-40"><Download className="h-4 w-4" />JSON</button></div>
        </div>

        {zeroCandidateRun && <div className="rounded-xl border border-[#FDE2B8] bg-[#FFFAEB] p-3"><p className="text-sm font-bold text-[#93370D]">이 실행은 후보 0개로 종료되었습니다.</p><p className="mt-1 text-xs leading-5 text-[#93370D]">종료 판정: {selectedRun.terminal_reason ? terminalReasonLabel[selectedRun.terminal_reason] ?? selectedRun.terminal_reason : '과거 실행이라 원인 진단 기록이 없습니다.'}</p>{selectedRun.last_error && <p className="mt-2 break-words text-xs text-[#93370D]">저장된 오류: {selectedRun.last_error}</p>}</div>}

        <section className="rounded-xl border border-[#EAECF0] bg-[#F9FAFB] p-3">
          <div className="flex items-center justify-between gap-2"><div><h4 className="text-sm font-bold text-[#344054]">출처별 검색 진단</h4><p className="mt-1 text-xs text-[#667085]">{selectedRun ? '선택한 실행의 검색 쿼리와 출처 응답' : '최근 검색 시도의 출처별 진단'}</p></div><span className="text-xs text-[#667085]">{attempts.length}건</span></div>
          {attemptLoading ? <p className="py-4 text-xs text-[#667085]">진단 로그를 불러오는 중입니다.</p> : attemptError ? <p className="py-4 text-xs text-[#667085]">{attemptError}</p> : attempts.length === 0 ? <p className="py-4 text-xs text-[#667085]">저장된 검색 시도 진단이 없습니다.</p> : <div className="mt-3 space-y-2">{attempts.map(attempt => <article key={attempt.id} className="rounded-lg border border-[#EAECF0] bg-white p-3"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs font-semibold text-[#344054]">{attempt.status === 'succeeded' ? '성공' : attempt.status === 'partial' ? '일부 성공' : attempt.status === 'no_results' ? '검색 결과 없음' : attempt.status === 'filtered_all' ? '교재 불일치로 모두 제외' : '검색 실패'} · {attempt.provider_mode}</p><span className="text-xs tabular-nums text-[#667085]">{attempt.duration_ms}ms</span></div><p className="mt-1 break-words text-xs text-[#475467]">{attempt.query}</p><p className="mt-1 text-xs text-[#667085]">결과 {attempt.result_count} · 후보 일치 {attempt.candidate_count} · 제외 {attempt.filtered_count}</p><p className="mt-1 break-words text-xs text-[#667085]">시도 출처: {(attempt.providers_attempted ?? []).join(', ') || '확인 불가'} · 결과 출처: {(attempt.providers_with_results ?? []).join(', ') || '없음'}</p>{attempt.error_message && <p className="mt-1 break-words text-xs text-[#B42318]">{attempt.error_code ? '[' + attempt.error_code + '] ' : ''}{attempt.error_message}</p>}</article>)}</div>}
        </section>

        <section className="rounded-xl border border-[#EAECF0] bg-[#F9FAFB] p-3">
          <div className="flex flex-wrap items-center justify-between gap-2"><div><h4 className="text-sm font-bold text-[#344054]">자동 검색 대기열</h4><p className="mt-1 text-xs text-[#667085]">새 교재·사용자 요청·링크 오류가 우선순위에 따라 처리됩니다.</p></div><span className="text-xs text-[#667085]">{queueItems.length}건</span></div>
          {queueLoading ? <p className="py-4 text-xs text-[#667085]">대기열을 불러오는 중입니다.</p> : queueError ? <p className="py-4 text-xs text-[#667085]">{queueError}</p> : queueItems.length === 0 ? <p className="py-4 text-xs text-[#667085]">현재 대기 중인 교재가 없습니다.</p> : <div className="mt-3 space-y-2">{queueItems.map(item => <article key={item.id} className="flex flex-col gap-2 rounded-lg border border-[#EAECF0] bg-white p-3 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><p className="truncate text-xs font-bold text-[#344054]">{item.books?.[0]?.title ?? item.book_id}</p><p className="mt-1 text-xs text-[#667085]">{item.reason === 'new_book' ? '새 교재' : item.reason === 'user_request' ? '사용자 요청' : item.reason === 'link_health' ? '답지 링크 오류' : '관리자 요청'} · 요청 {item.requested_count}회 · 재시도 {item.retry_count}회 · {item.status === 'running' ? '진행 중' : '대기'}</p>{item.last_error && <p className="mt-1 break-words text-xs text-[#B42318]">{item.last_error}</p>}</div><div className="flex items-center gap-2"><span className="min-w-16 text-right text-xs font-bold tabular-nums text-[#344054]">우선순위 {item.priority}</span>{item.status === 'queued' && <><button type="button" onClick={() => void changeQueuePriority(item, 10)} aria-label="우선순위 높이기" className="grid h-9 w-9 place-items-center rounded-lg border border-[#D0D5DD]"><ArrowUp className="h-4 w-4" /></button><button type="button" onClick={() => void changeQueuePriority(item, -10)} aria-label="우선순위 낮추기" className="grid h-9 w-9 place-items-center rounded-lg border border-[#D0D5DD]"><ArrowDown className="h-4 w-4" /></button></>}</div></article>)}</div>}
        </section>

        <div className="grid gap-2 sm:grid-cols-[1fr_190px]"><label className="relative"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#98A2B3]" /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="교재명·후보 제목·URL 검색" className="min-h-11 w-full rounded-lg border border-[#D0D5DD] pl-9 pr-3 text-sm outline-none focus:border-[#667085]" /></label><select value={statusFilter} onChange={event => setStatusFilter(event.target.value)} className="min-h-11 rounded-lg border border-[#D0D5DD] px-3 text-sm"><option value="pending">검수 대기</option><option value="all">모든 상태</option><option value="approved">승인</option><option value="rejected">거절</option><option value="duplicate">중복</option><option value="unverified">확인 필요</option></select></div>

        <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs text-[#667085]">표시 후보 {visibleCandidates.length}개 · 선택 {selectedCandidateIds.length}개</p><div className="flex gap-2"><button type="button" onClick={() => void bulkReview('approve')} disabled={busyId !== null || !selectedCandidateIds.some(id => visibleCandidates.some(candidate => candidate.id === id && (candidate.status === 'pending' || candidate.status === 'unverified')))} className="min-h-9 rounded-lg bg-[#191F28] px-3 text-xs font-bold text-white disabled:opacity-40">선택 승인·등록</button><button type="button" onClick={() => void bulkReview('reject')} disabled={busyId !== null || !selectedCandidateIds.some(id => visibleCandidates.some(candidate => candidate.id === id && (candidate.status === 'pending' || candidate.status === 'unverified')))} className="min-h-9 rounded-lg border border-[#D0D5DD] px-3 text-xs font-semibold disabled:opacity-40">선택 거절</button></div></div>
        {loading ? <p className="py-8 text-center text-sm text-[#667085]">후보를 불러오는 중입니다.</p> : visibleCandidates.length === 0 ? <div className="rounded-xl border border-dashed border-[#D0D5DD] bg-[#F9FAFB] p-8 text-center"><p className="text-sm font-semibold text-[#344054]">조건에 맞는 후보가 없습니다.</p><p className="mt-1 text-xs text-[#667085]">{selectedRun ? '이 실행에서는 저장된 후보가 발견되지 않았습니다.' : '선택한 상태나 검색어에 해당하는 후보가 없습니다.'}</p></div> : <div className="space-y-3">{visibleCandidates.map(candidate => <article key={candidate.id} className="rounded-xl border border-[#EAECF0] p-3 sm:p-4">
          {(candidate.status === 'pending' || candidate.status === 'unverified') && <label className="mb-2 inline-flex items-center gap-2 text-xs text-[#475467]"><input type="checkbox" checked={selectedCandidateIds.includes(candidate.id)} onChange={event => setSelectedCandidateIds(ids => event.target.checked ? [...new Set([...ids, candidate.id])] : ids.filter(id => id !== candidate.id))} />이 후보 선택</label>}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0 flex-1"><p className="text-sm font-bold text-[#191F28]">{candidate.books?.title ?? '교재 정보 없음'}</p><p className="mt-1 text-xs text-[#667085]">{[candidate.books?.publisher,candidate.books?.subject,candidate.books?.grade,candidate.books?.semester].filter(Boolean).join(' · ')}</p><a href={candidate.url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex break-all text-sm font-semibold text-[#344054] underline">{candidate.title} <ExternalLink className="ml-1 h-3 w-3 shrink-0" /></a><p className="mt-1 break-all text-xs text-[#667085]">{candidate.url}</p>{candidate.snippet && <p className="mt-2 text-xs leading-5 text-[#475467]">{candidate.snippet}</p>}<p className="mt-2 break-words text-xs text-[#667085]">출처: {candidate.source_name ?? '미확인'} · 검색어: {candidate.query}</p>
            <p className="mt-1 break-words text-xs text-[#667085]">일치 근거: {(candidate.match_evidence?.matched_tokens ?? []).join(', ') || '일치 토큰 없음'} · 누락: {(candidate.match_evidence?.missing_tokens ?? []).join(', ') || '없음'}</p></div>
            <div className="flex shrink-0 flex-wrap items-center gap-2"><span className="rounded-full bg-[#F2F4F6] px-2.5 py-1 text-xs font-semibold text-[#344054]">{candidateStatusLabel[candidate.status]}</span><span className="rounded-full bg-[#F9FAFB] px-2.5 py-1 text-xs text-[#475467]">{candidate.match_status === 'likely' ? '일치 가능성 높음' : candidate.match_status === 'mismatch' ? '불일치 가능' : '추가 검수 필요'}</span><span className="rounded-full bg-[#F9FAFB] px-2.5 py-1 text-xs tabular-nums text-[#475467]">점수 {candidate.match_score ?? 0}/100</span></div></div>
          {(candidate.status === 'pending' || candidate.status === 'unverified') && <div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => void review(candidate, 'approve')} disabled={busyId === candidate.id} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-[#191F28] px-3 text-xs font-bold text-white disabled:opacity-50">{busyId === candidate.id ? '처리 중…' : <><Check className="h-4 w-4" />승인하고 사이트에 등록</>}</button><button type="button" onClick={() => void review(candidate, 'reject')} disabled={busyId === candidate.id} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-[#D0D5DD] px-3 text-xs font-semibold text-[#344054] disabled:opacity-50"><X className="h-4 w-4" />거절</button></div>}
          {candidate.review_note && <p className="mt-2 text-xs text-[#667085]">검수 메모: {candidate.review_note}</p>}
          {candidate.reviewed_at && <p className="mt-2 text-xs text-[#667085]">검수 시각: {new Date(candidate.reviewed_at).toLocaleString('ko-KR')}</p>}
        </article>)}</div>}
      </section>
      <div className="flex items-start gap-2 rounded-xl border border-[#EAECF0] bg-[#F9FAFB] p-3 text-xs leading-5 text-[#475467]"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" /><p>후보는 승인 전까지 공개 답지 링크에 반영되지 않습니다. 승인 시 기존 답지 등록 RPC와 중복 URL 검사를 사용합니다. 이 화면은 기존 데이터와 기존 검수 이력을 그대로 읽습니다.</p></div>
    </div>
  );
}
