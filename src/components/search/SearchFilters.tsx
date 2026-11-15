import { useMemo } from 'react';
import { Filter, X } from 'lucide-react';
import type { Book } from '../../types/book';

type SearchFiltersProps = {
  publisherBooks: Book[];
  subjectBooks: Book[];
  gradeBooks: Book[];
  semesterBooks: Book[];
  dataStatus: 'loading' | 'error' | 'success';
  searchQuery: string; setSearchQuery: (value: string) => void;
  publisherFilter: string; setPublisherFilter: (value: string) => void;
  subjectFilter: string; setSubjectFilter: (value: string) => void;
  gradeFilter: string; setGradeFilter: (value: string) => void;
  semesterFilter: string; setSemesterFilter: (value: string) => void;
  onReset: () => void;
};

type Facet = { options: string[]; counts: Map<string, number> };

function buildFacet(books: Book[], select: (book: Book) => string | null | undefined): Facet {
  const counts = new Map<string, number>();
  for (const book of books) {
    const value = select(book)?.trim();
    if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return { options: ['전체', ...Array.from(counts.keys()).sort((a, b) => a.localeCompare(b, 'ko'))], counts };
}

export function SearchFilters({
  publisherBooks, subjectBooks, gradeBooks, semesterBooks, dataStatus,
  searchQuery, setSearchQuery, publisherFilter, setPublisherFilter,
  subjectFilter, setSubjectFilter, gradeFilter, setGradeFilter,
  semesterFilter, setSemesterFilter, onReset
}: SearchFiltersProps) {
  const facets = useMemo(() => ({
    publishers: buildFacet(publisherBooks, book => book.publisher),
    subjects: buildFacet(subjectBooks, book => book.subject),
    grades: buildFacet(gradeBooks, book => book.grade),
    semesters: buildFacet(semesterBooks, book => book.semester)
  }), [publisherBooks, subjectBooks, gradeBooks, semesterBooks]);

  const countFor = (value: string, facet: Facet, total: number) =>
    dataStatus === 'success' ? String(value === '전체' ? total : facet.counts.get(value) ?? 0) : '—';
  const { publishers, subjects, grades, semesters } = facets;

  return (
    <div className="mobile-filter-panel bg-white p-5 rounded-3xl border border-[#E5E8EB] space-y-5 h-fit shadow-sm">
      <div className="mobile-filter-heading flex items-center justify-between border-b border-[#F2F4F6] pb-3">
        <span className="font-bold text-sm text-[#191F28] flex items-center gap-1.5">
          <Filter className="w-4 h-4 text-[#3182F6]" /> 상세 필터
        </span>
        <button type="button" onClick={onReset} className="text-xs font-bold text-[#8B95A1] hover:text-[#191F28]">초기화</button>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-bold text-[#333D4B]">검색어</label>
        <div className="relative">
          <input
            type="search" value={searchQuery}
            onChange={event => setSearchQuery(event.target.value)}
            placeholder="교재명, 출판사, 과목, ISBN 입력"
            aria-label="교재 검색어"
            className="w-full px-3.5 py-2.5 text-xs bg-[#F9FAFB] border border-[#E5E8EB] rounded-2xl text-[#191F28] placeholder-[#ADB5BD] outline-none focus:border-[#3182F6] focus:bg-white transition-all"
          />
          {searchQuery && <button type="button" aria-label="검색어 지우기" onClick={() => setSearchQuery('')} className="absolute right-2.5 top-2.5 text-[#8B95A1]"><X className="w-3.5 h-3.5" /></button>}
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-bold text-[#333D4B]">출판사 ({dataStatus === 'success' ? publishers.options.length - 1 : '—'})</label>
        <select value={publisherFilter} onChange={event => setPublisherFilter(event.target.value)} className="w-full px-3.5 py-2.5 text-xs bg-[#F9FAFB] border border-[#E5E8EB] rounded-2xl font-semibold text-[#191F28] outline-none focus:border-[#3182F6]">
          {publishers.options.map(value => <option key={value} value={value}>{value === '전체' ? `전체 (${countFor(value, publishers, publisherBooks.length)})` : `${value} (${countFor(value, publishers, publisherBooks.length)})`}</option>)}
        </select>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-bold text-[#333D4B]">과목 ({dataStatus === 'success' ? subjects.options.length - 1 : '—'})</label>
        <div className="flex flex-wrap gap-1">
          {subjects.options.map(value => <button type="button" key={value} onClick={() => setSubjectFilter(value)} aria-pressed={subjectFilter === value} className={`px-2.5 py-1 rounded-xl text-xs font-semibold transition-all ${subjectFilter === value ? 'bg-[#3182F6] text-white shadow-sm' : 'bg-[#F2F4F6] text-[#4E5968] hover:bg-[#E5E8EB]'}`}>
            {value === '전체' ? `전체 (${countFor(value, subjects, subjectBooks.length)})` : `${value} (${countFor(value, subjects, subjectBooks.length)})`}
          </button>)}
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-bold text-[#333D4B]">학년 ({dataStatus === 'success' ? grades.options.length - 1 : '—'})</label>
        <div className="grid grid-cols-4 gap-1">
          {grades.options.map(value => <button type="button" key={value} onClick={() => setGradeFilter(value)} aria-pressed={gradeFilter === value} className={`py-1 rounded-xl text-xs font-semibold text-center transition-all ${gradeFilter === value ? 'bg-[#191F28] text-white' : 'bg-[#F2F4F6] text-[#4E5968] hover:bg-[#E5E8EB]'}`}>
            {value === '전체' ? `전체 (${countFor(value, grades, gradeBooks.length)})` : `${value} (${countFor(value, grades, gradeBooks.length)})`}
          </button>)}
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-bold text-[#333D4B]">학기 ({dataStatus === 'success' ? semesters.options.length - 1 : '—'})</label>
        <div className="grid grid-cols-2 gap-1">
          {semesters.options.map(value => <button type="button" key={value} onClick={() => setSemesterFilter(value)} aria-pressed={semesterFilter === value} className={`py-1 rounded-xl text-xs font-semibold text-center transition-all ${semesterFilter === value ? 'bg-[#191F28] text-white' : 'bg-[#F2F4F6] text-[#4E5968] hover:bg-[#E5E8EB]'}`}>
            {value === '전체' ? `전체 (${countFor(value, semesters, semesterBooks.length)})` : `${value} (${countFor(value, semesters, semesterBooks.length)})`}
          </button>)}
        </div>
      </div>
    </div>
  );
}
