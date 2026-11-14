import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Lock, RefreshCw, ShieldCheck } from 'lucide-react';
import { supabase } from '../../lib/supabase/client';
import { renderAdminLayout } from './admin';

type AdminRole = {
  user_id: string;
  email: string | null;
  role_key: string | null;
  role_label: string | null;
};

const roleOptions = [
  { value: 'super_admin', label: '최고 관리자', detail: '모든 기능과 권한 관리' },
  { value: 'search_operator', label: '검색 운영자', detail: '검색 실행·중단·복구 및 진단' },
  { value: 'reviewer', label: '후보 검수자', detail: '후보 승인·거절 및 링크 등록' },
  { value: 'content_manager', label: '콘텐츠 관리자', detail: '교재·답지 링크·사이트 콘텐츠 관리' },
  { value: 'support', label: '접수 담당자', detail: '사용자 요청과 오류 신고 처리' },
];

export function AdminRolesPage() {
  const [admins, setAdmins] = useState<AdminRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const { data, error: rpcError } = await supabase.rpc('admin_list_role_assignments');
    if (rpcError) setError(rpcError.message.includes('permission') ? '최고 관리자만 관리자 권한을 관리할 수 있습니다.' : rpcError.message);
    else setAdmins((data ?? []) as AdminRole[]);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const updateRole = async (userId: string, roleKey: string) => {
    if (savingId) return;
    const target = admins.find(admin => admin.user_id === userId);
    if (!target || target.role_key === roleKey) return;
    const roleLabel = roleOptions.find(role => role.value === roleKey)?.label ?? roleKey;
    if (!window.confirm((target.email ?? userId) + ' 계정의 권한을 ' + roleLabel + '로 변경할까요?')) return;
    setSavingId(userId);
    setError('');
    setNotice('');
    const { error: rpcError } = await supabase.rpc('admin_assign_role', { p_user_id: userId, p_role_key: roleKey });
    if (rpcError) setError(rpcError.message);
    else {
      setNotice('관리자 권한을 변경했습니다. 변경 내역은 관리자 활동 기록에 저장됩니다.');
      await load();
    }
    setSavingId(null);
  };

  return renderAdminLayout(
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div><p className="text-xs font-semibold text-[#667085]">보안 및 접근 제어</p><h2 className="mt-1 text-2xl font-extrabold text-[#191F28]">관리자 권한 관리</h2><p className="mt-1 text-sm text-[#667085]">계정별로 필요한 기능만 허용합니다. 기존 관리자 계정은 최고 관리자 권한을 유지합니다.</p></div>
        <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-[#D0D5DD] bg-white px-3 text-sm font-semibold text-[#344054]"><RefreshCw className="h-4 w-4" />새로고침</button>
      </div>

      {error && <div role="alert" className="flex items-start gap-2 rounded-xl border border-[#FDD8D5] bg-[#FFEEEC] p-3 text-sm text-[#B42318]"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{error}</div>}
      {notice && <p role="status" className="rounded-xl border border-[#D0D5DD] bg-[#F9FAFB] p-3 text-sm text-[#344054]">{notice}</p>}

      <section className="rounded-2xl border border-[#E5E8EB] bg-white p-4 sm:p-5">
        <div className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-[#475467]" /><h3 className="font-bold text-[#191F28]">역할별 권한</h3></div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {roleOptions.map(role => <article key={role.value} className="rounded-xl border border-[#EAECF0] p-3"><p className="text-sm font-bold text-[#191F28]">{role.label}</p><p className="mt-1 text-xs text-[#667085]">{role.detail}</p></article>)}
        </div>
      </section>

      <section className="rounded-2xl border border-[#E5E8EB] bg-white p-4 sm:p-5">
        <div className="flex items-center justify-between gap-2"><div><h3 className="font-bold text-[#191F28]">관리자 계정</h3><p className="mt-1 text-xs text-[#667085]">권한 변경은 서버에서 재검증하고 변경 이력을 남깁니다.</p></div><span className="text-xs text-[#667085]">{admins.length}명</span></div>
        {loading ? <p role="status" className="py-8 text-center text-sm text-[#667085]">관리자 계정을 불러오는 중입니다.</p> : admins.length === 0 ? <p className="py-8 text-center text-sm text-[#667085]">표시할 관리자 계정이 없습니다.</p> : <div className="mt-4 space-y-3">{admins.map(admin => <article key={admin.user_id} className="flex flex-col gap-3 rounded-xl border border-[#EAECF0] p-3 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><p className="break-all text-sm font-semibold text-[#191F28]">{admin.email ?? '이메일 정보 없음'}</p><p className="mt-1 break-all text-xs text-[#667085]">{admin.user_id}</p><p className="mt-1 text-xs text-[#667085]">현재 권한: {admin.role_label ?? '미할당'}</p></div><label className="flex min-w-0 items-center gap-2 sm:w-64"><Lock className="h-4 w-4 shrink-0 text-[#667085]" /><select value={admin.role_key ?? 'support'} onChange={event => void updateRole(admin.user_id, event.target.value)} disabled={savingId === admin.user_id} className="min-h-11 w-full rounded-lg border border-[#D0D5DD] bg-white px-3 text-sm text-[#344054] disabled:opacity-50">{roleOptions.map(role => <option key={role.value} value={role.value}>{role.label}</option>)}</select>{savingId === admin.user_id && <span className="text-xs text-[#667085]">저장 중</span>}</label></article>)}</div>}
      </section>
      <p className="text-xs leading-5 text-[#667085]">권한은 데이터베이스 정책과 서버 RPC에서 함께 확인합니다. 관리자 계정 등록 자체는 Supabase Auth 및 관리자 등록 절차를 통해 최고 관리자가 별도로 수행해야 합니다.</p>
    </div>
  );
}
