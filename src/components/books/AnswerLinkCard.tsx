import { AlertTriangle, Check, ExternalLink } from 'lucide-react';
import type { AnswerLink } from '../../types/book';

type AnswerLinkCardProps = { link: AnswerLink; onReport: () => void; onOpen: () => void };

export function AnswerLinkCard({ link, onReport, onOpen }: AnswerLinkCardProps) {
  const parsedCheckedAt = link.last_checked_at ? new Date(link.last_checked_at) : null;
  const checkedAt = parsedCheckedAt && Number.isFinite(parsedCheckedAt.getTime()) ? parsedCheckedAt : null;
  const verificationAge = checkedAt ? Date.now() - checkedAt.getTime() : Number.POSITIVE_INFINITY;
  const isRecentlyVerified = Boolean(link.verified && checkedAt && verificationAge >= 0 && verificationAge <= 180 * 24 * 60 * 60 * 1000);
  const openLabel = link.link_type === '다운로드'
    ? '다운로드 페이지 열기'
    : link.link_type === '온라인 PDF 뷰어' || link.link_type === 'PDF'
      ? '온라인 PDF 보기'
      : link.link_type === '이미지 보기'
        ? '이미지 보기'
        : link.link_type === '웹페이지'
          ? '답지 페이지 보기'
          : '답지 보러가기';
  return (
    <div className="bg-white rounded-2xl border border-[#E5E8EB] p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:border-[#3182F6] transition-all shadow-sm">
        <div className="space-y-1.5">
        <div className="flex items-center gap-2 flex-wrap"><span className="font-bold text-[#191F28] text-base">{link.title}</span>{isRecentlyVerified ? <span className="text-[10px] font-bold text-[#12B76A] bg-[#ECFDF3] border border-[#12B76A]/20 px-2 py-0.5 rounded-full flex items-center gap-0.5"><Check className="w-3 h-3" /> 검증완료</span> : <span className="text-[10px] font-bold text-[#F59E0B] bg-[#FEF3C7] border border-[#F59E0B]/20 px-2 py-0.5 rounded-full">재확인 필요</span>}<span className="text-[10px] font-semibold text-[#4E5968] bg-[#F2F4F6] px-2 py-0.5 rounded-md">{link.link_type || '유형 미등록'}</span></div>
        <div className="text-xs text-[#8B95A1] font-semibold flex flex-wrap items-center gap-3"><span>출처: <strong className="text-[#4E5968] font-bold">{link.source_name || '출처 미등록'}</strong></span>{checkedAt && <><span>·</span><span>확인 {checkedAt.toLocaleDateString('ko-KR')}</span></>}<span>·</span><span>조회수 {(link.click_count ?? 0).toLocaleString()}회</span><span>·</span><button type="button" onClick={onReport} className="text-[#F04438] hover:underline flex items-center gap-0.5"><AlertTriangle className="w-3 h-3" /> 오류 신고</button></div>
      </div>
      <button onClick={onOpen} className="px-5 py-3 bg-[#3182F6] hover:bg-[#1B64DA] active:scale-95 text-white font-bold rounded-2xl text-xs transition-all flex items-center justify-center gap-1.5 shadow-md shadow-[#3182F6]/20 whitespace-nowrap"><span>{openLabel}</span><ExternalLink className="w-4 h-4" /></button>
    </div>
  );
}
