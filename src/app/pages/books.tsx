import { useEffect, useState } from 'react';
import type { AnswerLink, Book } from '../../types/book';
import { ExternalLink, AlertCircle, Link as LinkIcon, ChevronRight, ArrowLeft, X, HelpCircle, Bookmark } from 'lucide-react';

import { useAppContext } from '../../state/useAppContext';
import { AnswerLinkCard } from '../../components/books/AnswerLinkCard';
import { BookThumbnail } from '../../components/books/BookThumbnail';
import { updateSeoMetadata } from '../../lib/seo';
import { isPlaceholderBook } from '../../lib/catalog';

function isHttpUrl(value?: string | null): value is string {
  if (!value) return false;
  try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; }
}

export function BookDetailPage() {
    const {setLinks, bookmarks, routeParams, setIsRequestModalOpen, setIsReportModalOpen, setReportTargetLink, navigateTo, toggleBookmark} = useAppContext();
    const bookId = routeParams.id;
    const [supabaseBook, setSupabaseBook] = useState<Book | null>();
    const [supabaseLinks, setSupabaseLinks] = useState<AnswerLink[] | undefined>();
    const [relatedBooks, setRelatedBooks] = useState<Book[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isLinksLoading, setIsLinksLoading] = useState(true);
    const [bookError, setBookError] = useState('');
    const [linksError, setLinksError] = useState('');

    useEffect(() => {
      let isCurrentRequest = true;
      setIsLoading(true);
      setBookError('');
      setLinksError('');

      const loadBook = async () => {
        const { NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY } = import.meta.env;
        if (!bookId || !NEXT_PUBLIC_SUPABASE_URL || !NEXT_PUBLIC_SUPABASE_ANON_KEY) {
          setSupabaseBook(undefined);
          setSupabaseLinks(undefined);
          setRelatedBooks([]);
          setBookError('Supabase 환경 변수를 확인할 수 없어 교재 정보를 불러오지 못했습니다.');
          setLinksError('Supabase 환경 변수를 확인할 수 없어 답지 링크를 불러오지 못했습니다.');
          setIsLoading(false);
          setIsLinksLoading(false);
          return;
        }

        setIsLinksLoading(true);
        const bookRequest = import('../../lib/supabase/books')
          .then(({ getBookById }) => getBookById(bookId));
        const answerLinksRequest = import('../../lib/supabase/answerLinks')
          .then(({ getAnswerLinksByBookId }) => getAnswerLinksByBookId(bookId));

        let loadedBook: Book | null = null;
        try {
          const result = await bookRequest;
          loadedBook = result;
          if (isCurrentRequest) setSupabaseBook(result && !isPlaceholderBook(result) ? result : null);
        } catch (error) {
          if (isCurrentRequest) {
            setSupabaseBook(undefined);
            setBookError(error instanceof Error ? error.message : '교재 정보를 불러오지 못했습니다.');
          }
        } finally {
          if (isCurrentRequest) setIsLoading(false);
        }

        try {
          const result = await answerLinksRequest;
          if (isCurrentRequest) { setSupabaseLinks(result); setLinksError(''); }
        } catch (error) {
          if (isCurrentRequest) {
            setSupabaseLinks(undefined);
            setLinksError(error instanceof Error ? error.message : '답지 링크를 불러오지 못했습니다.');
          }
        } finally {
          if (isCurrentRequest) setIsLinksLoading(false);
        }

        if (loadedBook) {
          try {
            const { getBooks } = await import('../../lib/supabase/books');
            const allBooks = await getBooks();
            const related = allBooks
              .filter(candidate => !isPlaceholderBook(candidate) && candidate.id !== loadedBook?.id && (
                (Boolean(loadedBook?.subject) && candidate.subject === loadedBook.subject) ||
                (Boolean(loadedBook?.publisher) && candidate.publisher === loadedBook.publisher) ||
                (Boolean(loadedBook?.series) && candidate.series === loadedBook.series)
              ))
              .sort((a, b) => {
                const score = (candidate: Book) =>
                  Number(Boolean(loadedBook?.subject) && candidate.subject === loadedBook.subject) * 2 +
                  Number(Boolean(loadedBook?.series) && candidate.series === loadedBook.series) * 2 +
                  Number(Boolean(loadedBook?.publisher) && candidate.publisher === loadedBook.publisher);
                return score(b) - score(a);
              })
              .slice(0, 4);
            if (isCurrentRequest) setRelatedBooks(related);
          } catch {
            if (isCurrentRequest) setRelatedBooks([]);
          }
        }
      };

      void loadBook();
      return () => { isCurrentRequest = false; };
    }, [bookId]);

    const book = supabaseBook;

    useEffect(() => {
      if (isLoading) return;
      const catalogFacts = [supabaseBook?.publisher, supabaseBook?.subject, supabaseBook?.grade, supabaseBook?.semester, supabaseBook?.series, supabaseBook?.edition]
        .filter(value => Boolean(value?.trim()));
      const hasPlaceholderText = /테스트|샘플|seed|example|예시|mock|placeholder/i.test([
        supabaseBook?.title, supabaseBook?.publisher, supabaseBook?.subject, supabaseBook?.grade,
        supabaseBook?.semester, supabaseBook?.series, supabaseBook?.edition, supabaseBook?.description
      ].join(' '));
      const seoReady = Boolean(
        supabaseBook &&
        supabaseBook.publisher &&
        catalogFacts.length >= 3 &&
        !hasPlaceholderText
      );

      if (!supabaseBook || !seoReady) {
        updateSeoMetadata({
          title: supabaseBook?.title ? `${supabaseBook.title} | 답지모음` : '교재를 찾을 수 없습니다 | 답지모음',
          description: '교재 정보와 등록된 답지 링크를 확인하세요.',
          path: `/books/${encodeURIComponent(bookId ?? '')}`,
          robots: 'noindex, follow'
        });
        return;
      }

      const detailText = [supabaseBook.title, supabaseBook.publisher, supabaseBook.subject, supabaseBook.grade, supabaseBook.semester, supabaseBook.series, supabaseBook.edition, supabaseBook.description]
        .filter(Boolean).join(' · ').slice(0, 160);
      updateSeoMetadata({
        title: `${supabaseBook.title} 답지·교재 정보 | 답지모음`,
        description: detailText,
        path: `/books/${encodeURIComponent(supabaseBook.id)}`,
        image: supabaseBook.thumbnail_url || undefined,
        structuredData: [
          {
            '@context': 'https://schema.org',
            '@type': 'Book',
            name: supabaseBook.title,
            ...(supabaseBook.publisher ? { publisher: { '@type': 'Organization', name: supabaseBook.publisher } } : {}),
            ...(supabaseBook.subject ? { genre: supabaseBook.subject } : {}),
            ...(supabaseBook.edition ? { bookEdition: supabaseBook.edition } : {}),
            ...(supabaseBook.description ? { description: supabaseBook.description } : {}),
            inLanguage: 'ko'
          },
          {
            '@context': 'https://schema.org',
            '@type': 'BreadcrumbList',
            itemListElement: [
              { '@type': 'ListItem', position: 1, name: '홈', item: window.location.origin },
              { '@type': 'ListItem', position: 2, name: supabaseBook.title, item: window.location.href.split('?')[0] }
            ]
          }
        ]
      });
    }, [bookId, isLoading, supabaseBook, supabaseLinks]);

    if (isLoading) {
      return (
        <div className="max-w-md mx-auto px-5 py-20 text-center space-y-4">
          <span className="inline-block w-8 h-8 border-2 border-[#E5E8EB] border-t-[#3182F6] rounded-full animate-spin" />
          <p className="text-sm font-bold text-[#191F28]">교재 정보를 불러오고 있습니다.</p>
        </div>
      );
    }

    if (bookError) {
      return (
        <div role="alert" className="max-w-md mx-auto px-5 py-20 text-center space-y-4">
          <AlertCircle className="w-10 h-10 text-[#F04438] mx-auto" />
          <h2 className="text-lg font-bold text-[#191F28]">교재 정보를 불러오지 못했습니다</h2>
          <p className="break-words text-xs text-[#8B95A1]">{bookError}</p>
          <button onClick={() => window.location.reload()} className="px-5 py-2.5 bg-[#3182F6] text-white font-bold text-xs rounded-2xl">다시 시도</button>
        </div>
      );
    }

    if (book === null) {
      return (
        <div className="max-w-md mx-auto px-5 py-20 text-center space-y-4">
          <AlertCircle className="w-10 h-10 text-[#F04438] mx-auto" />
          <h2 className="text-lg font-bold text-[#191F28]">공개 가능한 교재 정보가 없습니다</h2>
          <p className="text-xs text-[#8B95A1]">교재가 삭제되었거나 공개 카탈로그에 등록되지 않았습니다.</p>
          <button
            onClick={() => navigateTo('/search')}
            className="px-5 py-2.5 bg-[#3182F6] text-white font-bold text-xs rounded-2xl"
          >
            검색 목록으로 이동
          </button>
        </div>
      );
    }

    const bookLinks = supabaseLinks ?? [];
    const isBookmarked = bookmarks.includes(book.id);
    const handleAnswerLinkOpen = (link: AnswerLink) => {
      if (!link.url.startsWith('https://') && !link.url.startsWith('http://')) return;

      // Open synchronously from the click gesture so popup blockers do not delay navigation.
      window.open(link.url, '_blank', 'noopener,noreferrer');
      const clickId = crypto.randomUUID();
      void import('../../lib/supabase/answerLinks')
        .then(({ recordAnswerLinkClick }) => recordAnswerLinkClick(link.id, clickId))
        .then(clickCount => {
          setSupabaseLinks(current => current?.map(item =>
            item.id === link.id ? { ...item, click_count: clickCount } : item
          ));
          setLinks((current: AnswerLink[]) => current.map(item => item.id === link.id ? { ...item, click_count: clickCount } : item));
        })
        .catch(() => {
          // Navigation is independent from analytics; a failed count must not block the link.
        });
    };

    return (
      <div className="max-w-[860px] mx-auto px-5 py-8 space-y-6">
        {/* Navigation Breadcrumb */}
        <button
          onClick={() => navigateTo('/search')}
          className="inline-flex items-center gap-1.5 text-xs text-[#6B7684] hover:text-[#191F28] font-bold transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>교재 목록으로</span>
        </button>

        {/* Book Header Card */}
        <div className="bg-white rounded-3xl border border-[#E5E8EB] p-6 sm:p-8 flex flex-col sm:flex-row gap-6 shadow-sm relative">
          <BookThumbnail src={book.thumbnail_url} alt={book.title} className="w-28 sm:w-36 h-36 sm:h-48 object-cover rounded-2xl bg-[#F9FAFB] border border-[#E5E8EB] flex-shrink-0 mx-auto sm:mx-0 shadow-md" />

          <div className="space-y-3 flex-1">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-[#E8F3FF] text-[#1B64DA]">
                  {book.publisher || '출판사 미등록'}
                </span>
                <span className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-[#F2F4F6] text-[#4E5968]">
                  {book.subject || '과목 미등록'}
                </span>
                {book.series && (
                  <span className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-[#F2F4F6] text-[#4E5968]">
                    {book.series}
                  </span>
                )}
                {book.edition && (
                  <span className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-[#F2F4F6] text-[#4E5968]">
                    {book.edition}
                  </span>
                )}
                <span className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-[#F2F4F6] text-[#4E5968]">
                  {[book.grade, book.semester].filter(Boolean).join(' · ') || '학년·학기 미등록'}
                </span>
              </div>

              <button
                onClick={(e) => toggleBookmark(book.id, e)}
                className={`px-3 py-1.5 rounded-full text-xs font-bold flex items-center gap-1.5 transition-all ${
                  isBookmarked
                    ? 'bg-[#3182F6] text-white'
                    : 'bg-[#F2F4F6] text-[#4E5968] hover:bg-[#E5E8EB]'
                }`}
              >
                <Bookmark className="w-3.5 h-3.5" />
                <span>{isBookmarked ? '보관됨' : '보관하기'}</span>
              </button>
            </div>

            <h1 className="text-2xl sm:text-3xl font-extrabold text-[#191F28]">{book.title}</h1>

            {book.description ? <p className="text-xs sm:text-sm text-[#6B7684] leading-relaxed">{book.description}</p> : <p className="text-xs sm:text-sm text-[#8B95A1] leading-relaxed">교재 설명 미등록</p>}
            {isHttpUrl(book.book_url) && <a href={book.book_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-bold text-[#3182F6] hover:underline">교재 페이지 보기 <ExternalLink className="h-3.5 w-3.5" /></a>}

            <div className="text-[11px] text-[#8B95A1] font-semibold pt-3 border-t border-[#F2F4F6] flex items-center justify-between">
              <span>등록일: {new Date(book.created_at).toLocaleDateString('ko-KR')}</span>
              <span>공개 답지 링크 <strong className="text-[#3182F6]">{bookLinks.length}</strong>개</span>
            </div>
          </div>
        </div>

        {/* Answer Links List */}
        <div className="space-y-4">
          <div className="flex items-center justify-between border-b border-[#F2F4F6] pb-3">
            <h2 className="text-lg font-bold text-[#191F28] flex items-center gap-2">
              <LinkIcon className="w-5 h-5 text-[#3182F6]" /> 답지 연결 주소 목록
            </h2>
            <button
              onClick={() => setIsRequestModalOpen(true)}
              className="text-xs font-bold text-[#8B95A1] hover:text-[#191F28] flex items-center gap-1"
            >
              <HelpCircle className="w-3.5 h-3.5" /> 다른 답지 필요해요
            </button>
          </div>

          {isLinksLoading ? (
            <div className="bg-white rounded-3xl border border-[#E5E8EB] p-8 text-center space-y-3">
              <span className="inline-block w-7 h-7 border-2 border-[#E5E8EB] border-t-[#3182F6] rounded-full animate-spin" />
              <p className="text-sm font-bold text-[#191F28]">답지 링크를 불러오고 있습니다.</p>
            </div>
          ) : linksError ? (
            <div role="alert" className="bg-white rounded-3xl border border-[#E5E8EB] p-8 text-center space-y-2">
              <p className="text-sm font-bold text-[#191F28]">답지 링크를 불러오지 못했습니다.</p>
              <p className="break-words text-xs text-[#8B95A1]">{linksError}</p>
            </div>
          ) : bookLinks.length === 0 ? (
            <div className="bg-white rounded-3xl border border-[#E5E8EB] p-8 text-center space-y-3">
              <p className="text-sm font-bold text-[#191F28]">등록된 답지 링크가 아직 없습니다.</p>
              <p className="text-xs text-[#8B95A1]">현재 공개된 답지 링크가 없습니다.</p>
              <button
                onClick={() => setIsRequestModalOpen(true)}
                className="px-4 py-2 bg-[#3182F6] text-white font-bold text-xs rounded-2xl"
              >
                빠른 등록 요청
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {bookLinks.map(link => (
                <AnswerLinkCard key={link.id} link={link} onReport={() => { setReportTargetLink(link); setIsReportModalOpen(true); }} onOpen={() => handleAnswerLinkOpen(link)} />
              ))}
            </div>
          )}
        </div>

        {relatedBooks.length > 0 && <section className="space-y-3" aria-labelledby="related-books-heading">
          <h2 id="related-books-heading" className="text-base font-bold text-[#191F28]">관련 교재</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {relatedBooks.map(relatedBook => <a
              key={relatedBook.id}
              href={`/books/${encodeURIComponent(relatedBook.id)}`}
              onClick={event => { event.preventDefault(); navigateTo(`/books/${relatedBook.id}`, { id: relatedBook.id }); }}
              className="bg-white rounded-2xl border border-[#E5E8EB] p-4 hover:border-[#3182F6] transition-colors"
            >
              <span className="text-[10px] font-bold text-[#6B7684]">{relatedBook.publisher} · {relatedBook.subject}</span>
              <span className="mt-1 block text-sm font-bold text-[#191F28]">{relatedBook.title}</span>
              <span className="mt-1 block text-xs text-[#8B95A1]">{relatedBook.grade} {relatedBook.semester}</span>
            </a>)}
          </div>
        </section>}
      </div>
    );
}

export function BookmarksPage() {
    const {books, links, bookmarks, setBookmarks, showToast, navigateTo, toggleBookmark, catalogStatus, catalogError, refreshCatalog} = useAppContext();
    const bookmarkedBooks = books.filter(b => bookmarks.includes(b.id) && !isPlaceholderBook(b));

    return (
      <div className="max-w-[1100px] mx-auto px-5 py-8 space-y-6">
        <div className="border-b border-[#F2F4F6] pb-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[#191F28] flex items-center gap-2">
              <Bookmark className="w-6 h-6 text-[#3182F6] fill-[#3182F6]" /> 저장한 교재
            </h1>
            <p className="text-xs text-[#8B95A1] mt-1 font-medium">
              저장한 교재를 확인할 수 있습니다. (총 <strong className="text-[#3182F6]">{catalogStatus === 'success' ? bookmarkedBooks.length : '—'}</strong>개)
            </p>
          </div>

          {bookmarkedBooks.length > 0 && (
            <button
              onClick={() => {
                setBookmarks([]);
                showToast('저장한 교재를 모두 삭제했습니다.', 'info');
              }}
              className="text-xs font-bold text-[#F04438] hover:underline"
            >
              전체 비우기
            </button>
          )}
        </div>

        {catalogStatus === 'loading' ? (
          <div role="status" className="bg-white rounded-3xl border border-[#E5E8EB] p-12 text-center text-sm text-[#667085]">저장한 교재 정보를 불러오고 있습니다.</div>
        ) : catalogStatus === 'error' ? (
          <div role="alert" className="bg-white rounded-3xl border border-[#E5E8EB] p-12 text-center space-y-3">
            <p className="text-sm font-bold text-[#191F28]">저장한 교재를 불러오지 못했습니다.</p>
            <p className="break-words text-xs text-[#667085]">{catalogError}</p>
            <button type="button" onClick={() => void refreshCatalog()} className="text-sm font-bold text-[#3182F6]">다시 시도</button>
          </div>
        ) : bookmarkedBooks.length === 0 ? (
          <div className="bg-white rounded-3xl border border-[#E5E8EB] p-12 text-center space-y-4 shadow-sm">
            <Bookmark className="w-12 h-12 text-[#ADB5BD] mx-auto" />
            <div className="space-y-1">
              <h3 className="text-base font-bold text-[#191F28]">저장한 교재가 없습니다</h3>
              <p className="text-xs text-[#8B95A1]">교재 카드의 저장 버튼을 눌러 추가할 수 있습니다.</p>
            </div>
            <button
              onClick={() => navigateTo('/search')}
              className="px-5 py-2.5 bg-[#3182F6] text-white font-bold text-xs rounded-2xl shadow-md"
            >
              교재 탐색하러 가기
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {bookmarkedBooks.map(book => {
              const bookLinks = links.filter(l => l.book_id === book.id);
              return (
                <div
                  key={book.id}
                  onClick={() => navigateTo(`/books/${book.id}`, { id: book.id })}
                  className="bg-white rounded-3xl border border-[#E5E8EB] hover:border-[#3182F6] p-5 cursor-pointer transition-all space-y-3 relative shadow-sm hover:shadow-md"
                >
                  <button
                    onClick={(e) => toggleBookmark(book.id, e)}
                    className="absolute top-4 right-4 p-1.5 rounded-full bg-white hover:bg-[#F2F4F6] text-[#3182F6]"
                  >
                    <X className="w-4 h-4 text-[#8B95A1]" />
                  </button>

                  <div className="flex gap-3">
                    <BookThumbnail src={book.thumbnail_url} alt={book.title} className="w-14 h-18 object-cover rounded-xl bg-[#F9FAFB] border border-[#E5E8EB] flex-shrink-0" />
                    <div className="min-w-0 pr-6">
                      <span className="text-[10px] font-bold text-[#1B64DA] bg-[#E8F3FF] px-1.5 py-0.5 rounded">
                        {book.publisher}
                      </span>
                      <h3 className="font-bold text-[#191F28] text-sm truncate mt-1">
                        {book.title}
                      </h3>
                      <p className="text-xs text-[#8B95A1]">
                        {book.subject} ({book.grade})
                      </p>
                    </div>
                  </div>

                  <div className="pt-2 border-t border-[#F2F4F6] flex items-center justify-between text-xs text-[#6B7684]">
                    <span>답지 <strong className="text-[#191F28]">{bookLinks.length}</strong>개</span>
                    <span className="text-[#3182F6] font-bold flex items-center gap-0.5">
                      바로 확인 <ChevronRight className="w-3.5 h-3.5" />
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
}

export function RedirectPage() {
    const {books, routeParams, navigateTo, refreshCatalog} = useAppContext();
    const linkId = routeParams.id;
    const [link, setLink] = useState<AnswerLink | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [loadError, setLoadError] = useState('');

    useEffect(() => {
      let active = true;
      setIsLoading(true);
      setLoadError('');
      const loadLink = async () => {
        try {
          if (!import.meta.env.NEXT_PUBLIC_SUPABASE_URL || !import.meta.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) throw new Error('Supabase 환경 변수를 확인해 주세요.');
          const { getAnswerLinkById } = await import('../../lib/supabase/answerLinks');
          const result = await getAnswerLinkById(linkId);
          if (active) setLink(result);
        } catch (error) {
          if (active) setLoadError(error instanceof Error ? error.message : '답지 링크를 불러오지 못했습니다.');
        } finally {
          if (active) setIsLoading(false);
        }
      };
      void loadLink();
      return () => { active = false; };
    }, [linkId]);

    if (isLoading) {
      return <div role="status" className="max-w-md mx-auto py-20 text-center text-sm text-[#667085]">답지 링크를 불러오고 있습니다.</div>;
    }

    if (!link || loadError) {
      return (
        <div className="max-w-md mx-auto py-20 text-center space-y-4">
          <AlertCircle className="w-10 h-10 text-[#F04438] mx-auto" />
          <h2 className="text-lg font-bold text-[#191F28]">유효하지 않은 답지 링크</h2>
          <p className="break-words text-xs text-[#8B95A1]">{loadError || '요청하신 링크가 삭제되었거나 공개되지 않았습니다.'}</p>
          <button
            onClick={() => navigateTo('/')}
            className="px-5 py-2.5 bg-[#3182F6] text-white font-bold text-xs rounded-2xl"
          >
            메인 페이지로
          </button>
        </div>
      );
    }

    const isSafeUrl = (() => { try { return ['http:', 'https:'].includes(new URL(link.url).protocol); } catch { return false; } })();

    return (
      <div className="max-w-md mx-auto px-5 py-16 text-center space-y-6">
        <div className="bg-white rounded-3xl border border-[#E5E8EB] p-8 space-y-6 shadow-xl">
          <div className="w-14 h-14 bg-[#E8F3FF] text-[#3182F6] rounded-2xl flex items-center justify-center mx-auto shadow-md">
            <ExternalLink className="w-7 h-7" />
          </div>

          <div className="space-y-1">
            <span className="text-xs text-[#8B95A1] font-bold">답지 링크 이동</span>
            <h1 className="text-lg font-bold text-[#191F28]">{link.title}</h1>
            <p className="text-xs text-[#6B7684]">
              제공처: {link.source_name || '출처 미등록'}
            </p>
          </div>

          {!isSafeUrl ? (
            <div className="bg-[#FFEEEC] border border-[#F04438]/20 text-[#F04438] p-3.5 rounded-2xl text-xs font-bold">
              보안상 이유로 이동이 차단된 비정상 웹 주소입니다.
            </div>
          ) : (
            <div className="space-y-3 pt-2">
              <div className="p-3 bg-[#F9FAFB] rounded-2xl text-[11px] text-[#6B7684] font-mono break-all border border-[#E5E8EB]">
                {link.url}
              </div>

              <a
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full block py-3.5 bg-[#3182F6] hover:bg-[#1B64DA] text-white font-bold rounded-2xl text-sm transition-all shadow-md shadow-[#3182F6]/20"
                onClick={() => {
                  void import('../../lib/supabase/answerLinks')
                    .then(({ recordAnswerLinkClick }) => recordAnswerLinkClick(link.id, crypto.randomUUID()))
                    .then(() => refreshCatalog())
                    .catch(() => undefined);
                }}
              >
                새 창으로 답지 열기
              </a>

              <button
                onClick={async () => {
                  let book = books.find((item: Book) => item.id === link.book_id);
                  if (!book) {
                    const { getBookById } = await import('../../lib/supabase/books');
                    book = await getBookById(link.book_id) ?? undefined;
                  }
                  if (book) navigateTo(`/books/${book.id}`, { id: book.id });
                  else navigateTo('/search');
                }}
                className="text-xs text-[#8B95A1] font-bold hover:text-[#191F28]"
              >
                교재 상세 페이지로 돌아가기
              </button>
            </div>
          )}
        </div>
      </div>
    );
}
