type PopularSearchesProps = { tags: string[]; onSelect: (tag: string) => void };

export function PopularSearches({ tags, onSelect }: PopularSearchesProps) {
  if (tags.length === 0) return null;
  return <div className="flex items-center justify-center flex-wrap gap-1.5 mt-4 text-xs">
    <span className="text-[#8B95A1] font-medium mr-1">최근 등록 교재</span>
    {tags.map(tag => <button key={tag} onClick={() => onSelect(tag)} className="max-w-44 truncate bg-[#F2F4F6] hover:bg-[#E5E8EB] text-[#4E5968] hover:text-[#191F28] px-3 py-1 rounded-full font-semibold transition-all" title={tag}>{tag}</button>)}
  </div>;
}
