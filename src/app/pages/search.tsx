
import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import type { Book } from '../../types/book';
import type { AnswerLinkCount } from '../../lib/supabase/answerLinks';
import { isPlaceholderBook, normalizeGradeLabel } from '../../lib/catalog';
import { scoreBookSearch } from '../../lib/bookSearch';

import { useAppContext } from '../../state/useAppContext';
import { BookCard } from '../../components/books/BookCard';
import { SearchFilters } from '../../components/search/SearchFilters';

export function SearchPage() {
    const {bookmarks, searchQuery, setSearchQuery, subjectFilter, setSubjectFilter, gradeFilter, setGradeFilter, semesterFilter, setSemesterFilter, publisherFilter, setPublisherFilter, sortBy, setSortBy, setIsRequestModalOpen, navigateTo, toggleBookmark} = useAppContext();
    const [allBooks, setAllBooks] = useState<Book[]>([]);
    const [linkCounts, setLinkCounts] = useState<AnswerLinkCount[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [loadError, setLoadError] = useState('');
    const [reloadKey, setReloadKey] = useState(0);
    const deferredSearchQuery = useDeferredValue(searchQuery);

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

    const countsByBook = useMemo(() => new Map(linkCounts.map(item => [item.book_id, item] as const)), [linkCounts]);

    const displayedBooks = useMemo(() => {
      const query = deferredSearchQuery.trim();
      const filtered = allBooks.filter(book => !isPlaceholderBook(book)).filter(book => {
        const matchesQuery = !query || scoreBookSearch(book, query) > 0;
        return matchesQuery &&
          (publisherFilter === '전체' || book.publisher?.trim() === publisherFilter) &&
          (subjectFilter === '전체' || book.subject?.trim() === subjectFilter) &&
          (gradeFilter === '전체' || normalizeGradeLabel(book.grade) === gradeFilter) &&
          (semesterFilter === '전체' || book.semester?.trim() === semesterFilter);
      });
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
    }, [allBooks, countsByBook, deferredSearchQuery, publisherFilter, subjectFilter, gradeFilter, semesterFilter, sortBy]);
    const visibleCatalog = useMemo(() => allBooks.filter(book => !isPlaceholderBook(book)), [allBooks]);
    const queryMatchedBooks = useMemo(() => {
      const query = searchQuery.trim();
      return visibleCatalog.filter(book => !query || scoreBookSearch(book, query) > 0);
    }, [visibleCatalog, deferredSearchQuery]);

    // 각 필터의 선택지는 검색어와 나머지 필터를 적용한 교재만으로 계산한다.
    // 자기 자신의 필터는 제외하므로 다른 값으로 전환할 수 있다.
    const publisherFacetBooks = useMemo(() => queryMatchedBooks.filter(book =>
      (subjectFilter === '전체' || book.subject?.trim() === subjectFilter) &&
      (gradeFilter === '전체' || book.grade?.trim() === gradeFilter) &&
      (semesterFilter === '전체' || book.semester?.trim() === semesterFilter)
    ), [queryMatchedBooks, subjectFilter, gradeFilter, semesterFilter]);
    const subjectFacetBooks = useMemo(() => queryMatchedBooks.filter(book =>
      (publisherFilter === '전체' || book.publisher?.trim() === publisherFilter) &&
      (gradeFilter === '전체' || book.grade?.trim() === gradeFilter) &&
      (semesterFilter === '전체' || book.semester?.trim() === semesterFilter)
    ), [queryMatchedBooks, publisherFilter, gradeFilter, semesterFilter]);
    const gradeFacetBooks = useMemo(() => queryMatchedBooks.filter(book =>
      (publisherFilter === '전체' || book.publisher?.trim() === publisherFilter) &&
      (subjectFilter === '전체' || book.subject?.trim() === subjectFilter) &&
      (semesterFilter === '전체' || book.semester?.trim() === semesterFilter)
    ), [queryMatchedBooks, publisherFilter, subjectFilter, semesterFilter]);
    const semesterFacetBooks = useMemo(() => queryMatchedBooks.filter(book =>
      (publisherFilter === '전체' || book.publisher?.trim() === publisherFilter) &&
      (subjectFilter === '전체' || book.subject?.trim() === subjectFilter) &&
      (gradeFilter === '전체' || book.grade?.trim() === gradeFilter)
    ), [queryMatchedBooks, publisherFilter, subjectFilter, gradeFilter]);

    useEffect(() => {
      if (publisherFilter !== '전체' && !publisherFacetBooks.some(book => book.publisher?.trim() === publisherFilter)) setPublisherFilter('전체');
      if (subjectFilter !== '전체' && !subjectFacetBooks.some(book => book.subject?.trim() === subjectFilter)) setSubjectFilter('전체');
      if (gradeFilter !== '전체' && !gradeFacetBooks.some(book => book.grade?.trim() === gradeFilter)) setGradeFilter('전체');
      if (semesterFilter !== '전체' && !semesterFacetBooks.some(book => book.semester?.trim() === semesterFilter)) setSemesterFilter('전체');
    }, [publisherFilter, subjectFilter, gradeFilter, semesterFilter, publisherFacetBooks, subjectFacetBooks, gradeFacetBooks, semesterFacetBooks, setPublisherFilter, setSubjectFilter, setGradeFilter, setSemesterFilter]);

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
          <SearchFilters publisherBooks={publisherFacetBooks} subjectBooks={subjectFacetBooks} gradeBooks={gradeFacetBooks} semesterBooks={semesterFacetBooks} dataStatus={isLoading ? 'loading' : loadError ? 'error' : 'success'} searchQuery={searchQuery} setSearchQuery={setSearchQuery} publisherFilter={publisherFilter} setPublisherFilter={setPublisherFilter} subjectFilter={subjectFilter} setSubjectFilter={setSubjectFilter} gradeFilter={gradeFilter} setGradeFilter={setGradeFilter} semesterFilter={semesterFilter} setSemesterFilter={setSemesterFilter} onReset={() => { setSearchQuery(''); setSubjectFilter('전체'); setGradeFilter('전체'); setSemesterFilter('전체'); setPublisherFilter('전체'); }} />

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
                  const bookLinks = countsByBook.get(book.id);
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
