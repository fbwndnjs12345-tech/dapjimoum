import { ChevronRight } from 'lucide-react';
import type { Book } from '../../types/book';

type SubjectNavigationProps = { books: Book[]; status: 'loading' | 'error' | 'success'; onSelect: (publisher: string) => void; onViewAll: () => void };

export function SubjectNavigation({ books, status, onSelect, onViewAll }: SubjectNavigationProps) {
  const publisherCounts = new Map<string, number>();
  books.forEach(book => {
    const publisher = book.publisher?.trim();
    if (publisher) publisherCounts.set(publisher, (publisherCounts.get(publisher) ?? 0) + 1);
  });
  const publishers = [...publisherCounts.keys()]
    .sort((left, right) => (publisherCounts.get(right) ?? 0) - (publisherCounts.get(left) ?? 0) || left.localeCompare(right, 'ko'))
    .slice(0, 7);
  return <section className="max-w-[1100px] mx-auto px-5 space-y-4">
    <div className="flex items-center justify-between"><h2 className="text-lg font-bold text-[#191F28]">주요 출판사별 바로가기</h2><button onClick={onViewAll} className="text-xs text-[#3182F6] font-bold hover:underline flex items-center gap-0.5">전체 출판사 보기 <ChevronRight className="w-3.5 h-3.5" /></button></div>
    {status === 'loading' ? <div role="status" className="rounded-2xl border border-[#E5E8EB] bg-white p-6 text-center text-sm text-[#8B95A1]">출판사 데이터를 불러오고 있습니다.</div> : status === 'error' ? <div role="alert" className="rounded-2xl border border-[#E5E8EB] bg-white p-6 text-center text-sm text-[#8B95A1]">출판사 데이터를 확인할 수 없습니다.</div> : publishers.length === 0 ? <div className="rounded-2xl border border-[#E5E8EB] bg-white p-6 text-center text-sm text-[#8B95A1]">등록된 교재가 없습니다.</div> : <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-7 gap-2.5">{publishers.map(pub => <button key={pub} onClick={() => onSelect(pub)} className="bg-white border border-[#E5E8EB] hover:border-[#3182F6] hover:bg-[#E8F3FF]/40 p-3.5 rounded-2xl text-center transition-all flex flex-col items-center justify-center gap-1 shadow-sm group"><span className="text-xs font-bold text-[#333D4B] group-hover:text-[#3182F6] truncate w-full">{pub}</span><span className="text-[10px] text-[#8B95A1] font-semibold">{publisherCounts.get(pub) ?? 0}개 교재</span></button>)}</div>}
  </section>;
}
