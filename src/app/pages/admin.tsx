import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Lock, Globe, Plus, Search, BookOpen, LayoutDashboard, RefreshCw, FileSpreadsheet, ScanSearch } from 'lucide-react';
import { useAppContext } from '../../state/useAppContext';
import type { AnswerLink, Book } from '../../types/book';

const hasSupabaseConfig = () => Boolean(
  import.meta.env.NEXT_PUBLIC_SUPABASE_URL && import.meta.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

const getAdminDataError = (error: unknown) =>
  error instanceof Error ? error.message : 'Supabase 요청을 처리하지 못했습니다.';

const getAdminBookLabel = (book: Book) => [
  book.title,
  book.publisher,
  book.subject,
  book.grade,
  book.semester,
  book.series
].filter(Boolean).join(' · ');

type CurriculumRevision = Exclude<Book['curriculum_revision'], null | undefined>;
type AdminBookFormValues = {
  title: string;
  publisher: string;
  subject: string;
  grade: string;
  semester: string;
  series: string;
  edition: string;
  curriculum_revision: CurriculumRevision | '';
  description: string;
  thumbnail_url: string;
  book_url: string;
};

const ANSWER_LINK_TYPES = ['다운로드', '온라인 PDF 뷰어', '이미지 보기', '웹페이지'] as const;

export function LoginPage() {
    const {showToast, navigateTo} = useAppContext();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleLogin = async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setError('');
      setIsSubmitting(true);
      try {
        if (!hasSupabaseConfig()) throw new Error('Supabase 환경 변수를 확인해 주세요.');
        const { supabase } = await import('../../lib/supabase/client');
        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
        if (signInError) throw signInError;
        showToast('관리자로 로그인되었습니다.');
        navigateTo('/admin');
      } catch (loginError) {
        setError(getAdminDataError(loginError));
      } finally {
        setIsSubmitting(false);
      }
    };

    return (
      <div className="max-w-sm mx-auto px-5 py-16 space-y-6">
        <div className="bg-white rounded-3xl border border-[#E5E8EB] p-8 space-y-6 shadow-xl">
          <div className="text-center space-y-1.5">
            <div className="w-12 h-12 bg-[#191F28] text-white rounded-2xl flex items-center justify-center mx-auto shadow-md">
              <Lock className="w-6 h-6" />
            </div>
            <h1 className="text-xl font-bold text-[#191F28]">관리자 센터</h1>
            <p className="text-xs text-[#8B95A1]">교재 및 외부 답지 링크 수집·검증 전용</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-[#333D4B]">이메일</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full px-4 py-3 text-xs bg-[#F9FAFB] border border-[#E5E8EB] rounded-2xl text-[#191F28] outline-none focus:border-[#3182F6]"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-[#333D4B]">비밀번호</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full px-4 py-3 text-xs bg-[#F9FAFB] border border-[#E5E8EB] rounded-2xl text-[#191F28] outline-none focus:border-[#3182F6]"
              />
            </div>

            {error && <p role="alert" className="rounded-xl bg-[#FFEEEC] border border-[#FDD8D5] p-3 text-xs text-[#B42318]">{error}</p>}

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-3.5 bg-[#3182F6] hover:bg-[#1B64DA] text-white font-bold text-xs rounded-2xl transition-all shadow-md shadow-[#3182F6]/20 disabled:opacity-60"
            >
              {isSubmitting ? '로그인 중…' : '로그인하기'}
            </button>
          </form>
        </div>
      </div>
    );
}

export function renderAdminLayout(content: React.ReactNode) {
    const {isAdminLoggedIn, navigateTo, books, currentRoute, catalogStatus} = useAppContext();
    if (!isAdminLoggedIn) {
      return (
        <div className="max-w-md mx-auto py-20 text-center space-y-4">
          <AlertCircle className="w-10 h-10 text-[#F04438] mx-auto" />
          <h2 className="text-lg font-bold text-[#191F28]">접근 권한 제한</h2>
          <p className="text-xs text-[#8B95A1]">관리자 로그인이 필요한 페이지입니다.</p>
          <button
            onClick={() => navigateTo('/login')}
            className="px-5 py-2.5 bg-[#3182F6] text-white font-bold text-xs rounded-2xl"
          >
            로그인하기
          </button>
        </div>
      );
    }

    return (
      <div className="max-w-[1100px] mx-auto px-5 py-8 space-y-6">
        <header className="rounded-3xl border border-[#E5E8EB] bg-white p-4 sm:p-5 space-y-4">
          <div>
            <p className="text-[11px] font-bold tracking-wide text-[#8B95A1]">답지모음 관리자</p>
            <h1 className="mt-1 text-lg sm:text-xl font-extrabold text-[#191F28]">콘텐츠 관리</h1>
          </div>
          <nav aria-label="관리 메뉴" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 border-t border-[#F2F4F6] pt-4">
            {[
              { path: '/admin', label: '관리 요약', count: null, icon: LayoutDashboard, active: currentRoute === '/admin' },
              { path: '/admin/books', label: '교재 관리', count: books.length, icon: BookOpen, active: currentRoute.startsWith('/admin/books') },
              { path: '/admin/import', label: 'CSV 일괄 등록', count: null, icon: FileSpreadsheet, active: currentRoute === '/admin/import' },
              { path: '/admin/link-search', label: '답지 링크 자동 검색', count: null, icon: ScanSearch, active: currentRoute === '/admin/link-search' }
            ].map(item => {
              const Icon = item.icon;
              return <button key={item.path} onClick={() => navigateTo(item.path)} aria-current={item.active ? 'page' : undefined} className={`flex min-h-11 items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 text-left text-sm font-bold transition-colors ${item.active ? 'border-[#D0D5DD] bg-[#F2F4F6] text-[#191F28]' : 'border-[#E5E8EB] bg-white text-[#4E5968] hover:bg-[#F9FAFB]'}`}>
                <span className="flex items-center gap-2"><Icon className="h-4 w-4" />{item.label}</span>
                {item.count !== null && <span className="text-xs font-semibold text-[#667085]">{catalogStatus === 'success' ? item.count : '—'}</span>}
              </button>;
            })}
          </nav>
        </header>

        {content}
      </div>
    );
}

export function AdminDashboard() {
    const {books, links, navigateTo, catalogStatus, catalogError, refreshCatalog} = useAppContext();
    const totalBooks = books.length;
    const totalLinks = links.length;
    const verifiedLinks = links.filter(l => l.verified).length;
    const totalClicks = links.reduce((sum, l) => sum + l.click_count, 0);

    return renderAdminLayout(
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-extrabold text-[#191F28]">관리 요약</h2>
          <p className="mt-1 text-sm text-[#667085]">교재와 답지 링크 현황을 확인합니다.</p>
          {catalogStatus === 'error' && <div role="alert" className="mt-3 flex flex-col gap-2 rounded-xl border border-[#FDD8D5] bg-[#FFEEEC] p-3 text-sm text-[#B42318] sm:flex-row sm:items-center sm:justify-between"><span>통계를 불러오지 못했습니다. {catalogError}</span><button type="button" onClick={() => void refreshCatalog()} className="font-bold underline">다시 시도</button></div>}
        </div>
        {/* Metric Cards Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="bg-white p-5 rounded-3xl border border-[#E5E8EB] space-y-1 shadow-sm">
            <span className="text-xs text-[#8B95A1] font-bold">전체 등록 교재</span>
            <div className="text-2xl font-extrabold text-[#191F28]">{catalogStatus === 'success' ? `${totalBooks}권` : catalogStatus === 'loading' ? '불러오는 중' : '조회 실패'}</div>
          </div>
          <div className="bg-white p-5 rounded-3xl border border-[#E5E8EB] space-y-1 shadow-sm">
            <span className="text-xs text-[#8B95A1] font-bold">수집된 답지 링크</span>
            <div className="text-2xl font-extrabold text-[#191F28]">{catalogStatus === 'success' ? `${totalLinks}개` : catalogStatus === 'loading' ? '불러오는 중' : '조회 실패'}</div>
          </div>
          <div className="bg-white p-5 rounded-3xl border border-[#E5E8EB] space-y-1 shadow-sm">
            <span className="text-xs text-[#12B76A] font-bold">검증 완료 링크</span>
            <div className="text-2xl font-extrabold text-[#12B76A]">{catalogStatus === 'success' ? `${verifiedLinks}개` : catalogStatus === 'loading' ? '불러오는 중' : '조회 실패'}</div>
          </div>
          <div className="bg-white p-5 rounded-3xl border border-[#E5E8EB] space-y-1 shadow-sm">
            <span className="text-xs text-[#8B95A1] font-bold">누적 링크 클릭</span>
            <div className="text-2xl font-extrabold text-[#3182F6]">{catalogStatus === 'success' ? `${totalClicks.toLocaleString()}회` : catalogStatus === 'loading' ? '불러오는 중' : '조회 실패'}</div>
          </div>
        </div>

        {/* Action Toolbar */}
        <div className="flex flex-col sm:flex-row gap-2">
          <button
            onClick={() => navigateTo('/admin/books/new')}
            className="px-4 py-3 sm:py-2.5 bg-[#191F28] hover:bg-[#333D4B] text-white font-bold text-sm rounded-xl transition-colors flex items-center justify-center gap-1.5"
          >
            <Plus className="w-4 h-4" />
            <span>신규 교재 등록</span>
          </button>
          <button
            onClick={() => navigateTo('/admin/books')}
            className="px-4 py-3 sm:py-2.5 bg-white border border-[#D0D5DD] hover:bg-[#F9FAFB] text-[#191F28] font-bold text-sm rounded-xl transition-colors flex items-center justify-center gap-1.5"
          >
            <Globe className="w-4 h-4 text-[#3182F6]" />
            <span>교재별 답지 링크 관리</span>
          </button>
        </div>

        {/* Table of Recent Books */}
        <div className="bg-white rounded-2xl border border-[#E5E8EB] overflow-hidden">
          <div className="p-4 sm:p-5 border-b border-[#E5E8EB]">
            <h3 className="font-bold text-base text-[#191F28]">최근 등록된 교재</h3>
          </div>
          {catalogStatus === 'loading' ? <p role="status" className="p-8 text-center text-sm text-[#667085]">DB 현황을 불러오고 있습니다.</p> : catalogStatus === 'error' ? <p role="alert" className="p-8 text-center text-sm text-[#B42318]">DB 현황을 불러오지 못했습니다. {catalogError}</p> : books.length === 0 ? <p className="p-8 text-center text-sm text-[#667085]">등록된 교재가 없습니다.</p> : <div className="overflow-x-auto">
            <table className="w-full min-w-[700px] table-fixed text-left text-sm text-[#344054]">
              <thead>
                <tr className="bg-[#F9FAFB] border-b border-[#E5E8EB] text-[#344054] font-bold">
                  <th className="w-[34%] px-4 py-4">교재명</th>
                  <th className="w-[20%] px-4 py-4">출판사</th>
                  <th className="w-[20%] px-4 py-4">과목/학년</th>
                  <th className="w-[13%] px-4 py-4">링크 수</th>
                  <th className="w-[13%] px-4 py-4 text-right">관리</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F2F4F6]">
                {books.slice(0, 5).map(b => {
                  const bLinks = links.filter(l => l.book_id === b.id);
                  return (
                    <tr key={b.id} className="border-b border-[#F2F4F6] last:border-0 hover:bg-[#FCFCFD]">
                      <td className="break-words px-4 py-4 align-top font-semibold text-[#191F28]">{b.title}</td>
                      <td className="break-words px-4 py-4 align-top">{b.publisher || '—'}</td>
                      <td className="break-words px-4 py-4 align-top">{[b.subject, b.grade].filter(Boolean).join(' · ') || '—'}</td>
                      <td className="px-4 py-4 align-top font-semibold text-[#344054]">{bLinks.length}개</td>
                      <td className="px-4 py-4 align-top text-right">
                        <button
                          onClick={() => navigateTo(`/admin/books/${b.id}`, { id: b.id })}
                          className="rounded-lg border border-[#D0D5DD] px-3 py-2 font-semibold text-[#344054] hover:bg-[#F2F4F6]"
                        >
                          수정
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          }
        </div>
      </div>
    );
}

export function AdminBooksList() {
  const { showToast, navigateTo, refreshCatalog } = useAppContext();
  const [books, setBooks] = useState<Book[]>([]);
  const [answerLinkCounts, setAnswerLinkCounts] = useState<Record<string, number>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [publisherFilter, setPublisherFilter] = useState('전체');
  const [subjectFilter, setSubjectFilter] = useState('전체');

  const loadBooks = async () => {
    setIsLoading(true); setError('');
    try {
      if (!hasSupabaseConfig()) throw new Error('Supabase 환경 변수를 확인해 주세요.');
      const [{ getBooks }, { getAnswerLinks }] = await Promise.all([
        import('../../lib/supabase/books'),
        import('../../lib/supabase/answerLinks')
      ]);
      const [loadedBooks, answerLinks] = await Promise.all([getBooks(), getAnswerLinks()]);
      setBooks(loadedBooks);
      setAnswerLinkCounts(answerLinks.reduce<Record<string, number>>((counts, link) => {
        counts[link.book_id] = (counts[link.book_id] ?? 0) + 1;
        return counts;
      }, {}));
    } catch (loadError) { setError(getAdminDataError(loadError)); }
    finally { setIsLoading(false); }
  };
  useEffect(() => { void loadBooks(); }, []);

  const publishers = useMemo(() => [...new Set(books.map(book => book.publisher?.trim()).filter((value): value is string => Boolean(value)))].sort(), [books]);
  const subjects = useMemo(() => [...new Set(books.map(book => book.subject?.trim()).filter((value): value is string => Boolean(value)))].sort(), [books]);
  const visibleBooks = useMemo(() => {
    const query = searchTerm.trim().toLocaleLowerCase();
    return books.filter(book => {
      const searchable = [book.title, book.publisher, book.subject, book.grade, book.semester, book.series, book.edition, book.curriculum_revision]
        .filter(Boolean).join(' ').toLocaleLowerCase();
      return (!query || searchable.includes(query)) &&
        (publisherFilter === '전체' || book.publisher === publisherFilter) &&
        (subjectFilter === '전체' || book.subject === subjectFilter);
    });
  }, [books, searchTerm, publisherFilter, subjectFilter]);

  const handleDelete = async (book: Book) => {
    if (!window.confirm(`'${book.title}' 교재를 삭제할까요? 연결된 답지 링크도 함께 삭제됩니다.`)) return;
    setDeletingId(book.id); setError('');
    try {
      const { deleteBook } = await import('../../lib/supabase/books');
      await deleteBook(book.id);
      setBooks(current => current.filter(item => item.id !== book.id));
      await refreshCatalog();
      showToast('교재가 삭제되었습니다.');
    } catch (deleteError) { setError(getAdminDataError(deleteError)); }
    finally { setDeletingId(null); }
  };

  return renderAdminLayout(
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div><h2 className="text-xl font-extrabold text-[#191F28]">교재 관리</h2><p className="mt-1 text-sm text-[#667085]">등록된 교재 정보를 검색하고 수정합니다.</p></div>
        <button onClick={() => navigateTo('/admin/books/new')} className="w-full sm:w-auto px-4 py-3 bg-[#191F28] text-white font-bold text-sm rounded-xl hover:bg-[#333D4B] flex items-center justify-center gap-2"><Plus className="w-4 h-4" /><span>교재 추가</span></button>
      </div>
      {error && <div role="alert" className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-[#D0D5DD] bg-[#F9FAFB] p-4 text-sm text-[#344054]"><span>{error}</span><button onClick={() => void loadBooks()} className="inline-flex items-center justify-center gap-2 rounded-lg border border-[#D0D5DD] bg-white px-3 py-2 font-semibold hover:bg-[#F2F4F6]"><RefreshCw className="h-4 w-4" />다시 불러오기</button></div>}
      <section aria-label="교재 목록 검색 및 필터" className="grid grid-cols-1 md:grid-cols-[minmax(240px,1fr)_200px_180px] gap-3 rounded-2xl border border-[#E5E8EB] bg-white p-4">
        <label className="space-y-1"><span className="block text-xs font-semibold text-[#475467]">교재 검색</span><span className="relative block"><Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#667085]" /><input value={searchTerm} onChange={event => setSearchTerm(event.target.value)} placeholder="교재명, 시리즈, 학년 등 검색" className="min-h-11 w-full rounded-xl border border-[#D0D5DD] bg-white py-3 pl-10 pr-3 text-sm text-[#191F28] placeholder:text-[#98A2B3] outline-none focus:border-[#667085]" /></span></label>
        <label className="space-y-1"><span className="block text-xs font-semibold text-[#475467]">출판사</span><select value={publisherFilter} onChange={event => setPublisherFilter(event.target.value)} className="w-full rounded-xl border border-[#D0D5DD] bg-white px-3 py-3 text-sm text-[#191F28] outline-none focus:border-[#667085]"><option value="전체">모든 출판사</option>{publishers.map(publisher => <option key={publisher} value={publisher}>{publisher}</option>)}</select></label>
        <label className="space-y-1"><span className="block text-xs font-semibold text-[#475467]">과목</span><select value={subjectFilter} onChange={event => setSubjectFilter(event.target.value)} className="w-full rounded-xl border border-[#D0D5DD] bg-white px-3 py-3 text-sm text-[#191F28] outline-none focus:border-[#667085]"><option value="전체">모든 과목</option>{subjects.map(subject => <option key={subject} value={subject}>{subject}</option>)}</select></label>
      </section>
      <div className="flex items-center justify-between text-sm"><h3 className="font-bold text-[#191F28]">교재 목록</h3><span className="text-[#667085]">{visibleBooks.length} / {books.length}권</span></div>
      <div className="bg-white rounded-2xl border border-[#E5E8EB] overflow-hidden">
        {isLoading ? <div role="status" className="p-10 text-center text-sm text-[#667085]">교재 목록을 불러오고 있습니다.</div> : error && books.length === 0 ? <div className="p-10 text-center text-sm text-[#667085]">목록을 불러오지 못했습니다. 다시 시도해 주세요.</div> : books.length === 0 ? <div className="p-10 text-center"><p className="text-sm font-semibold text-[#344054]">등록된 교재가 없습니다.</p><p className="mt-1 text-sm text-[#667085]">교재 추가 버튼으로 첫 교재를 등록하세요.</p></div> : visibleBooks.length === 0 ? <div className="p-10 text-center text-sm text-[#667085]">조건에 맞는 교재가 없습니다. 검색어와 필터를 확인해 주세요.</div> :
          <div className="overflow-x-auto"><table className="w-full min-w-[900px] table-fixed text-left text-sm text-[#344054]">
            <thead><tr className="bg-[#F9FAFB] border-b border-[#E5E8EB] text-[#344054] font-bold"><th className="w-[25%] px-4 py-4">교재명</th><th className="w-[15%] px-4 py-4">출판사</th><th className="w-[11%] px-4 py-4">과목</th><th className="w-[18%] px-4 py-4">학년 / 학기</th><th className="w-[16%] px-4 py-4">시리즈 / 판본</th><th className="w-[15%] px-4 py-4 text-right">관리</th></tr></thead>
            <tbody className="divide-y divide-[#EAECF0]">{visibleBooks.map(book => <tr key={book.id} className="hover:bg-[#FCFCFD]">
              <td className="break-words px-4 py-5 align-top font-semibold leading-6 text-[#191F28]">{book.title}{book.book_url && <span className="mt-1 block break-all font-normal text-xs leading-5 text-[#667085]">{book.book_url}</span>}</td><td className="break-words px-4 py-5 align-top">{book.publisher || '—'}</td><td className="break-words px-4 py-5 align-top">{book.subject || '—'}</td><td className="break-words px-4 py-5 align-top">{[book.grade, book.semester, book.curriculum_revision].filter(Boolean).join(' · ') || '—'}</td><td className="break-words px-4 py-5 align-top">{[book.series, book.edition].filter(Boolean).join(' · ') || '—'}</td>
              <td className="px-4 py-5 align-top"><div className="flex flex-wrap justify-end gap-2"><button onClick={() => navigateTo('/admin/books/' + book.id, { id: book.id })} className="rounded-lg border border-[#D0D5DD] bg-white px-3 py-2 font-semibold text-[#344054] hover:bg-[#F2F4F6]">수정</button><button onClick={() => void handleDelete(book)} disabled={deletingId === book.id} className="rounded-lg border border-[#D0D5DD] bg-[#F9FAFB] px-3 py-2 font-semibold text-[#344054] hover:border-[#98A2B3] hover:bg-[#F2F4F6] disabled:opacity-50">{deletingId === book.id ? '삭제 중…' : '삭제'}</button></div></td>
            </tr>)}</tbody>
          </table></div>
        }
      </div>
    </div>
  );
}

export function AdminBookForm({ mode }: { mode: 'create' | 'edit' }) {
  const { routeParams, showToast, navigateTo, refreshCatalog } = useAppContext();
  const isEdit = mode === 'edit';
  const bookId = routeParams.id;
  const [form, setForm] = useState<AdminBookFormValues>({ title: '', publisher: '', subject: '', grade: '', semester: '', series: '', edition: '', curriculum_revision: '', description: '', thumbnail_url: '', book_url: '' });
  const [isLoading, setIsLoading] = useState(isEdit);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    if (!isEdit) { setIsLoading(false); return () => { active = false; }; }
    const loadBook = async () => {
      setIsLoading(true); setError('');
      try {
        if (!hasSupabaseConfig()) throw new Error('Supabase 환경 변수를 확인해 주세요.');
        const { getBookById } = await import('../../lib/supabase/books');
        const book = await getBookById(bookId);
        if (!book) throw new Error('교재를 찾을 수 없습니다.');
        if (active) setForm({ title: book.title ?? '', publisher: book.publisher ?? '', subject: book.subject ?? '', grade: book.grade ?? '', semester: book.semester ?? '', series: book.series ?? '', edition: book.edition ?? '', curriculum_revision: book.curriculum_revision ?? '', description: book.description ?? '', thumbnail_url: book.thumbnail_url ?? '', book_url: book.book_url ?? '' });
      } catch (loadError) { if (active) setError(getAdminDataError(loadError)); }
      finally { if (active) setIsLoading(false); }
    };
    void loadBook();
    return () => { active = false; };
  }, [isEdit, bookId]);

  const change = (field: keyof typeof form, value: string) => setForm(current => ({ ...current, [field]: value }));
  const handleSaveBook = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setError(''); setIsSaving(true);
    try {
      if (!hasSupabaseConfig()) throw new Error('Supabase 환경 변수를 확인해 주세요.');
      const { createBook, updateBook } = await import('../../lib/supabase/books');
      const values = { ...form, curriculum_revision: form.curriculum_revision || null };
      const savedBook = isEdit
        ? await updateBook(bookId, values)
        : await createBook(values);
      await refreshCatalog();
      showToast(isEdit ? '교재 정보가 수정되었습니다.' : '새 교재가 등록되었습니다.');
      if (!isEdit) navigateTo(`/admin/books/${savedBook.id}`, { id: savedBook.id });
    } catch (saveError) { setError(getAdminDataError(saveError)); }
    finally { setIsSaving(false); }
  };

  const inputClass = 'w-full min-h-11 px-4 py-3 text-sm bg-white border border-[#D0D5DD] rounded-xl text-[#191F28] outline-none focus:border-[#667085]';
  return renderAdminLayout(
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between"><div><h2 className="text-xl font-extrabold text-[#191F28]">{isEdit ? '교재 정보 수정' : '신규 교재 등록'}</h2><p className="mt-1 text-sm text-[#667085]">교재 정보를 입력하고 저장합니다.</p></div><button onClick={() => navigateTo('/admin/books')} className="self-start rounded-lg px-3 py-2 text-sm font-semibold text-[#475467] hover:bg-[#F2F4F6]">목록으로</button></div>
      {error && <p role="alert" className="rounded-xl border border-[#D0D5DD] bg-[#F9FAFB] p-4 text-sm text-[#344054]">{error}</p>}
      {isLoading ? <div role="status" className="bg-white rounded-2xl border border-[#E5E8EB] p-10 text-center text-sm text-[#667085]">교재 정보를 불러오고 있습니다.</div> :
        <form onSubmit={handleSaveBook} className="bg-white rounded-2xl border border-[#E5E8EB] p-5 sm:p-7 space-y-6 shadow-sm">
          <div className="space-y-2"><label htmlFor="book-title" className="block text-sm font-semibold text-[#344054]">교재명 <span className="text-[#667085]">(필수)</span></label><input id="book-title" value={form.title} onChange={e => change('title', e.target.value)} required className={inputClass} /></div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div className="space-y-2"><label htmlFor="book-publisher" className="block text-sm font-semibold text-[#344054]">출판사</label><input id="book-publisher" value={form.publisher} onChange={e => change('publisher', e.target.value)} className={inputClass} /></div>
            <div className="space-y-2"><label htmlFor="book-subject" className="block text-sm font-semibold text-[#344054]">과목</label><input id="book-subject" value={form.subject} onChange={e => change('subject', e.target.value)} className={inputClass} /></div>
            <div className="space-y-2"><label htmlFor="book-grade" className="block text-sm font-semibold text-[#344054]">학년 / 대상 학년</label><input id="book-grade" list="book-grade-options" value={form.grade} onChange={e => change('grade', e.target.value)} placeholder="예: 중2 또는 전학년" className={inputClass} /><datalist id="book-grade-options"><option value="전학년" /><option value="초등1" /><option value="초등2" /><option value="초등3" /><option value="초등4" /><option value="초등5" /><option value="초등6" /><option value="중1" /><option value="중2" /><option value="중3" /><option value="고1" /><option value="고2" /><option value="고3" /></datalist><p className="text-xs text-[#667085]">여러 학년 대상 교재는 ‘전학년’을 선택하거나 입력하세요.</p></div>
            <div className="space-y-2"><label htmlFor="book-semester" className="block text-sm font-semibold text-[#344054]">학기</label><input id="book-semester" value={form.semester} onChange={e => change('semester', e.target.value)} className={inputClass} /></div>
          </div>
          <div className="space-y-2"><label htmlFor="book-series" className="block text-sm font-semibold text-[#344054]">시리즈</label><input id="book-series" value={form.series} onChange={e => change('series', e.target.value)} className={inputClass} /></div>
          <div className="space-y-2"><label htmlFor="book-edition" className="block text-sm font-semibold text-[#344054]">개정판 / 판본</label><input id="book-edition" value={form.edition} onChange={e => change('edition', e.target.value)} placeholder="공식 표기 확인 후 입력" className={inputClass} /></div>
          <div className="space-y-2"><label htmlFor="book-curriculum-revision" className="block text-sm font-semibold text-[#344054]">교육과정 개정</label><select id="book-curriculum-revision" value={form.curriculum_revision} onChange={e => change('curriculum_revision', e.target.value as AdminBookFormValues['curriculum_revision'])} className={inputClass}><option value="">미지정</option><option value="2015 개정">2015 개정</option><option value="2022 개정">2022 개정</option></select></div>
          <div className="space-y-2"><label htmlFor="book-thumbnail" className="block text-sm font-semibold text-[#344054]">대표 표지 이미지 URL</label><input id="book-thumbnail" type="url" value={form.thumbnail_url} onChange={e => change('thumbnail_url', e.target.value)} placeholder="https://..." className={inputClass} /></div>
          <div className="space-y-2"><label htmlFor="book-url" className="block text-sm font-semibold text-[#344054]">교재 페이지 URL</label><input id="book-url" type="url" value={form.book_url} onChange={e => change('book_url', e.target.value)} placeholder="https://..." className={inputClass} /></div>
          <div className="space-y-2"><label htmlFor="book-description" className="block text-sm font-semibold text-[#344054]">교재 요약 정보</label><textarea id="book-description" value={form.description} onChange={e => change('description', e.target.value)} rows={4} className={inputClass} /></div>
          <button type="submit" disabled={isSaving} className="w-full py-3.5 bg-[#191F28] hover:bg-[#333D4B] text-white font-bold text-sm rounded-xl transition-colors disabled:opacity-50">{isSaving ? '저장 중…' : isEdit ? '저장하기' : '교재 등록 완료'}</button>
        </form>
      }
      {isEdit && !isLoading && !error && <AdminLinksList embeddedBookId={bookId} />}
    </div>
  );
}

export function AdminLinksList({ embeddedBookId }: { embeddedBookId?: string }) {
  const isEmbedded = Boolean(embeddedBookId);
  const { showToast, refreshCatalog } = useAppContext();
  const [books, setBooks] = useState<Book[]>([]);
  const [selectedBookId, setSelectedBookId] = useState(embeddedBookId ?? '');
  const [bookSearchTerm, setBookSearchTerm] = useState('');
  const [isBookSearchOpen, setIsBookSearchOpen] = useState(false);
  const [links, setLinks] = useState<AnswerLink[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [verificationFilter, setVerificationFilter] = useState<'전체' | '검증 완료' | '미검증'>('전체');
  const [form, setForm] = useState({ title: '', url: '', source_name: '', link_type: '', verified: false });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isBooksLoading, setIsBooksLoading] = useState(true);
  const [isLinksLoading, setIsLinksLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    const loadBooks = async () => {
      try {
        if (!hasSupabaseConfig()) throw new Error('Supabase 환경 변수를 확인해 주세요.');
        const { getBooks } = await import('../../lib/supabase/books');
        const result = await getBooks();
        if (!active) return;
        setBooks(result);
        const initialBook = result.find(book => book.id === embeddedBookId) ?? result[0];
        setSelectedBookId(current => current || initialBook?.id || '');
        setBookSearchTerm(initialBook ? getAdminBookLabel(initialBook) : '');
      } catch (loadError) {
        if (active) setError(getAdminDataError(loadError));
      } finally {
        if (active) setIsBooksLoading(false);
      }
    };
    void loadBooks();
    return () => { active = false; };
  }, [embeddedBookId]);

  useEffect(() => {
    let active = true;
    if (!selectedBookId) {
      setLinks([]);
      setIsLinksLoading(false);
      return () => { active = false; };
    }
    const loadLinks = async () => {
      setIsLinksLoading(true);
      setError('');
      try {
        const { getAnswerLinksByBookId } = await import('../../lib/supabase/answerLinks');
        const result = await getAnswerLinksByBookId(selectedBookId);
        if (active) setLinks(result);
      } catch (loadError) {
        if (active) setError(getAdminDataError(loadError));
      } finally {
        if (active) setIsLinksLoading(false);
      }
    };
    void loadLinks();
    return () => { active = false; };
  }, [selectedBookId]);

  const resetForm = () => {
    setForm({ title: '', url: '', source_name: '', link_type: '', verified: false });
    setEditingId(null);
  };

  const handleSave = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedBookId) return;
    setIsSaving(true);
    setError('');
    try {
      const { createAnswerLink, updateAnswerLink } = await import('../../lib/supabase/answerLinks');
      const values = {
        title: form.title.trim(),
        url: form.url.trim(),
        source_name: form.source_name.trim() || undefined,
        link_type: form.link_type.trim() || undefined,
        verified: form.verified
      };
      if (editingId) {
        const saved = await updateAnswerLink(editingId, values);
        setLinks(current => current.map(link => link.id === saved.id ? saved : link));
        showToast('답지 링크가 수정되었습니다.');
      } else {
        const saved = await createAnswerLink({ ...values, book_id: selectedBookId });
        setLinks(current => [saved, ...current]);
        showToast('답지 링크가 추가되었습니다.');
      }
      await refreshCatalog();
      resetForm();
    } catch (saveError) {
      setError(getAdminDataError(saveError));
    } finally {
      setIsSaving(false);
    }
  };

  const handleEdit = (link: AnswerLink) => {
    setEditingId(link.id);
    setForm({
      title: link.title ?? '',
      url: link.url ?? '',
      source_name: link.source_name ?? '',
      link_type: link.link_type ?? '',
      verified: Boolean(link.verified)
    });
  };

  const handleDelete = async (link: AnswerLink) => {
    if (!window.confirm(`'${link.title}' 답지 링크를 삭제할까요?`)) return;
    setDeletingId(link.id);
    setError('');
    try {
      const { deleteAnswerLink } = await import('../../lib/supabase/answerLinks');
      await deleteAnswerLink(link.id);
      setLinks(current => current.filter(item => item.id !== link.id));
      await refreshCatalog();
      if (editingId === link.id) resetForm();
      showToast('답지 링크가 삭제되었습니다.');
    } catch (deleteError) {
      setError(getAdminDataError(deleteError));
    } finally {
      setDeletingId(null);
    }
  };

  const inputClass = 'w-full px-4 py-2.5 text-xs bg-[#F9FAFB] border border-[#E5E8EB] rounded-2xl text-[#191F28] outline-none focus:border-[#3182F6]';
  const selectedBook = books.find(book => book.id === selectedBookId);
  const normalizedBookQuery = bookSearchTerm.trim().toLocaleLowerCase();
  const matchingBooks = useMemo(() => books.filter(book => {
    if (!normalizedBookQuery) return true;
    const searchable = [book.title, book.publisher, book.subject, book.grade, book.semester, book.series, book.edition, book.curriculum_revision]
      .filter(Boolean).join(' ').toLocaleLowerCase();
    return searchable.includes(normalizedBookQuery);
  }), [books, normalizedBookQuery]);
  const visibleLinks = useMemo(() => {
    const query = searchTerm.trim().toLocaleLowerCase();
    return links.filter(link => {
      const searchable = [link.title, link.url, link.source_name, link.link_type].filter(Boolean).join(' ').toLocaleLowerCase();
      return (!query || searchable.includes(query)) &&
        (verificationFilter === '전체' || (verificationFilter === '검증 완료' ? link.verified : !link.verified));
    });
  }, [links, searchTerm, verificationFilter]);

  const content = <div className="space-y-5">
      <div className="space-y-1">
        <h2 className={`${isEmbedded ? 'text-lg' : 'text-xl'} font-extrabold text-[#191F28]`}>답지 링크 관리</h2>
        <p className="text-sm text-[#667085]">{isEmbedded ? '이 교재에 연결된 답지 링크를 추가·수정·삭제할 수 있습니다.' : '교재별 답지 링크와 검증 상태를 관리합니다.'}</p>
      </div>
      {error && <div role="alert" className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-[#D0D5DD] bg-[#F9FAFB] p-4 text-sm text-[#344054]"><span>{error}</span><button onClick={() => window.location.reload()} className="rounded-lg border border-[#D0D5DD] bg-white px-3 py-2 font-semibold hover:bg-[#F2F4F6]">다시 불러오기</button></div>}

      {!isEmbedded && <section className="bg-white rounded-2xl border border-[#E5E8EB] p-4 sm:p-5 space-y-2">
        <label htmlFor="answer-link-book-search" className="block text-sm font-semibold text-[#344054]">관리할 교재 검색</label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#667085]" />
          <input
            id="answer-link-book-search"
            type="search"
            role="combobox"
            aria-expanded={isBookSearchOpen && matchingBooks.length > 0}
            aria-controls="answer-link-book-results"
            aria-autocomplete="list"
            autoComplete="off"
            value={bookSearchTerm}
            onFocus={() => setIsBookSearchOpen(true)}
            onChange={event => { setBookSearchTerm(event.target.value); setIsBookSearchOpen(true); }}
            onKeyDown={event => { if (event.key === 'Escape') setIsBookSearchOpen(false); }}
            disabled={isBooksLoading || books.length === 0}
            placeholder={isBooksLoading ? '교재 목록을 불러오는 중…' : '교재명, 출판사, 과목, 학년으로 검색'}
            className="w-full min-h-11 rounded-xl border border-[#D0D5DD] bg-white py-3 pl-10 pr-3 text-sm text-[#191F28] outline-none focus:border-[#667085] disabled:bg-[#F9FAFB]"
          />
          {isBookSearchOpen && !isBooksLoading && books.length > 0 && <div id="answer-link-book-results" role="listbox" aria-label="교재 검색 결과" className="absolute z-30 mt-2 max-h-72 w-full overflow-y-auto rounded-xl border border-[#D0D5DD] bg-white p-1 shadow-lg">
            {matchingBooks.length ? matchingBooks.slice(0, 100).map(book => <button
              key={book.id}
              type="button"
              role="option"
              aria-selected={book.id === selectedBookId}
              onClick={() => {
                setSelectedBookId(book.id);
                setBookSearchTerm(getAdminBookLabel(book));
                setIsBookSearchOpen(false);
                resetForm();
              }}
              className={`block w-full rounded-lg px-3 py-2.5 text-left text-sm hover:bg-[#F9FAFB] ${book.id === selectedBookId ? 'bg-[#F2F4F6] font-semibold text-[#191F28]' : 'text-[#344054]'}`}
            ><span className="block break-words">{getAdminBookLabel(book)}</span></button>) : <p className="px-3 py-4 text-sm text-[#667085]">검색 결과가 없습니다.</p>}
            {matchingBooks.length > 100 && <p className="px-3 py-2 text-xs text-[#667085]">검색 결과가 많아 앞의 100개만 표시합니다. 검색어를 더 입력해 주세요.</p>}
          </div>}
        </div>
        {selectedBook && <p className="text-xs leading-5 text-[#667085]">선택된 교재: <span className="font-semibold text-[#344054]">{getAdminBookLabel(selectedBook)}</span></p>}
        {isBooksLoading && <p role="status" className="text-sm text-[#667085]">교재 목록을 불러오고 있습니다.</p>}
        {!isBooksLoading && !error && books.length === 0 && <p className="text-sm text-[#667085]">등록된 교재가 없습니다. 먼저 교재를 추가해 주세요.</p>}
      </section>}

      {selectedBook && <div className="flex items-center justify-between gap-3">
        <h3 className="min-w-0 break-words text-base font-bold leading-6 text-[#191F28]">{selectedBook.title} <span className="text-sm font-medium text-[#667085]">답지 링크 ({links.length})</span></h3>
        {!editingId && <button onClick={resetForm} className="shrink-0 rounded-xl bg-[#191F28] px-4 py-3 text-sm font-bold text-white hover:bg-[#333D4B]">새 링크 추가</button>}
      </div>}

      {selectedBookId && <form onSubmit={handleSave} className="bg-white rounded-2xl border border-[#E5E8EB] p-5 sm:p-7 space-y-6 shadow-sm">
        <div><h3 className="font-bold text-base text-[#191F28]">{editingId ? '답지 링크 수정' : '답지 링크 추가'}</h3><p className="mt-1 text-sm text-[#667085]">제목과 원본 URL을 입력하세요.</p></div>
        <div className="space-y-2"><label htmlFor="answer-title" className="block text-sm font-semibold text-[#344054]">제목 <span className="text-[#667085]">(필수)</span></label><input id="answer-title" value={form.title} onChange={event => setForm(current => ({ ...current, title: event.target.value }))} required className={inputClass} /></div>
        <div className="space-y-2"><label htmlFor="answer-url" className="block text-sm font-semibold text-[#344054]">원본 URL <span className="text-[#667085]">(필수)</span></label><input id="answer-url" type="url" value={form.url} onChange={event => setForm(current => ({ ...current, url: event.target.value }))} required placeholder="https://..." className={inputClass} /></div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2"><label htmlFor="answer-source" className="block text-sm font-semibold text-[#344054]">출처 이름</label><input id="answer-source" value={form.source_name} onChange={event => setForm(current => ({ ...current, source_name: event.target.value }))} className={inputClass} /></div>
          <div className="space-y-2"><label htmlFor="answer-type" className="block text-sm font-semibold text-[#344054]">답지 제공 방식</label><select id="answer-type" value={form.link_type} onChange={event => setForm(current => ({ ...current, link_type: event.target.value }))} className={inputClass}><option value="">선택해 주세요</option>{ANSWER_LINK_TYPES.map(type => <option key={type} value={type}>{type}</option>)}{form.link_type && !ANSWER_LINK_TYPES.includes(form.link_type as typeof ANSWER_LINK_TYPES[number]) && <option value={form.link_type}>{form.link_type} (기존 값)</option>}</select><p className="text-xs leading-5 text-[#667085]">자료를 저장해야 하면 ‘다운로드’, 브라우저에서 바로 보려면 ‘온라인 PDF 뷰어’ 또는 ‘이미지 보기’를 선택하세요. 버튼은 원본 링크를 새 탭으로 엽니다.</p></div>
        </div>
        <label className="flex min-h-11 items-center gap-3 rounded-xl border border-[#E5E8EB] px-4 text-sm font-semibold text-[#344054]"><input type="checkbox" checked={form.verified} onChange={event => setForm(current => ({ ...current, verified: event.target.checked }))} className="h-4 w-4 accent-[#191F28]" />검증 완료</label>
        <div className="flex flex-col-reverse sm:flex-row gap-2">
          {editingId && <button type="button" onClick={resetForm} className="sm:w-1/3 py-3 bg-[#F2F4F6] text-[#344054] font-bold text-sm rounded-xl">취소</button>}
          <button type="submit" disabled={isSaving} className="flex-1 py-3 bg-[#191F28] hover:bg-[#333D4B] text-white font-bold text-sm rounded-xl disabled:opacity-50">{isSaving ? '저장 중…' : editingId ? '수정 사항 저장' : '링크 등록'}</button>
        </div>
      </form>}

      {selectedBookId && <section className="bg-white rounded-2xl border border-[#E5E8EB] overflow-hidden shadow-sm">
        <div className="space-y-4 border-b border-[#EAECF0] p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3"><h3 className="font-bold text-base text-[#191F28]">등록된 링크</h3><span className="text-sm text-[#667085]">{visibleLinks.length} / {links.length}개</span></div>
          <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_180px] gap-3">
            <label className="relative block"><span className="sr-only">답지 링크 검색</span><Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#667085]" /><input value={searchTerm} onChange={event => setSearchTerm(event.target.value)} placeholder="제목, URL, 출처 검색" className="w-full rounded-xl border border-[#D0D5DD] bg-white py-3 pl-10 pr-3 text-sm text-[#191F28] placeholder:text-[#98A2B3] outline-none focus:border-[#667085]" /></label>
            <label className="space-y-1"><span className="block text-xs font-semibold text-[#475467]">검증 상태</span><select value={verificationFilter} onChange={event => setVerificationFilter(event.target.value as typeof verificationFilter)} className="w-full rounded-xl border border-[#D0D5DD] bg-white px-3 py-3 text-sm text-[#191F28] outline-none focus:border-[#667085]"><option>전체</option><option>검증 완료</option><option>미검증</option></select></label>
          </div>
        </div>
        {isLinksLoading ? <p role="status" className="p-10 text-center text-sm text-[#667085]">답지 링크를 불러오고 있습니다.</p> : error ? <p className="p-10 text-center text-sm text-[#667085]">답지 링크를 불러오지 못했습니다. 위 오류를 확인해 주세요.</p> :
          links.length === 0 ? <p className="p-10 text-center text-sm text-[#667085]">이 교재에 등록된 답지 링크가 없습니다.</p> : visibleLinks.length === 0 ? <p className="p-10 text-center text-sm text-[#667085]">조건에 맞는 링크가 없습니다. 검색어나 필터를 확인해 주세요.</p> :
          <div className="divide-y divide-[#EAECF0]">{visibleLinks.map(link =>
            <div key={link.id} className="p-5 sm:p-6 flex flex-col sm:flex-row sm:items-start justify-between gap-4">
              <div className="min-w-0 space-y-2">
                <div className="flex flex-wrap items-center gap-2"><span className="break-words font-bold text-base leading-6 text-[#191F28]">{link.title}</span><span className={link.verified ? 'text-xs text-[#344054] font-semibold bg-[#F2F4F6] px-2.5 py-1 rounded-full' : 'text-xs text-[#667085] font-semibold bg-[#F9FAFB] border border-[#EAECF0] px-2.5 py-1 rounded-full'}>{link.verified ? '검증 완료' : '미검증'}</span></div>
                <a href={link.url} target="_blank" rel="noreferrer" className="block max-w-full break-all whitespace-normal font-mono text-sm leading-6 text-[#667085] hover:text-[#191F28]">{link.url}</a>
                <p className="break-words text-sm text-[#667085]">{[link.source_name, link.link_type, link.last_checked_at ? `확인 ${new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium' }).format(new Date(link.last_checked_at))}` : ''].filter(Boolean).join(' · ') || '출처 정보 없음'}</p>
              </div>
              <div className="flex gap-2 sm:shrink-0">
                <button onClick={() => handleEdit(link)} className="rounded-lg border border-[#D0D5DD] bg-white px-3 py-2.5 text-sm font-semibold text-[#344054] hover:bg-[#F2F4F6]">수정</button>
                <button onClick={() => void handleDelete(link)} disabled={deletingId === link.id} className="rounded-lg border border-[#D0D5DD] bg-[#F9FAFB] px-3 py-2.5 text-sm font-semibold text-[#344054] hover:bg-[#F2F4F6] disabled:opacity-50">{deletingId === link.id ? '삭제 중…' : '삭제'}</button>
              </div>
            </div>
          )}</div>
        }
      </section>}
    </div>;

  return isEmbedded ? <section className="space-y-5 border-t border-[#EAECF0] pt-7">{content}</section> : renderAdminLayout(content);
}
