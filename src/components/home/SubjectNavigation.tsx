import { ChevronRight } from 'lucide-react';
import { ALL_PUBLISHERS } from '../../data/mockBooks';
import type { Book } from '../../types/book';

type SubjectNavigationProps = { books: Book[]; onSelect: (publisher: string) => void; onViewAll: () => void };

export function SubjectNavigation({ books, onSelect, onViewAll }: SubjectNavigationProps) {
  return <section className="max-w-[1100px] mx-auto px-5 space-y-4">
    <div className="flex items-center justify-between"><h2 className="text-lg font-bold text-[#191F28]">주요 출판사별 바로가기</h2><button onClick={onViewAll} className="text-xs text-[#3182F6] font-bold hover:underline flex items-center gap-0.5">전체 출판사 보기 <ChevronRight className="w-3.5 h-3.5" /></button></div>
    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-7 gap-2.5">{ALL_PUBLISHERS.filter(p => p !== '전체').slice(0, 7).map(pub => <button key={pub} onClick={() => onSelect(pub)} className="bg-white border border-[#E5E8EB] hover:border-[#3182F6] hover:bg-[#E8F3FF]/40 p-3.5 rounded-2xl text-center transition-all flex flex-col items-center justify-center gap-1 shadow-sm group"><span className="text-xs font-bold text-[#333D4B] group-hover:text-[#3182F6] truncate w-full">{pub}</span><span className="text-[10px] text-[#8B95A1] font-semibold">{books.filter(book => book.publisher === pub).length}개 교재</span></button>)}</div>
  </section>;
}
