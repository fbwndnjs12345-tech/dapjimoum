import { useMemo } from 'react';
import { Filter, X } from 'lucide-react';
import type { Book } from '../../types/book';

type SearchFiltersProps = {
  books: Book[];
  dataStatus: 'loading' | 'error' | 'success';
  searchQuery: string; setSearchQuery: (value: string) => void;
  publisherFilter: string; setPublisherFilter: (value: string) => void;
  subjectFilter: string; setSubjectFilter: (value: string) => void;
  gradeFilter: string; setGradeFilter: (value: string) => void;
  semesterFilter: string; setSemesterFilter: (value: string) => void;
  onReset: () => void;
};

export function SearchFilters({ books, dataStatus, searchQuery, setSearchQuery, publisherFilter, setPublisherFilter, subjectFilter, setSubjectFilter, gradeFilter, setGradeFilter, semesterFilter, setSemesterFilter, onReset }: SearchFiltersProps) {
  const countText = (count: number) => dataStatus === 'success' ? String(count) : '—';
  const facets = useMemo(() => {
    const build = (select: (book: Book) => string | null | undefined) => {
      const counts = new Map<string, number>();
      for (const book of books) {
        const value = select(book)?.trim();
        if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
      }
      return {
        options: ['전체', ...Array.from(counts.keys()).sort((a, b) => a.localeCompare(b, 'ko'))],
        counts
      };
    };
    return {
      publishers: build(book => book.publisher),
      subjects: build(book => book.subject),
      grades: build(book => book.grade),
      semesters: build(book => book.semester)
    };
  }, [books]);
  const countFor = (value: string, facet: { counts: Map<string, number> }) =>
    countText(value === '전체' ? books.length : facet.counts.get(value) ?? 0);
  const { publishers, subjects, grades, semesters } = {
    publishers: facets.publishers.options,
    subjects: facets.subjects.options,
    grades: facets.grades.options,
    semesters: facets.semesters.options
  };
  return (
          <div className="mobile-filter-panel bg-white p-5 rounded-3xl border border-[#E5E8EB] space-y-5 h-fit shadow-sm">
            <div className="mobile-filter-heading flex items-center justify-between border-b border-[#F2F4F6] pb-3">
              <span className="font-bold text-sm text-[#191F28] flex items-center gap-1.5">
                <Filter className="w-4 h-4 text-[#3182F6]" /> 상세 필터
              </span>
              <button
                onClick={onReset}
                className="text-xs font-bold text-[#8B95A1] hover:text-[#191F28]"
              >
                초기화
              </button>
            </div>

            {/* Keyword Search */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-[#333D4B]">검색어</label>
              <div className="relative">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="교재명, 시리즈 입력"
                  className="w-full px-3.5 py-2.5 text-xs bg-[#F9FAFB] border border-[#E5E8EB] rounded-2xl text-[#191F28] placeholder-[#ADB5BD] outline-none focus:border-[#3182F6] focus:bg-white transition-all"
                />
                {searchQuery && (
                  <button onClick={() => setSearchQuery('')} className="absolute right-2.5 top-2.5 text-[#8B95A1]">
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* Publisher Filter */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-[#333D4B]">출판사 ({dataStatus === 'success' ? publishers.length - 1 : '—'})</label>
              <select
                value={publisherFilter}
                onChange={(e) => setPublisherFilter(e.target.value)}
                className="w-full px-3.5 py-2.5 text-xs bg-[#F9FAFB] border border-[#E5E8EB] rounded-2xl font-semibold text-[#191F28] outline-none focus:border-[#3182F6]"
              >
                {publishers.map(p => (
                  <option key={p} value={p}>{p === '전체' ? `전체 (${countFor(p, facets.publishers)})` : `${p} (${countFor(p, book => book.publisher)})`}</option>
                ))}
              </select>
            </div>

            {/* Subject Filter */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-[#333D4B]">과목 ({dataStatus === 'success' ? subjects.length - 1 : '—'})</label>
              <div className="flex flex-wrap gap-1">
                {subjects.map(s => (
                  <button
                    key={s}
                    onClick={() => setSubjectFilter(s)}
                    className={`px-2.5 py-1 rounded-xl text-xs font-semibold transition-all ${
                      subjectFilter === s
                        ? 'bg-[#3182F6] text-white shadow-sm'
                        : 'bg-[#F2F4F6] text-[#4E5968] hover:bg-[#E5E8EB]'
                    }`}
                  >
                    {s === '전체' ? `전체 (${countFor(s, facets.subjects)})` : `${s} (${countFor(s, book => book.subject)})`}
                  </button>
                ))}
              </div>
            </div>

            {/* Grade Filter */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-[#333D4B]">학년 ({dataStatus === 'success' ? grades.length - 1 : '—'})</label>
              <div className="grid grid-cols-4 gap-1">
                {grades.map(g => (
                  <button
                    key={g}
                    onClick={() => setGradeFilter(g)}
                    className={`py-1 rounded-xl text-xs font-semibold text-center transition-all ${
                      gradeFilter === g
                        ? 'bg-[#191F28] text-white'
                        : 'bg-[#F2F4F6] text-[#4E5968] hover:bg-[#E5E8EB]'
                    }`}
                  >
                    {g === '전체' ? `전체 (${countFor(g, facets.grades)})` : `${g} (${countFor(g, book => book.grade)})`}
                  </button>
                ))}
              </div>
            </div>

            {/* Semester Filter */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-[#333D4B]">학기 ({dataStatus === 'success' ? semesters.length - 1 : '—'})</label>
              <div className="grid grid-cols-2 gap-1">
                {semesters.map(sem => (
                  <button
                    key={sem}
                    onClick={() => setSemesterFilter(sem)}
                    className={`py-1 rounded-xl text-xs font-semibold text-center transition-all ${
                      semesterFilter === sem
                        ? 'bg-[#191F28] text-white'
                        : 'bg-[#F2F4F6] text-[#4E5968] hover:bg-[#E5E8EB]'
                    }`}
                  >
                    {sem === '전체' ? `전체 (${countFor(sem, facets.semesters)})` : `${sem} (${countFor(sem, book => book.semester)})`}
                  </button>
                ))}
              </div>
            </div>

          </div>

  );
}
