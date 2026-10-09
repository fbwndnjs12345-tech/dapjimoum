import { Search, X } from 'lucide-react';

type SearchBarProps = { value: string; onChange: (value: string) => void; onSubmit: () => void };

export function SearchBar({ value, onChange, onSubmit }: SearchBarProps) {
  return (
    <form onSubmit={(event) => { event.preventDefault(); onSubmit(); }} className="relative flex items-center bg-white border-2 border-[#E5E8EB] focus-within:border-[#3182F6] rounded-3xl p-2.5 shadow-xl shadow-[#000000]/5 transition-all">
      <Search className="w-5 h-5 text-[#8B95A1] ml-3 mr-2 flex-shrink-0" />
      <input type="text" value={value} onChange={(event) => onChange(event.target.value)} placeholder="교재명, 출판사, 과목을 입력하세요" className="w-full py-2.5 text-sm sm:text-base font-medium text-[#191F28] placeholder-[#ADB5BD] bg-transparent outline-none border-none" />
      {value && <button type="button" onClick={() => onChange('')} className="p-1.5 text-[#8B95A1] hover:text-[#191F28] mr-1"><X className="w-4 h-4" /></button>}
      <button type="submit" className="bg-[#3182F6] hover:bg-[#1B64DA] active:scale-95 text-white px-6 py-3 rounded-2xl text-sm font-bold shadow-md shadow-[#3182F6]/20 transition-all flex-shrink-0">검색</button>
    </form>
  );
}
