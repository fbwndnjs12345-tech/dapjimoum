import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Clock3, RefreshCw, Save, ShieldCheck } from 'lucide-react';
import { supabase } from '../../lib/supabase/client';
import { renderAdminLayout } from './admin';

type SearchSettings = {
  singleton: boolean; daily_enabled: boolean; daily_time: string; timezone: string;
  provider_mode: 'naver' | 'kakao' | 'web' | 'combined'; max_concurrency: number;
  requests_per_minute: number; retry_limit: number; scheduler_configured: boolean;
  scheduler_last_tick_at: string | null; scheduler_last_error: string | null; last_daily_run_on: string | null;
};

const defaults: SearchSettings = {
  singleton: true, daily_enabled: true, daily_time: '06:00:00', timezone: 'Asia/Seoul',
  provider_mode: 'combined', max_concurrency: 3, requests_per_minute: 30, retry_limit: 2,
  scheduler_configured: false, scheduler_last_tick_at: null, scheduler_last_error: null, last_daily_run_on: null,
};

export function AdminSearchSettingsPage() {
  const [settings, setSettings] = useState<SearchSettings>(defaults);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const { data, error: queryError } = await supabase.from('answer_link_search_settings').select('*').eq('singleton', true).maybeSingle();
    if (queryError) setError(queryError.message);
    else if (data) setSettings({ ...defaults, ...data } as SearchSettings);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setError('');
    setNotice('');
    const { error: updateError } = await supabase.from('answer_link_search_settings').update({
      daily_enabled: settings.daily_enabled,
      daily_time: settings.daily_time,
      timezone: 'Asia/Seoul',
      provider_mode: settings.provider_mode,
      max_concurrency: settings.max_concurrency,
      requests_per_minute: settings.requests_per_minute,
      retry_limit: settings.retry_limit,
      updated_at: new Date().toISOString(),
    }).eq('singleton', true);
    if (updateError) setError(updateError.message);
    else {
      setNotice('검색 운영 설정을 저장했습니다. 예약 작업은 다음 Cron 확인 주기부터 새 설정을 사용합니다.');
      await load();
    }
    setSaving(false);
  };

  const fieldClass = 'min-h-11 w-full rounded-lg border border-[#D0D5DD] bg-white px-3 text-sm text-[#344054]';
  return renderAdminLayout(
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div><p className="text-xs font-semibold text-[#667085]">검색 운영</p><h2 className="mt-1 text-2xl font-extrabold text-[#191F28]">자동 검색 설정</h2><p className="mt-1 text-sm text-[#667085]">자동 검색 시간, 검색 출처, 동시 처리량과 재시도 한도를 관리합니다.</p></div>
        <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-[#D0D5DD] bg-white px-3 text-sm font-semibold text-[#344054]"><RefreshCw className="h-4 w-4" />새로고침</button>
      </div>
      {error && <div role="alert" className="flex items-start gap-2 rounded-xl border border-[#FDD8D5] bg-[#FFEEEC] p-3 text-sm text-[#B42318]"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{error}</div>}
      {notice && <p role="status" className="rounded-xl border border-[#D0D5DD] bg-[#F9FAFB] p-3 text-sm text-[#344054]">{notice}</p>}
      <section className="rounded-2xl border border-[#E5E8EB] bg-white p-4 sm:p-5">
        <div className="flex items-center gap-2"><Clock3 className="h-5 w-5 text-[#475467]" /><h3 className="font-bold text-[#191F28]">일일 자동 검색</h3></div>
        {loading ? <p className="py-8 text-center text-sm text-[#667085]">설정을 불러오는 중입니다.</p> : <div className="mt-4 space-y-4">
          <label className="flex items-center justify-between gap-3 rounded-xl border border-[#EAECF0] p-3"><span><span className="block text-sm font-semibold text-[#344054]">매일 자동 검색 사용</span><span className="mt-1 block text-xs text-[#667085]">기본값은 매일 오전 6시입니다.</span></span><input type="checkbox" checked={settings.daily_enabled} onChange={event => setSettings(current => ({ ...current, daily_enabled: event.target.checked }))} className="h-5 w-5 accent-[#191F28]" /></label>
          <div className="grid gap-3 sm:grid-cols-2"><label className="space-y-1"><span className="block text-xs font-semibold text-[#475467]">실행 시간 (한국 시간)</span><input type="time" value={settings.daily_time.slice(0,5)} onChange={event => setSettings(current => ({ ...current, daily_time: event.target.value + ':00' }))} className={fieldClass} /></label><label className="space-y-1"><span className="block text-xs font-semibold text-[#475467]">시간대</span><input value="Asia/Seoul" disabled className={fieldClass + ' bg-[#F9FAFB]'} /></label></div>
        </div>}
      </section>
      <section className="rounded-2xl border border-[#E5E8EB] bg-white p-4 sm:p-5">
        <h3 className="font-bold text-[#191F28]">검색 성능 및 복구</h3>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="space-y-1"><span className="block text-xs font-semibold text-[#475467]">기본 검색 출처</span><select value={settings.provider_mode} onChange={event => setSettings(current => ({ ...current, provider_mode: event.target.value as SearchSettings['provider_mode'] }))} className={fieldClass}><option value="combined">통합 검색 (공개 웹 + 설정된 API)</option><option value="web">공개 웹 검색</option><option value="naver">네이버 API</option><option value="kakao">카카오 API</option></select></label>
          <label className="space-y-1"><span className="block text-xs font-semibold text-[#475467]">동시 처리 교재 수 (1–5)</span><input type="number" min="1" max="5" value={settings.max_concurrency} onChange={event => setSettings(current => ({ ...current, max_concurrency: Math.max(1, Math.min(5, Number(event.target.value) || 1)) }))} className={fieldClass} /></label>
          <label className="space-y-1"><span className="block text-xs font-semibold text-[#475467]">분당 요청 목표 (1–300)</span><input type="number" min="1" max="300" value={settings.requests_per_minute} onChange={event => setSettings(current => ({ ...current, requests_per_minute: Math.max(1, Math.min(300, Number(event.target.value) || 1)) }))} className={fieldClass} /></label>
          <label className="space-y-1"><span className="block text-xs font-semibold text-[#475467]">실패 재시도 횟수 (0–5)</span><input type="number" min="0" max="5" value={settings.retry_limit} onChange={event => setSettings(current => ({ ...current, retry_limit: Math.max(0, Math.min(5, Number(event.target.value) || 0)) }))} className={fieldClass} /></label>
        </div>
        <button type="button" onClick={() => void save()} disabled={loading || saving} className="mt-5 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#191F28] px-4 text-sm font-bold text-white disabled:opacity-50 sm:w-auto"><Save className="h-4 w-4" />{saving ? '저장 중…' : '설정 저장'}</button>
      </section>
      <section className="rounded-2xl border border-[#E5E8EB] bg-white p-4 sm:p-5">
        <div className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-[#475467]" /><h3 className="font-bold text-[#191F28]">서버 예약 작업 상태</h3></div>
        <p className="mt-3 text-sm font-semibold text-[#344054]">{settings.scheduler_configured ? '예약 작업 인증 설정 확인됨' : 'Vault 인증 설정 필요'}</p>
        <p className="mt-1 text-xs leading-5 text-[#667085]">Supabase Vault에 <code>dapjimoum_project_url</code> 및 <code>dapjimoum_service_role_key</code> 두 비밀 값을 저장해야 서버가 Edge Function을 호출할 수 있습니다. 비밀 값은 이 화면이나 웹 브라우저에 노출하지 않습니다.</p>
        {settings.scheduler_last_error && <p className="mt-2 break-words rounded-lg bg-[#F9FAFB] p-3 text-xs text-[#B42318]">{settings.scheduler_last_error}</p>}
        <p className="mt-2 text-xs text-[#667085]">마지막 Cron 확인: {settings.scheduler_last_tick_at ? new Date(settings.scheduler_last_tick_at).toLocaleString('ko-KR') : '아직 실행되지 않음'} · 마지막 일일 검색 날짜: {settings.last_daily_run_on ?? '없음'}</p>
      </section>
    </div>
  );
}
