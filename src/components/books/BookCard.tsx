import { Bookmark, BookmarkCheck, Check, ChevronRight } from 'lucide-react';
import type { MouseEvent } from 'react';
import type { Book } from '../../types/book';
import { BookThumbnail } from './BookThumbnail';

type BookCardProps = {
  book: Book;
  linksCount: number;
  verifiedCount?: number;
  isBookmarked: boolean;
  variant?: 'home' | 'search';
  onOpen: () => void;
  onToggleBookmark: (event: MouseEvent<HTMLButtonElement>) => void;
};

export function BookCard({ book, linksCount, verifiedCount = 0, isBookmarked, variant = 'search', onOpen, onToggleBookmark }: BookCardProps) {
  if (variant === 'home') {
    return <div onClick={onOpen} className="bg-white border border-[#E5E8EB] hover:border-[#3182F6] p-4 sm:p-5 rounded-3xl cursor-pointer transition-all flex flex-col justify-between space-y-4 shadow-sm hover:shadow-xl hover:shadow-[#3182F6]/5 group relative">
      <button type="button" onClick={onToggleBookmark} className="absolute top-4 right-4 p-2 rounded-full bg-white/80 hover:bg-[#F2F4F6] text-[#8B95A1] hover:text-[#3182F6] transition-colors z-10" title={isBookmarked ? '저장 목록에서 제거' : '교재 저장'}>{isBookmarked ? <BookmarkCheck className="w-4 h-4 text-[#3182F6] fill-[#3182F6]" /> : <Bookmark className="w-4 h-4" />}</button>
      <div className="flex gap-4 items-start"><BookThumbnail src={book.thumbnail_url} alt={book.title} className="w-16 h-20 object-cover rounded-2xl bg-[#F9FAFB] border border-[#E5E8EB] flex-shrink-0 group-hover:scale-105 transition-transform" /><div className="space-y-1.5 min-w-0 pr-6"><div className="flex items-center gap-1.5 flex-wrap"><span className="text-[10px] font-extrabold text-[#1B64DA] bg-[#E8F3FF] px-2 py-0.5 rounded-md">{book.publisher || '출판사 미등록'}</span><span className="text-[10px] font-bold text-[#6B7684] bg-[#F2F4F6] px-1.5 py-0.5 rounded-md">{book.grade || '학년 미등록'}</span></div><h3 className="mobile-book-title font-bold text-[#191F28] text-sm leading-snug line-clamp-1 group-hover:text-[#3182F6] transition-colors"><a href={`/books/${encodeURIComponent(book.id)}`} onClick={event => { event.preventDefault(); event.stopPropagation(); onOpen(); }} className="focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#3182F6]">{book.title}</a></h3><p className="text-xs text-[#8B95A1] line-clamp-2 leading-relaxed">{book.description || '교재 설명 미등록'}</p></div></div>
      <div className="pt-3 border-t border-[#F2F4F6] flex items-center justify-between text-xs font-semibold text-[#6B7684]"><div className="flex items-center gap-2"><span>답지 링크 <strong className="text-[#191F28]">{linksCount}</strong>개</span>{verifiedCount > 0 && <span className="text-[10px] text-[#12B76A] bg-[#ECFDF3] px-2 py-0.5 rounded-full font-bold flex items-center gap-0.5"><Check className="w-3 h-3" /> 검증완료</span>}</div><span className="text-[#3182F6] font-bold flex items-center gap-0.5 group-hover:translate-x-1 transition-transform">상세보기 <ChevronRight className="w-3.5 h-3.5" /></span></div>
    </div>;
  }
  return <div onClick={onOpen} className="bg-white rounded-3xl border border-[#E5E8EB] hover:border-[#3182F6] p-4 cursor-pointer transition-all flex flex-col justify-between space-y-3 shadow-sm hover:shadow-lg relative group">
    <button type="button" onClick={onToggleBookmark} className="absolute top-3.5 right-3.5 p-1.5 rounded-full bg-white/80 hover:bg-[#F2F4F6] text-[#8B95A1] hover:text-[#3182F6] z-10">{isBookmarked ? <BookmarkCheck className="w-4 h-4 text-[#3182F6] fill-[#3182F6]" /> : <Bookmark className="w-4 h-4" />}</button>
    <div className="space-y-3"><div className="flex gap-3"><BookThumbnail src={book.thumbnail_url} alt={book.title} className="w-14 h-18 object-cover rounded-xl bg-[#F9FAFB] border border-[#E5E8EB] flex-shrink-0" /><div className="min-w-0 space-y-1 pr-5"><span className="text-[10px] font-bold text-[#1B64DA] bg-[#E8F3FF] px-1.5 py-0.5 rounded">{book.publisher || '출판사 미등록'}</span><h3 className="mobile-book-title font-bold text-[#191F28] text-sm group-hover:text-[#3182F6] transition-colors"><a href={`/books/${encodeURIComponent(book.id)}`} onClick={event => { event.preventDefault(); event.stopPropagation(); onOpen(); }} className="focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#3182F6]">{book.title}</a></h3><p className="text-[11px] text-[#8B95A1] font-semibold">{[book.subject, book.grade, book.semester].filter(Boolean).join(' · ') || '교재 분류 미등록'}</p></div></div><p className="text-xs text-[#6B7684] line-clamp-2 leading-relaxed">{book.description || '교재 설명 미등록'}</p></div>
    <div className="pt-2.5 border-t border-[#F2F4F6] flex items-center justify-between text-xs text-[#6B7684]"><span className="font-medium">링크 <strong className="text-[#191F28] font-bold">{linksCount}</strong>개</span><span className="text-[#3182F6] font-bold flex items-center gap-0.5">답지 확인 <ChevronRight className="w-3.5 h-3.5" /></span></div>
  </div>;
}
