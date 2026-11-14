import { useEffect, useState } from 'react';
import { Check, ExternalLink, FileText, Save } from 'lucide-react';
import { supabase } from '../../lib/supabase/client';
import { renderAdminLayout } from './admin';

const pages = [
  { slug: 'about', label: '서비스 소개', path: '/about' },
  { slug: 'privacy', label: '개인정보처리방침', path: '/privacy' },
  { slug: 'terms', label: '이용약관', path: '/terms' },
  { slug: 'copyright', label: '저작권 및 링크 정책', path: '/copyright' },
  { slug: 'contact', label: '문의 및 오류 신고', path: '/contact' },
] as const;
type PageSlug = typeof pages[number]['slug'];
type SitePage = { slug: PageSlug; title: string; body: string; updated_at: string; updated_by: string | null };

export function AdminSiteContentPage() {
  const [items, setItems] = useState<SitePage[]>([]);
  const [selected, setSelected] = useState<PageSlug>('about');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    const { data, error: loadError } = await supabase.from('site_pages').select('*').order('slug');
    if (loadError) setError(loadError.message);
    else {
      const rows = (data ?? []) as SitePage[];
      setItems(rows);
      const page = rows.find(item => item.slug === selected) ?? rows[0];
      if (page) {
        setSelected(page.slug);
        setTitle(page.title);
        setBody(page.body);
      }
    }
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  const choosePage = (slug: PageSlug) => {
    setSelected(slug);
    const page = items.find(item => item.slug === slug);
    setTitle(page?.title ?? pages.find(item => item.slug === slug)?.label ?? '');
    setBody(page?.body ?? '');
    setNotice('');
    setError('');
  };

  const save = async () => {
    if (!title.trim() || !body.trim()) {
      setError('문서 제목과 본문을 입력해 주세요.');
      return;
    }
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) throw authError ?? new Error('관리자 로그인이 필요합니다.');
      const { data, error: saveError } = await supabase.from('site_pages').upsert({
        slug: selected,
        title: title.trim().slice(0, 160),
        body: body.trim().slice(0, 50000),
        updated_at: new Date().toISOString(),
        updated_by: user.id,
      }, { onConflict: 'slug' }).select('*').single();
      if (saveError) throw saveError;
      setItems(current => [...current.filter(item => item.slug !== selected), data as SitePage]);
      setNotice('저장했습니다. 공개 페이지에 변경 내용이 반영됩니다.');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '저장하지 못했습니다.');
    } finally {
      setSaving(false);
    }
  };

  const currentPage = pages.find(item => item.slug === selected)!;
  return renderAdminLayout(
    <div className="space-y-5">
      <header className="space-y-1">
        <h2 className="text-xl font-extrabold text-[#191F28]">사이트 문서 관리</h2>
        <p className="text-sm text-[#667085]">서비스 소개, 개인정보처리방침, 이용약관, 저작권 정책, 문의 안내를 이 화면에서 수정합니다.</p>
      </header>
      <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
        <nav aria-label="편집할 문서" className="grid grid-cols-2 gap-2 rounded-2xl border border-[#E5E8EB] bg-white p-3 lg:grid-cols-1">
          {pages.map(page => <button key={page.slug} type="button" onClick={() => choosePage(page.slug)} aria-pressed={selected === page.slug} className={`flex min-h-11 items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-sm font-semibold ${selected === page.slug ? 'border-[#344054] bg-[#F2F4F6] text-[#191F28]' : 'border-[#EAECF0] text-[#475467] hover:bg-[#F9FAFB]'}`}><FileText className="h-4 w-4 shrink-0" />{page.label}</button>)}
        </nav>
        <section className="min-w-0 space-y-4 rounded-2xl border border-[#E5E8EB] bg-white p-4 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div><h3 className="font-bold text-[#191F28]">{currentPage.label}</h3><a href={currentPage.path} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-[#475467] underline">공개 페이지 보기 <ExternalLink className="h-3 w-3" /></a></div>
            <span className="text-xs text-[#667085]">{body.length.toLocaleString()} / 50,000자</span>
          </div>
          {error && <p role="alert" className="rounded-xl border border-[#FDD8D5] bg-[#FFEEEC] p-3 text-sm text-[#B42318]">{error}</p>}
          {notice && <p role="status" className="rounded-xl border border-[#D0D5DD] bg-[#F9FAFB] p-3 text-sm text-[#344054]"><Check className="mr-1 inline h-4 w-4" />{notice}</p>}
          {loading ? <p className="py-12 text-center text-sm text-[#667085]">문서를 불러오는 중입니다.</p> : <>
            <label className="block space-y-1.5"><span className="text-sm font-semibold text-[#344054]">페이지 제목</span><input value={title} onChange={event => setTitle(event.target.value)} maxLength={160} className="w-full rounded-xl border border-[#D0D5DD] px-3 py-3 text-base outline-none focus:border-[#667085]" /></label>
            <label className="block space-y-1.5"><span className="text-sm font-semibold text-[#344054]">본문 (간단한 Markdown 지원)</span><textarea value={body} onChange={event => setBody(event.target.value)} rows={22} maxLength={50000} spellCheck className="w-full resize-y rounded-xl border border-[#D0D5DD] px-3 py-3 text-sm leading-7 outline-none focus:border-[#667085]" /></label>
            <p className="text-xs leading-5 text-[#667085]">문단은 빈 줄로 구분하고, 소제목은 # 제목, 목록은 - 항목 형식으로 작성합니다. 개인정보처리방침·약관은 실제 운영자 정보, 제공자 설정, 보유기간을 확인한 뒤 공개해야 합니다.</p>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button type="button" onClick={() => choosePage(selected)} disabled={saving} className="min-h-11 rounded-xl border border-[#D0D5DD] px-4 py-2.5 text-sm font-semibold text-[#344054]">변경 취소</button><button type="button" onClick={() => void save()} disabled={saving || loading} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#191F28] px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50"><Save className="h-4 w-4" />{saving ? '저장 중…' : '저장 및 공개 반영'}</button></div>
          </>}
        </section>
      </div>
    </div>
  );
}
