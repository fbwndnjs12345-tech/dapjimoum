import { useCallback, useEffect, useState } from 'react';
import { Activity, AlertCircle, RefreshCw, ShieldCheck } from 'lucide-react';
import { supabase } from '../../lib/supabase/client';
import { renderAdminLayout } from './admin';

type ActivityEvent = {
  id: string; event_kind: 'change' | 'access'; action: string; entity_type: string; entity_id: string;
  actor_user_id: string | null; actor_email: string | null; created_at: string; details: Record<string, unknown>;
};

const actionLabel: Record<string, string> = {
  insert: '등록', update: '수정', delete: '삭제', role_change: '권한 변경',
  admin_page_view: '관리자 페이지 접근', admin_login: '관리자 대시보드 진입',
};

export function AdminActivityPage() {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const { data, error: rpcError } = await supabase.rpc('admin_list_activity_events');
    if (rpcError) setError(rpcError.message);
    else setEvents((data ?? []) as ActivityEvent[]);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  return renderAdminLayout(
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div><p className="text-xs font-semibold text-[#667085]">보안 및 운영</p><h2 className="mt-1 text-2xl font-extrabold text-[#191F28]">관리자 활동 기록</h2><p className="mt-1 text-sm text-[#667085]">관리자 페이지 접근, 교재·답지 변경, 후보 검수와 권한 변경 내역을 확인합니다.</p></div>
        <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-[#D0D5DD] bg-white px-3 text-sm font-semibold text-[#344054]"><RefreshCw className="h-4 w-4" />새로고침</button>
      </div>
      {error && <div role="alert" className="flex items-start gap-2 rounded-xl border border-[#FDD8D5] bg-[#FFEEEC] p-3 text-sm text-[#B42318]"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{error}</div>}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-[#E5E8EB] bg-white p-4"><p className="text-xs text-[#667085]">최근 기록</p><p className="mt-1 text-2xl font-extrabold tabular-nums">{events.length}</p></div>
        <div className="rounded-2xl border border-[#E5E8EB] bg-white p-4"><p className="text-xs text-[#667085]">접근 기록</p><p className="mt-1 text-2xl font-extrabold tabular-nums">{events.filter(event => event.event_kind === 'access').length}</p></div>
        <div className="rounded-2xl border border-[#E5E8EB] bg-white p-4"><p className="text-xs text-[#667085]">변경 기록</p><p className="mt-1 text-2xl font-extrabold tabular-nums">{events.filter(event => event.event_kind === 'change').length}</p></div>
      </div>
      <section className="rounded-2xl border border-[#E5E8EB] bg-white p-4 sm:p-5">
        <div className="flex items-center gap-2"><Activity className="h-5 w-5 text-[#475467]" /><h3 className="font-bold text-[#191F28]">최근 관리자 활동</h3></div>
        {loading ? <p role="status" className="py-8 text-center text-sm text-[#667085]">활동 기록을 불러오는 중입니다.</p> : events.length === 0 ? <p className="py-8 text-center text-sm text-[#667085]">기록이 없습니다.</p> : <div className="mt-4 divide-y divide-[#EAECF0]">{events.map(event => <article key={event.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-[#F2F4F6] px-2 py-1 text-xs font-semibold text-[#344054]">{event.event_kind === 'access' ? '접근' : '변경'}</span><p className="text-sm font-bold text-[#191F28]">{actionLabel[event.action] ?? event.action}</p><span className="text-xs text-[#667085]">{event.entity_type}</span></div><p className="mt-1 break-all text-xs text-[#475467]">{event.entity_id}</p><p className="mt-1 text-xs text-[#667085]">{event.actor_email ?? event.actor_user_id ?? '시스템 작업'}</p>{event.details && Object.keys(event.details).length > 0 && <pre className="mt-2 overflow-x-auto rounded-lg bg-[#F9FAFB] p-2 text-[10px] leading-4 text-[#667085]">{JSON.stringify(event.details, null, 2)}</pre>}</div><time className="shrink-0 text-xs tabular-nums text-[#667085]">{new Date(event.created_at).toLocaleString('ko-KR')}</time></article>)}</div>}
      </section>
      <div className="flex items-start gap-2 rounded-xl border border-[#EAECF0] bg-[#F9FAFB] p-3 text-xs leading-5 text-[#475467]"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" /><p>감사 기록은 관리자만 조회할 수 있습니다. 사용자 신고 상세 내용과 민감한 본문은 활동 로그에 복사하지 않도록 제한했습니다.</p></div>
    </div>
  );
}
