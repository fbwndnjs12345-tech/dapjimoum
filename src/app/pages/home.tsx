
import { useEffect, useMemo, useState } from 'react';
import { Plus, ShieldCheck } from 'lucide-react';

import { useAppContext } from '../../state/useAppContext';
import { BookCard } from '../../components/books/BookCard';
import { Hero } from '../../components/home/Hero';
import { SubjectNavigation } from '../../components/home/SubjectNavigation';
import type { AnswerLink, Book } from '../../types/book';
import { isPlaceholderBook } from '../../lib/catalog';

export function HomePage() {
    const {bookmarks, searchQuery, setSearchQuery, setPublisherFilter, setIsRequestModalOpen, navigateTo, toggleBookmark} = useAppContext();
    const [homeBooks, setHomeBooks] = useState<Book[]>([]);
    const [homeLinks, setHomeLinks] = useState<AnswerLink[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [loadError, setLoadError] = useState('');
    const [reloadKey, setReloadKey] = useState(0);

    useEffect(() => {
      let isActive = true;

      const loadBooks = async () => {
        const hasSupabaseConfig = Boolean(
          import.meta.env.NEXT_PUBLIC_SUPABASE_URL &&
          import.meta.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
        );

        if (!hasSupabaseConfig) {
          if (isActive) { setLoadError('Supabase 환경 변수를 확인해 주세요.'); setIsLoading(false); }
          return;
        }

        try {
          const [{ getBooks }, { getAnswerLinks }] = await Promise.all([
            import('../../lib/supabase/books'),
            import('../../lib/supabase/answerLinks')
          ]);
          const [result, answerLinks] = await Promise.all([getBooks(), getAnswerLinks()]);
          if (isActive) { setHomeBooks(result.filter(book => !isPlaceholderBook(book))); setHomeLinks(answerLinks); setLoadError(''); }
        } catch (error) {
          if (isActive) {
            setHomeBooks([]);
            setHomeLinks([]);
            setLoadError(error instanceof Error ? error.message : '교재 정보를 불러오지 못했습니다.');
          }
        } finally {
          if (isActive) setIsLoading(false);
        }
      };

      void loadBooks();
      return () => { isActive = false; };
    }, [reloadKey]);

    const popularBooks = useMemo(() => {
      const clicksByBook = new Map<string, number>();
      homeLinks.forEach(link => clicksByBook.set(link.book_id, (clicksByBook.get(link.book_id) ?? 0) + link.click_count));
      return [...homeBooks]
        .sort((left, right) => (clicksByBook.get(right.id) ?? 0) - (clicksByBook.get(left.id) ?? 0) || new Date(right.created_at).getTime() - new Date(left.created_at).getTime())
        .slice(0, 6);
    }, [homeBooks, homeLinks]);

    return (
      <div className="space-y-12 pb-20 pt-8 sm:pt-14">
        <Hero query={searchQuery} onQueryChange={setSearchQuery} onSearch={() => navigateTo('/search')} suggestions={homeBooks.slice(0, 6).map(book => book.title)} />
        <SubjectNavigation books={homeBooks} status={isLoading ? 'loading' : loadError ? 'error' : 'success'} onViewAll={() => navigateTo('/search')} onSelect={(publisher) => { setPublisherFilter(publisher); navigateTo('/search'); }} />

        {/* Popular / Recommended Workbooks */}
        <section className="max-w-[1100px] mx-auto px-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-[#191F28]">{homeLinks.some(link => link.click_count > 0) ? '답지 링크 클릭이 많은 교재' : '최근 등록된 교재'}</h2>
              <p className="text-xs text-[#8B95A1] mt-0.5">{homeLinks.some(link => link.click_count > 0) ? '공개 링크의 누적 클릭 수 기준입니다.' : '공개 링크 클릭 데이터가 없어 최근 등록순으로 표시합니다.'}</p>
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
            ) : loadError ? (
              <div role="alert" className="sm:col-span-2 md:col-span-3 rounded-3xl border border-[#E5E8EB] bg-white p-8 text-center text-sm text-[#667085]">
                교재 정보를 불러오지 못했습니다. {loadError}
                <button type="button" onClick={() => setReloadKey(key => key + 1)} className="ml-2 font-bold text-[#191F28] underline">다시 시도</button>
              </div>
            ) : homeBooks.length === 0 ? (
              <div className="sm:col-span-2 md:col-span-3 rounded-3xl border border-[#E5E8EB] bg-white p-8 text-center text-sm text-[#8B95A1]">
                등록된 교재가 없습니다.
              </div>
            ) : popularBooks.map(book => {
              const bookLinks = homeLinks.filter(l => l.book_id === book.id);
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
