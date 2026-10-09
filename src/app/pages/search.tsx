
import { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import type { Book } from '../../types/book';

import { useAppContext } from '../../state/useAppContext';
import { BookCard } from '../../components/books/BookCard';
import { SearchFilters } from '../../components/search/SearchFilters';

export function SearchPage() {
    const {links, bookmarks, searchQuery, setSearchQuery, subjectFilter, setSubjectFilter, gradeFilter, setGradeFilter, semesterFilter, setSemesterFilter, publisherFilter, setPublisherFilter, curriculumRevisionFilter, setCurriculumRevisionFilter, sortBy, setSortBy, setIsRequestModalOpen, navigateTo, toggleBookmark, filteredBooks} = useAppContext();
    const [supabaseBooks, setSupabaseBooks] = useState<Book[] | null>(null);
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
      let isCurrentRequest = true;

      const loadBooks = async () => {
        const { NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY } = import.meta.env;
        if (!NEXT_PUBLIC_SUPABASE_URL || !NEXT_PUBLIC_SUPABASE_ANON_KEY) {
          setSupabaseBooks(null);
          setIsLoading(false);
          return;
        }

        setIsLoading(true);
        try {
          const { searchBooks } = await import('../../lib/supabase/books');
          const results = await searchBooks({
            title: searchQuery.trim() || undefined,
            publisher: publisherFilter === '전체' ? undefined : publisherFilter,
            subject: subjectFilter === '전체' ? undefined : subjectFilter,
            grade: gradeFilter === '전체' ? undefined : gradeFilter,
            semester: semesterFilter === '전체' ? undefined : semesterFilter,
            curriculumRevision: curriculumRevisionFilter === '전체' ? undefined : curriculumRevisionFilter,
          });
          if (isCurrentRequest) setSupabaseBooks(results);
        } catch {
          if (isCurrentRequest) setSupabaseBooks(null);
        } finally {
          if (isCurrentRequest) setIsLoading(false);
        }
      };

      void loadBooks();
      return () => { isCurrentRequest = false; };
    }, [searchQuery, publisherFilter, subjectFilter, gradeFilter, semesterFilter, curriculumRevisionFilter]);

    const displayedBooks = useMemo(() => {
      if (supabaseBooks === null) return filteredBooks;
      if (sortBy === 'popular') {
        return [...supabaseBooks].sort((a, b) => {
          const clicksA = links.filter(link => link.book_id === a.id).reduce((sum, link) => sum + link.click_count, 0);
          const clicksB = links.filter(link => link.book_id === b.id).reduce((sum, link) => sum + link.click_count, 0);
          return clicksB - clicksA;
        });
      }
      if (sortBy === 'latest') {
        return [...supabaseBooks].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      }
      return supabaseBooks;
    }, [supabaseBooks, filteredBooks, links, sortBy]);

    return (
      <div className="max-w-[1100px] mx-auto px-5 py-8 space-y-6">
        {/* Header & Sort */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#F2F4F6] pb-5">
          <div>
            <h1 className="text-2xl font-bold text-[#191F28]">교재 탐색</h1>
            <p className="text-xs text-[#8B95A1] mt-1 font-medium">
              조건에 맞는 교재 <strong className="text-[#3182F6] font-bold">{displayedBooks.length}</strong>권을 발견했습니다.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-xs font-bold text-[#6B7684]">정렬</span>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="px-3.5 py-2 bg-white border border-[#E5E8EB] rounded-2xl text-xs font-bold text-[#191F28] outline-none focus:border-[#3182F6]"
            >
              <option value="popular">인기순 (조회수)</option>
              <option value="latest">최신 등록순</option>
              <option value="relevance">관련도순</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          <SearchFilters searchQuery={searchQuery} setSearchQuery={setSearchQuery} publisherFilter={publisherFilter} setPublisherFilter={setPublisherFilter} subjectFilter={subjectFilter} setSubjectFilter={setSubjectFilter} gradeFilter={gradeFilter} setGradeFilter={setGradeFilter} semesterFilter={semesterFilter} setSemesterFilter={setSemesterFilter} curriculumRevisionFilter={curriculumRevisionFilter} setCurriculumRevisionFilter={setCurriculumRevisionFilter} onReset={() => { setSearchQuery(''); setSubjectFilter('전체'); setGradeFilter('전체'); setSemesterFilter('전체'); setPublisherFilter('전체'); setCurriculumRevisionFilter('전체'); }} />

          {/* Right Results Grid */}
          <div className="lg:col-span-3">
            {isLoading ? (
              <div className="bg-white rounded-3xl border border-[#E5E8EB] p-12 text-center space-y-4 shadow-sm">
                <span className="inline-block w-8 h-8 border-2 border-[#E5E8EB] border-t-[#3182F6] rounded-full animate-spin" />
                <p className="text-sm font-bold text-[#191F28]">교재를 검색하고 있습니다.</p>
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
                      setCurriculumRevisionFilter('전체');
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
                  const bookLinks = links.filter(l => l.book_id === book.id);
                  const isBookmarked = bookmarks.includes(book.id);

                  return <BookCard key={book.id} book={book} linksCount={bookLinks.length} isBookmarked={isBookmarked} onOpen={() => navigateTo(`/books/${book.id}`, { id: book.id })} onToggleBookmark={(event) => toggleBookmark(book.id, event)} />;
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    );
}
