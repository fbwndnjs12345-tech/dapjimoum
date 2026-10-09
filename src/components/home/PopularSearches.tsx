import { TrendingUp } from 'lucide-react';

const POPULAR_TAGS = ['쎈', '개념쎈', '완자', '자이스토리', '마더텅', 'EBS 수능특강', '오투'];
type PopularSearchesProps = { onSelect: (tag: string) => void };

export function PopularSearches({ onSelect }: PopularSearchesProps) {
  return <div className="flex items-center justify-center flex-wrap gap-1.5 mt-4 text-xs">
    <span className="text-[#8B95A1] font-medium mr-1 flex items-center gap-1"><TrendingUp className="w-3.5 h-3.5 text-[#3182F6]" /> 인기</span>
    {POPULAR_TAGS.map(tag => <button key={tag} onClick={() => onSelect(tag)} className="bg-[#F2F4F6] hover:bg-[#E5E8EB] text-[#4E5968] hover:text-[#191F28] px-3 py-1 rounded-full font-semibold transition-all">{tag}</button>)}
  </div>;
}
