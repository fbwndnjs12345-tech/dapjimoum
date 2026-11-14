
import { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import type { Book } from '../../types/book';
import type { AnswerLinkCount } from '../../lib/supabase/answerLinks';
import { isPlaceholderBook } from '../../lib/catalog';

import { useAppContext } from '../../state/useAppContext';
import { BookCard } from '../../components/books/BookCard';
import { SearchFilters } from '../../components/search/SearchFilters';

function searchTokens(value: string): string[] {
  return (value.toLocaleLowerCase('ko-KR').normalize('NFKC').match(/[가-힣]+|[a-z]+|[0-9]+/g) ?? [])
    .filter(token => token.length > 0);
}

function normalizeSearchValue(value: string): string {
  return value.toLocaleLowerCase('ko-KR').normalize('NFKC').replace(/[\s·ㆍ_\-–—()[\]{}:：,.]+/g, '');
}

function isOneEditAway(left: string, right: string): boolean {
  if (Math.abs(left.length - right.length) > 1 || Math.min(left.length, right.length) < 4) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) { i += 1; j += 1; continue; }
    edits += 1;
    if (edits > 1) return false;
    if (left.length > right.length) i += 1;
    else if (right.length > left.length) j += 1;
    else { i += 1; j += 1; }
  }
  if (i < left.length || j < right.length) edits += 1;
  return edits <= 1;
}

function scoreBookSearch(book: Book, query: string): number {
  const fields = [book.title, book.publisher, book.subject, book.grade, book.semester, book.series, book.edition, book.description]
    .filter((value): value is string => Boolean(value));
  const normalizedQuery = normalizeSearchValue(query);
  if (!normalizedQuery) return 1;
  if (fields.some(value => normalizeSearchValue(value) === normalizedQuery)) return 120;
  if (normalizeSearchValue(book.title).includes(normalizedQuery)) return 110;
  if (fields.some(value => normalizeSearchValue(value).includes(normalizedQuery))) return 100;
  const queryParts = searchTokens(query);
  const fieldParts = fields.flatMap(searchTokens);
  if (!queryParts.length) return 0;
  const hits = queryParts.filter(token => fieldParts.some(field => field === token || (token.length >= 2 && field.startsWith(token)) || isOneEditAway(token, field)));
  const ratio = hits.length / queryParts.length;
  if (ratio === 1) return 80 + Math.min(15, queryParts.length * 3);
  if (queryParts.length >= 2 && ratio >= 0.75) return 50 + ratio * 20;
  return 0;
}

export function SearchPage() {
    const {bookmarks, searchQuery, setSearchQuery, subjectFilter, setSubjectFilter, gradeFilter, setGradeFilter, semesterFilter, setSemesterFilter, publisherFilter, setPublisherFilter, sortBy, setSortBy, setIsRequestModalOpen, navigateTo, toggleBookmark} = useAppContext();
    const [allBooks, setAllBooks] = useState<Book[]>([]);
    const [linkCounts, setLinkCounts] = useState<AnswerLinkCount[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [loadError, setLoadError] = useState('');
    const [reloadKey, setReloadKey] = useState(0);

    useEffect(() => {
      let isCurrentRequest = true;
      const loadCatalog = async () => {
        const { NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY } = import.meta.env;
        if (!NEXT_PUBLIC_SUPABASE_URL || !NEXT_PUBLIC_SUPABASE_ANON_KEY) {
          if (isCurrentRequest) { setLoadError('Supabase 환경 변수를 확인해 주세요.'); setIsLoading(false); }
          return;
        }
        if (isCurrentRequest) { setIsLoading(true); setLoadError(''); }
        try {
          const [{ getBooks }, { getPublicAnswerLinkCounts }] = await Promise.all([
            import('../../lib/supabase/books'),
            import('../../lib/supabase/answerLinks')
          ]);
          const [books, counts] = await Promise.all([getBooks(), getPublicAnswerLinkCounts()]);
          if (isCurrentRequest) { setAllBooks(books); setLinkCounts(counts); }
        } catch (error) {
          if (isCurrentRequest) {
            setAllBooks([]);
            setLinkCounts([]);
            setLoadError(error instanceof Error ? error.message : '교재 데이터를 불러오지 못했습니다.');
          }
        } finally {
          if (isCurrentRequest) setIsLoading(false);
        }
      };
      void loadCatalog();
      return () => { isCurrentRequest = false; };
    }, [reloadKey]);

    const displayedBooks = useMemo(() => {
      const query = searchQuery.trim();
      const filtered = allBooks.filter(book => !isPlaceholderBook(book)).filter(book => {
        const matchesQuery = !query || scoreBookSearch(book, query) > 0;
        return matchesQuery &&
          (publisherFilter === '전체' || book.publisher?.trim() === publisherFilter) &&
          (subjectFilter === '전체' || book.subject?.trim() === subjectFilter) &&
          (gradeFilter === '전체' || book.grade?.trim() === gradeFilter) &&
          (semesterFilter === '전체' || book.semester?.trim() === semesterFilter);
      });
      const countsByBook = new Map(linkCounts.map(item => [item.book_id, item]));
      if (query && sortBy !== 'latest') return filtered.sort((a, b) =>
        scoreBookSearch(b, query) - scoreBookSearch(a, query) ||
        (countsByBook.get(b.id)?.click_count ?? 0) - (countsByBook.get(a.id)?.click_count ?? 0)
      );
      if (sortBy === 'popular') return filtered.sort((a, b) =>
        (countsByBook.get(b.id)?.click_count ?? 0) - (countsByBook.get(a.id)?.click_count ?? 0) ||
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
      if (sortBy === 'latest') return filtered.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      return filtered.sort((a, b) => scoreBookSearch(b, query) - scoreBookSearch(a, query));
    }, [allBooks, linkCounts, searchQuery, publisherFilter, subjectFilter, gradeFilter, semesterFilter, sortBy]);
    const visibleCatalog = useMemo(() => allBooks.filter(book => !isPlaceholderBook(book)), [allBooks]);

    return (
      <div className="max-w-[1100px] mx-auto px-5 py-8 space-y-6">
        {/* Header & Sort */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#F2F4F6] pb-5">
          <div>
            <h1 className="text-2xl font-bold text-[#191F28]">교재 탐색</h1>
            <p className="text-xs text-[#8B95A1] mt-1 font-medium">
              {isLoading ? '교재 데이터 확인 중' : loadError ? '교재 데이터 조회 실패' : <>조건에 맞는 교재 <strong className="text-[#3182F6] font-bold">{displayedBooks.length}</strong>권을 찾았습니다.</>}
            </p>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-xs font-bold text-[#6B7684]">정렬</span>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="px-3.5 py-2 bg-white border border-[#E5E8EB] rounded-2xl text-xs font-bold text-[#191F28] outline-none focus:border-[#3182F6]"
            >
              <option value="popular">{linkCounts.some(link => link.click_count > 0) ? '인기순 (조회수)' : '클릭 기록 없음 · 최신순'}</option>
              <option value="latest">최신 등록순</option>
              <option value="relevance">관련도순</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          <SearchFilters books={visibleCatalog} dataStatus={isLoading ? 'loading' : loadError ? 'error' : 'success'} searchQuery={searchQuery} setSearchQuery={setSearchQuery} publisherFilter={publisherFilter} setPublisherFilter={setPublisherFilter} subjectFilter={subjectFilter} setSubjectFilter={setSubjectFilter} gradeFilter={gradeFilter} setGradeFilter={setGradeFilter} semesterFilter={semesterFilter} setSemesterFilter={setSemesterFilter} onReset={() => { setSearchQuery(''); setSubjectFilter('전체'); setGradeFilter('전체'); setSemesterFilter('전체'); setPublisherFilter('전체'); }} />

          {/* Right Results Grid */}
          <div className="lg:col-span-3">
            {isLoading ? (
              <div className="bg-white rounded-3xl border border-[#E5E8EB] p-12 text-center space-y-4 shadow-sm">
                <span className="inline-block w-8 h-8 border-2 border-[#E5E8EB] border-t-[#3182F6] rounded-full animate-spin" />
                <p className="text-sm font-bold text-[#191F28]">교재를 검색하고 있습니다.</p>
              </div>
            ) : loadError ? (
              <div role="alert" className="bg-white rounded-3xl border border-[#E5E8EB] p-12 text-center space-y-3 shadow-sm">
                <p className="text-sm font-bold text-[#191F28]">검색 데이터를 불러오지 못했습니다.</p>
                <p className="text-xs text-[#667085]">{loadError}</p>
                <button type="button" onClick={() => setReloadKey(key => key + 1)} className="text-sm font-bold text-[#3182F6]">다시 시도</button>
              </div>
            ) : displayedBooks.length === 0 ? (
              <div className="bg-white rounded-3xl border border-[#E5E8EB] p-12 text-center space-y-4 shadow-sm">
                <Search className="w-10 h-10 text-[#8B95A1] mx-auto" />
                <div className="space-y-1">
                  <h3 className="text-base font-bold text-[#191F28]">검색 조건에 맞는 교재가 없습니다</h3>
                  <p className="text-xs text-[#8B95A1]">검색어나 출판사 필터 조건을 변경해 보세요.</p>
                </div>
                <div className="flex justify-center gap-2 pt-2">
                  <button
                    onClick={() => {
                      setSearchQuery('');
                      setSubjectFilter('전체');
                      setGradeFilter('전체');
                      setSemesterFilter('전체');
                      setPublisherFilter('전체');
                    }}
                    className="px-4 py-2.5 bg-[#F2F4F6] text-[#4E5968] font-bold text-xs rounded-2xl hover:bg-[#E5E8EB]"
                  >
                    필터 전체 초기화
                  </button>
                  <button
                    onClick={() => setIsRequestModalOpen(true)}
                    className="px-4 py-2.5 bg-[#3182F6] text-white font-bold text-xs rounded-2xl hover:bg-[#1B64DA]"
                  >
                    이 교재 답지 요청하기
                  </button>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {displayedBooks.map(book => {
                  const bookLinks = linkCounts.find(item => item.book_id === book.id);
                  const isBookmarked = bookmarks.includes(book.id);

                  return <BookCard key={book.id} book={book} linksCount={bookLinks?.link_count ?? 0} isBookmarked={isBookmarked} onOpen={() => navigateTo(`/books/${book.id}`, { id: book.id })} onToggleBookmark={(event) => toggleBookmark(book.id, event)} />;
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    );
}
