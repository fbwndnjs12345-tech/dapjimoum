
import { useEffect, useState } from 'react';
import { Plus, ShieldCheck } from 'lucide-react';

import { useAppContext } from '../../state/useAppContext';
import { BookCard } from '../../components/books/BookCard';
import { Hero } from '../../components/home/Hero';
import { SubjectNavigation } from '../../components/home/SubjectNavigation';
import type { Book } from '../../types/book';

export function HomePage() {
    const {books, links, bookmarks, searchQuery, setSearchQuery, setPublisherFilter, setIsRequestModalOpen, navigateTo, toggleBookmark} = useAppContext();
    const [supabaseBooks, setSupabaseBooks] = useState<Book[] | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
      let isActive = true;

      const loadBooks = async () => {
        const hasSupabaseConfig = Boolean(
          import.meta.env.NEXT_PUBLIC_SUPABASE_URL &&
          import.meta.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
        );

        if (!hasSupabaseConfig) {
          if (isActive) setIsLoading(false);
          return;
        }

        try {
          const { getBooks } = await import('../../lib/supabase/books');
          const result = await getBooks();
          if (isActive) setSupabaseBooks(result);
        } catch {
          // Keep the existing mock books as a fallback when Supabase is unavailable.
          if (isActive) setSupabaseBooks(null);
        } finally {
          if (isActive) setIsLoading(false);
        }
      };

      void loadBooks();
      return () => { isActive = false; };
    }, []);

    const homeBooks = supabaseBooks ?? books;

    return (
      <div className="space-y-12 pb-20 pt-8 sm:pt-14">
        <Hero query={searchQuery} onQueryChange={setSearchQuery} onSearch={() => navigateTo('/search')} />
        <SubjectNavigation books={books} onViewAll={() => navigateTo('/search')} onSelect={(publisher) => { setPublisherFilter(publisher); navigateTo('/search'); }} />

        {/* Popular / Recommended Workbooks */}
        <section className="max-w-[1100px] mx-auto px-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-[#191F28]">지금 학생들이 가장 많이 찾는 교재</h2>
              <p className="text-xs text-[#8B95A1] mt-0.5">실시간 조회수 기준 인기 답지 목록입니다.</p>
            </div>
            <button
              onClick={() => setIsRequestModalOpen(true)}
              className="text-xs font-bold text-[#3182F6] bg-[#E8F3FF] px-3 py-1.5 rounded-full hover:bg-[#D4E8FF] transition-colors flex items-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>답지 요청하기</span>
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {isLoading ? (
              <div className="sm:col-span-2 md:col-span-3 rounded-3xl border border-[#E5E8EB] bg-white p-8 text-center text-sm text-[#8B95A1]">
                교재 목록을 불러오고 있습니다.
              </div>
            ) : homeBooks.length === 0 ? (
              <div className="sm:col-span-2 md:col-span-3 rounded-3xl border border-[#E5E8EB] bg-white p-8 text-center text-sm text-[#8B95A1]">
                등록된 교재가 없습니다.
              </div>
            ) : homeBooks.slice(0, 6).map(book => {
              const bookLinks = links.filter(l => l.book_id === book.id);
              const verifiedCount = bookLinks.filter(l => l.verified).length;
              const isBookmarked = bookmarks.includes(book.id);

              return <BookCard key={book.id} book={book} linksCount={bookLinks.length} verifiedCount={verifiedCount} isBookmarked={isBookmarked} variant="home" onOpen={() => navigateTo(`/books/${book.id}`, { id: book.id })} onToggleBookmark={(event) => toggleBookmark(book.id, event)} />;
            })}
          </div>
        </section>

        {/* Trust Notice Banner */}
        <section className="max-w-[1100px] mx-auto px-5">
          <div className="bg-[#F9FAFB] border border-[#E5E8EB] rounded-3xl p-6 sm:p-8 flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="space-y-2 text-center md:text-left">
              <div className="inline-flex items-center gap-1.5 text-xs font-bold text-[#3182F6]">
                <ShieldCheck className="w-4 h-4" />
                <span>원본 자료 링크 안내</span>
              </div>
              <h3 className="text-base font-bold text-[#191F28]">답지 원본 링크 안내</h3>
              <p className="text-xs text-[#6B7684] leading-relaxed max-w-2xl">
                답지 파일은 사이트에 저장하지 않습니다. 등록된 링크를 통해 자료가 있는 원본 페이지로 이동할 수 있습니다.
              </p>
            </div>
            <button
              onClick={() => setIsRequestModalOpen(true)}
              className="bg-[#191F28] hover:bg-[#333D4B] text-white px-5 py-3 rounded-2xl text-xs font-bold whitespace-nowrap shadow-md transition-colors"
            >
              답지 요청하기
            </button>
          </div>
        </section>
      </div>
    );
}
