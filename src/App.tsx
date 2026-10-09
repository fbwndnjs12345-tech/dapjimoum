import { lazy, Suspense, useState, useEffect, useCallback, useRef } from 'react';
import type { Book, AnswerLink } from './types/book';
import { Header } from './components/layout/Header';
import { Footer } from './components/layout/Footer';
import { AppStateContext } from './state/AppStateContext';
import { HomePage, SearchPage, BookDetailPage, BookmarksPage, RedirectPage, LoginPage, AdminDashboard, AdminBooksList, AdminBookForm, AdminCsvImport } from './app/pages';
import { AlertCircle, Trash2, CheckCircle2, X, Send, AlertTriangle, Sparkles } from 'lucide-react';
import { updateSeoMetadata } from './lib/seo';

const AdminLinkSearchPage = lazy(() => import('./app/pages/adminLinkSearch').then(module => ({ default: module.AdminLinkSearchPage })));

const CURRICULUM_REVISION_OPTIONS = ['2015 개정', '2022 개정'];
function readCurriculumRevisionFromUrl() {
  const revision = new URLSearchParams(window.location.search).get('curriculum');
  return CURRICULUM_REVISION_OPTIONS.includes(revision ?? '') ? revision! : '전체';
}

function readRouteInfo() {
  const pathname = window.location.pathname.replace(/\/+$/, '') || '/';
  const bookMatch = pathname.match(/^\/books\/([^/]+)$/);
  if (bookMatch) {
    let id = bookMatch[1];
    try { id = decodeURIComponent(id); } catch { /* Keep the raw path segment. */ }
    return { route: pathname, params: { id } };
  }
  const redirectMatch = pathname.match(/^\/go\/([^/]+)$/);
  if (redirectMatch) return { route: pathname, params: { id: redirectMatch[1] } };
  return { route: pathname, params: {} as Record<string, string> };
}

export default function App() {
  // State management
  const [books, setBooks] = useState<Book[]>([]);
  const [links, setLinks] = useState<AnswerLink[]>([]);
  const [catalogStatus, setCatalogStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [catalogError, setCatalogError] = useState('');
  const catalogRequestId = useRef(0);

  const [bookmarks, setBookmarks] = useState<string[]>(() => {
    const saved = localStorage.getItem('dapji_bookmarks_v3');
    return saved ? JSON.parse(saved) : [];
  });

  const [isAdminLoggedIn, setIsAdminLoggedIn] = useState(false);
  const [isAuthLoading, setIsAuthLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    let subscription: { unsubscribe: () => void } | undefined;

    const initializeAuth = async () => {
      try {
        const { supabase } = await import('./lib/supabase/client');
        const { data: { session } } = await supabase.auth.getSession();
        if (!isMounted) return;
        setIsAdminLoggedIn(Boolean(session));
        const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
          setIsAdminLoggedIn(Boolean(nextSession));
        });
        subscription = data.subscription;
      } catch {
        if (isMounted) setIsAdminLoggedIn(false);
      } finally {
        if (isMounted) setIsAuthLoading(false);
      }
    };

    void initializeAuth();
    return () => {
      isMounted = false;
      subscription?.unsubscribe();
    };
  }, []);

  // App navigation router
  const [currentRoute, setCurrentRoute] = useState(() => readRouteInfo().route);
  const [routeParams, setRouteParams] = useState<Record<string, string>>(() => readRouteInfo().params);

  // Filter & Search states
  const [searchQuery, setSearchQuery] = useState(() => new URLSearchParams(window.location.search).get('q') ?? '');
  const [curriculumRevisionFilter, setCurriculumRevisionFilter] = useState(readCurriculumRevisionFromUrl);
  const [subjectFilter, setSubjectFilter] = useState('전체');
  const [gradeFilter, setGradeFilter] = useState('전체');
  const [semesterFilter, setSemesterFilter] = useState('전체');
  const [publisherFilter, setPublisherFilter] = useState('전체');
  const [sortBy, setSortBy] = useState('popular'); // default Toss style: top relevant/popular

  // Modal Dialog states (Request Book / Report Broken Link / Delete Dialog)
  const [isRequestModalOpen, setIsRequestModalOpen] = useState(false);
  const [requestBookName, setRequestBookName] = useState('');
  const [requestBookPublisher, setRequestBookPublisher] = useState('');

  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  const [reportTargetLink, setReportTargetLink] = useState<AnswerLink | null>(null);
  const [reportReason, setReportReason] = useState('깨진 링크 / 페이지 없음');

  const [confirmDeleteDialog, setConfirmDeleteDialog] = useState(null);

  // Minimal Toast Notification
  const [toastMessage, setToastMessage] = useState(null);

  const refreshCatalog = useCallback(async () => {
    const requestId = ++catalogRequestId.current;
    setCatalogStatus('loading');
    setCatalogError('');
    try {
      if (!import.meta.env.NEXT_PUBLIC_SUPABASE_URL || !import.meta.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
        throw new Error('Supabase 환경 변수를 확인해 주세요.');
      }
      const [{ getBooks }, { getAnswerLinks }] = await Promise.all([
        import('./lib/supabase/books'),
        import('./lib/supabase/answerLinks')
      ]);
      const [catalog, answerLinks] = await Promise.all([getBooks(), getAnswerLinks()]);
      if (requestId !== catalogRequestId.current) return;
      setBooks(catalog);
      setLinks(answerLinks);
      setCatalogStatus('success');
    } catch (error) {
      if (requestId !== catalogRequestId.current) return;
      setBooks([]);
      setLinks([]);
      setCatalogError(error instanceof Error ? error.message : 'Supabase 데이터를 불러오지 못했습니다.');
      setCatalogStatus('error');
    }
  }, []);

  useEffect(() => {
    void refreshCatalog();
    const reloadCatalog = () => { void refreshCatalog(); };
    window.addEventListener('catalog-data-updated', reloadCatalog);
    return () => window.removeEventListener('catalog-data-updated', reloadCatalog);
  }, [refreshCatalog, isAdminLoggedIn]);

  useEffect(() => {
    localStorage.setItem('dapji_bookmarks_v3', JSON.stringify(bookmarks));
  }, [bookmarks]);

  const showToast = (msg, type = 'info') => {
    setToastMessage({ msg, type });
    setTimeout(() => {
      setToastMessage(null);
    }, 2800);
  };

  const navigateTo = (path, params = {}) => {
    const nextUrl = new URL(path, window.location.origin);
    nextUrl.pathname = nextUrl.pathname.replace(/\/+$/, '') || '/';
    if (nextUrl.pathname === '/search' && !nextUrl.searchParams.has('q') && searchQuery.trim()) {
      nextUrl.searchParams.set('q', searchQuery.trim());
    }
    if (nextUrl.pathname === '/search' && !nextUrl.searchParams.has('curriculum') && curriculumRevisionFilter !== '전체') {
      nextUrl.searchParams.set('curriculum', curriculumRevisionFilter);
    }
    window.history.pushState({}, '', `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`);
    const routeInfo = readRouteInfo();
    setCurrentRoute(routeInfo.route);
    setRouteParams({ ...routeInfo.params, ...params });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  useEffect(() => {
    const handlePopState = () => {
      const routeInfo = readRouteInfo();
      setCurrentRoute(routeInfo.route);
      setRouteParams(routeInfo.params);
      if (routeInfo.route === '/search') {
        const searchParams = new URLSearchParams(window.location.search);
        setSearchQuery(searchParams.get('q') ?? '');
        const revision = searchParams.get('curriculum');
        setCurriculumRevisionFilter(CURRICULUM_REVISION_OPTIONS.includes(revision ?? '') ? revision! : '전체');
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    if (currentRoute === '/search') {
      const nextUrl = new URL(window.location.href);
      if (searchQuery.trim()) nextUrl.searchParams.set('q', searchQuery.trim());
      else nextUrl.searchParams.delete('q');
      if (curriculumRevisionFilter !== '전체') nextUrl.searchParams.set('curriculum', curriculumRevisionFilter);
      else nextUrl.searchParams.delete('curriculum');
      window.history.replaceState({}, '', `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`);
    }
  }, [currentRoute, searchQuery, curriculumRevisionFilter]);

  useEffect(() => {
    const canonicalPath = currentRoute.startsWith('/books/') ? currentRoute : currentRoute.split('?')[0];
    if (currentRoute === '/') {
      updateSeoMetadata({
        title: '답지모음 | 교재별 답지 검색',
        description: '교재별 답지 정보를 검색하고 원본 링크를 찾아볼 수 있는 서비스입니다.',
        path: '/',
        structuredData: { '@context': 'https://schema.org', '@type': 'WebSite', name: '답지모음', url: window.location.origin }
      });
    } else if (currentRoute.startsWith('/books/')) {
      updateSeoMetadata({ title: '교재 답지 및 정보 | 답지모음', description: '교재 정보와 등록된 답지 링크를 확인하세요.', path: canonicalPath, robots: 'noindex, follow' });
    } else {
      const isSearch = currentRoute === '/search';
      updateSeoMetadata({
        title: isSearch ? '교재 검색 | 답지모음' : '답지모음',
        description: isSearch ? '교재명과 출판사, 과목, 학년과 학기로 답지 링크를 검색하세요.' : '답지모음 교재 답지 검색 서비스',
        path: isSearch ? '/search' : canonicalPath,
        robots: 'noindex, follow'
      });
    }
  }, [currentRoute]);

  useEffect(() => {
    if (currentRoute === '/admin/links') navigateTo('/admin/books');
  }, [currentRoute]);

  useEffect(() => {
    if (!isAuthLoading && currentRoute.startsWith('/admin') && !isAdminLoggedIn) {
      navigateTo('/login');
    }
  }, [currentRoute, isAdminLoggedIn, isAuthLoading]);

  const handleAdminLogout = async () => {
    try {
      const { supabase } = await import('./lib/supabase/client');
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      setIsAdminLoggedIn(false);
      showToast('로그아웃 되었습니다.');
      if (currentRoute.startsWith('/admin')) navigateTo('/');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '로그아웃하지 못했습니다.');
    }
  };

  const toggleBookmark = (bookId, e) => {
    if (e) e.stopPropagation();
    if (bookmarks.includes(bookId)) {
      setBookmarks(prev => prev.filter(id => id !== bookId));
      showToast('저장 목록에서 제거했습니다.', 'info');
    } else {
      setBookmarks(prev => [...prev, bookId]);
      showToast('교재를 저장했습니다.', 'success');
    }
  };

  const appState = { books, setBooks, links, setLinks, catalogStatus, catalogError, refreshCatalog, bookmarks, setBookmarks, isAdminLoggedIn, setIsAdminLoggedIn, currentRoute, routeParams, searchQuery, setSearchQuery, subjectFilter, setSubjectFilter, gradeFilter, setGradeFilter, semesterFilter, setSemesterFilter, publisherFilter, setPublisherFilter, curriculumRevisionFilter, setCurriculumRevisionFilter, sortBy, setSortBy, isRequestModalOpen, setIsRequestModalOpen, requestBookName, setRequestBookName, requestBookPublisher, setRequestBookPublisher, isReportModalOpen, setIsReportModalOpen, reportTargetLink, setReportTargetLink, reportReason, setReportReason, confirmDeleteDialog, setConfirmDeleteDialog, toastMessage, setToastMessage, showToast, navigateTo, toggleBookmark };

  const renderHeader = () => <Header navigateTo={navigateTo} currentRoute={currentRoute} bookmarks={bookmarks} isAdminLoggedIn={isAdminLoggedIn} onLogout={handleAdminLogout} />;

  const renderToast = () => {
    if (!toastMessage) return null;
    return (
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-bounce-short">
        <div className="bg-[#191F28]/95 backdrop-blur-md text-white text-xs sm:text-sm font-semibold px-5 py-3 rounded-full shadow-2xl flex items-center gap-2.5 border border-white/10">
          {toastMessage.type === 'error' && <AlertCircle className="w-4 h-4 text-[#F04438]" />}
          {toastMessage.type === 'success' && <CheckCircle2 className="w-4 h-4 text-[#12B76A]" />}
          {toastMessage.type === 'info' && <Sparkles className="w-4 h-4 text-[#3182F6]" />}
          <span>{toastMessage.msg}</span>
        </div>
      </div>
    );
  };

  const renderModals = () => (
    <>
      {/* Book Request Modal */}
      {isRequestModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 sm:p-8 w-full max-w-md space-y-5 shadow-2xl animate-in fade-in zoom-in duration-200">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-[#E8F3FF] text-[#3182F6] flex items-center justify-center font-bold">
                  <Send className="w-4 h-4" />
                </div>
                <h3 className="text-lg font-bold text-[#191F28]">찾는 답지 요청하기</h3>
              </div>
              <button 
                onClick={() => setIsRequestModalOpen(false)}
                className="p-1 rounded-full text-[#8B95A1] hover:bg-[#F2F4F6]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-[#6B7684] leading-relaxed">
              원하는 교재의 답지가 없나요? 교재명과 출판사를 알려주시면 등록 여부를 확인하겠습니다.
            </p>

            <form onSubmit={(e) => {
              e.preventDefault();
              if (!requestBookName) return;
              setIsRequestModalOpen(false);
              setRequestBookName('');
              setRequestBookPublisher('');
              showToast('답지 요청이 성공적으로 접수되었습니다!', 'success');
            }} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-[#333D4B]">교재명 *</label>
                <input
                  type="text"
                  placeholder="예: 쎈 고등 수학(하), 자이스토리 영어"
                  value={requestBookName}
                  onChange={(e) => setRequestBookName(e.target.value)}
                  required
                  className="w-full px-4 py-3 text-sm bg-[#F9FAFB] border border-[#E5E8EB] rounded-2xl outline-none focus:border-[#3182F6] focus:bg-white transition-all"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-[#333D4B]">출판사</label>
                <input
                  type="text"
                  placeholder="예: 좋은책신사고, 비상교육"
                  value={requestBookPublisher}
                  onChange={(e) => setRequestBookPublisher(e.target.value)}
                  className="w-full px-4 py-3 text-sm bg-[#F9FAFB] border border-[#E5E8EB] rounded-2xl outline-none focus:border-[#3182F6] focus:bg-white transition-all"
                />
              </div>

              <div className="pt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsRequestModalOpen(false)}
                  className="w-1/2 py-3 bg-[#F2F4F6] text-[#4E5968] font-bold text-sm rounded-2xl hover:bg-[#E5E8EB] transition-colors"
                >
                  취소
                </button>
                <button
                  type="submit"
                  className="w-1/2 py-3 bg-[#3182F6] text-white font-bold text-sm rounded-2xl hover:bg-[#1B64DA] shadow-md shadow-[#3182F6]/20 transition-colors"
                >
                  요청 제출
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Broken Link Report Modal */}
      {isReportModalOpen && reportTargetLink && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 sm:p-8 w-full max-w-md space-y-5 shadow-2xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-[#FFEEEC] text-[#F04438] flex items-center justify-center font-bold">
                  <AlertTriangle className="w-4 h-4" />
                </div>
                <h3 className="text-lg font-bold text-[#191F28]">오류 링크 신고</h3>
              </div>
              <button 
                onClick={() => setIsReportModalOpen(false)}
                className="p-1 rounded-full text-[#8B95A1] hover:bg-[#F2F4F6]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-[#F9FAFB] p-3.5 rounded-2xl border border-[#E5E8EB] text-xs space-y-1">
              <span className="text-[#8B95A1] block font-medium">신고 대상 링크</span>
              <div className="font-bold text-[#191F28]">{reportTargetLink.title}</div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold text-[#333D4B]">신고 사유 선택</label>
              <div className="space-y-1.5">
                {['깨진 링크 / 페이지 접속 불가', '다른 교재 답지가 연결됨', '광고나 이상한 사이트로 연결됨', '기타'].map(reason => (
                  <button
                    key={reason}
                    type="button"
                    onClick={() => setReportReason(reason)}
                    className={`w-full text-left px-4 py-2.5 rounded-xl text-xs font-semibold border transition-all ${
                      reportReason === reason
                        ? 'border-[#3182F6] bg-[#E8F3FF] text-[#1B64DA]'
                        : 'border-[#E5E8EB] bg-white text-[#4E5968] hover:bg-[#F9FAFB]'
                    }`}
                  >
                    {reason}
                  </button>
                ))}
              </div>
            </div>

            <div className="pt-2 flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIsReportModalOpen(false)}
                className="w-1/2 py-3 bg-[#F2F4F6] text-[#4E5968] font-bold text-sm rounded-2xl hover:bg-[#E5E8EB]"
              >
                취소
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsReportModalOpen(false);
                  showToast('신고가 접수되었습니다. 빠르게 점검하겠습니다.', 'info');
                }}
                className="w-1/2 py-3 bg-[#F04438] text-white font-bold text-sm rounded-2xl hover:bg-[#D92D20]"
              >
                신고 보내기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {confirmDeleteDialog && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 w-full max-w-sm text-center space-y-4 shadow-2xl">
            <div className="w-12 h-12 bg-[#FFEEEC] text-[#F04438] rounded-2xl flex items-center justify-center mx-auto">
              <Trash2 className="w-6 h-6" />
            </div>
            <div className="space-y-1">
              <h3 className="text-base font-bold text-[#191F28]">{confirmDeleteDialog.title}</h3>
              <p className="text-xs text-[#6B7684]">{confirmDeleteDialog.message}</p>
            </div>
            <div className="flex gap-2 pt-2">
              <button
                onClick={() => setConfirmDeleteDialog(null)}
                className="w-1/2 py-2.5 bg-[#F2F4F6] text-[#4E5968] text-xs font-bold rounded-xl"
              >
                취소
              </button>
              <button
                onClick={() => {
                  confirmDeleteDialog.onConfirm();
                  setConfirmDeleteDialog(null);
                }}
                className="w-1/2 py-2.5 bg-[#F04438] text-white text-xs font-bold rounded-xl"
              >
                삭제하기
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );

  const adminBookScreen: 'list' | 'create' | 'edit' | null = currentRoute === '/admin/books'
    ? 'list'
    : currentRoute === '/admin/books/new'
      ? 'create'
      : currentRoute.startsWith('/admin/books/')
        ? 'edit'
        : null;

  const isKnownRoute = ['/', '/search', '/bookmarks', '/login', '/admin', '/admin/books', '/admin/books/new', '/admin/links', '/admin/import', '/admin/link-search'].includes(currentRoute)
    || currentRoute.startsWith('/books/')
    || currentRoute.startsWith('/go/')
    || (currentRoute.startsWith('/admin/books/') && currentRoute !== '/admin/books/new');


  return (
    <AppStateContext.Provider value={appState}>
    <div className="min-h-screen bg-[#FFFFFF] text-[#191F28] font-sans flex flex-col justify-between selection:bg-[#3182F6] selection:text-white" style={{ fontFamily: "'Pretendard', -apple-system, BlinkMacSystemFont, system-ui, Roboto, sans-serif" }}>
      <div>
        {renderHeader()}

        <main>
          {currentRoute === '/' && <HomePage />}
          {currentRoute === '/search' && <SearchPage />}
          {currentRoute === '/bookmarks' && <BookmarksPage />}
          {currentRoute.startsWith('/books/') && <BookDetailPage />}
          {currentRoute.startsWith('/go/') && <RedirectPage />}
          {currentRoute === '/login' && <LoginPage />}
          {currentRoute.startsWith('/admin') && isAuthLoading && <div className="py-16 text-center text-xs text-[#8B95A1]">로그인 상태를 확인하고 있습니다.</div>}
          {!isAuthLoading && isAdminLoggedIn && currentRoute === '/admin' && <AdminDashboard />}
          {!isAuthLoading && isAdminLoggedIn && adminBookScreen === 'list' && <AdminBooksList />}
          {!isAuthLoading && isAdminLoggedIn && adminBookScreen === 'create' && <AdminBookForm mode="create" />}
          {!isAuthLoading && isAdminLoggedIn && adminBookScreen === 'edit' && <AdminBookForm mode="edit" />}
          {!isAuthLoading && isAdminLoggedIn && currentRoute === '/admin/import' && <AdminCsvImport />}
          {!isAuthLoading && isAdminLoggedIn && currentRoute === '/admin/link-search' && <Suspense fallback={<div role="status" className="py-16 text-center text-xs text-[#8B95A1]">자동 검색 화면을 불러오고 있습니다.</div>}><AdminLinkSearchPage /></Suspense>}
          {!isKnownRoute && <section className="max-w-xl mx-auto px-5 py-20 text-center space-y-3"><h1 className="text-xl font-bold text-[#191F28]">페이지를 찾을 수 없습니다</h1><p className="text-sm text-[#8B95A1]">주소가 변경되었거나 페이지가 존재하지 않습니다.</p><a href="/" onClick={event => { event.preventDefault(); navigateTo('/'); }} className="inline-flex mt-3 px-5 py-2.5 bg-[#191F28] text-white text-xs font-bold rounded-2xl">홈으로</a></section>}
        </main>
      </div>

      {renderToast()}
      {renderModals()}

      <Footer navigateTo={navigateTo} />
    </div>
    </AppStateContext.Provider>
  );
}
