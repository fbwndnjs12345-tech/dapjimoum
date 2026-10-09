import { Sparkles } from 'lucide-react';
import { SearchBar } from './SearchBar';
import { PopularSearches } from './PopularSearches';

type HeroProps = { query: string; onQueryChange: (value: string) => void; onSearch: () => void; suggestions: string[] };

export function Hero({ query, onQueryChange, onSearch, suggestions }: HeroProps) {
  return (
    <section className="max-w-[800px] mx-auto text-center px-5 space-y-6">
      <div className="inline-flex items-center gap-1.5 bg-[#E8F3FF] text-[#1B64DA] px-3.5 py-1.5 rounded-full text-xs font-bold animate-pulse"><Sparkles className="w-3.5 h-3.5" /><span>교재별 답지 정보와 원본 링크</span></div>
      <div className="space-y-3"><h1 className="text-3xl sm:text-5xl font-extrabold text-[#191F28] tracking-tight leading-tight">필요한 답지, <br className="sm:hidden"/><span className="text-[#3182F6]">가장 빠르게</span> 찾으세요</h1><p className="text-sm sm:text-base text-[#6B7684] font-medium max-w-lg mx-auto">교재별 답지 정보를 검색하고 원본 링크를 찾아볼 수 있습니다.</p></div>
      <div className="max-w-[680px] mx-auto pt-2"><SearchBar value={query} onChange={onQueryChange} onSubmit={onSearch} /><PopularSearches tags={suggestions} onSelect={(tag) => { onQueryChange(tag); onSearch(); }} /></div>
    </section>
  );
}
