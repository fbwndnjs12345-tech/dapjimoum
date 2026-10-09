import { Filter, X } from 'lucide-react';
import type { Book } from '../../types/book';

const CURRICULUM_REVISIONS = ['전체', '2015 개정', '2022 개정'];

type SearchFiltersProps = {
  books: Book[];
  dataStatus: 'loading' | 'error' | 'success';
  searchQuery: string; setSearchQuery: (value: string) => void;
  publisherFilter: string; setPublisherFilter: (value: string) => void;
  subjectFilter: string; setSubjectFilter: (value: string) => void;
  gradeFilter: string; setGradeFilter: (value: string) => void;
  semesterFilter: string; setSemesterFilter: (value: string) => void;
  curriculumRevisionFilter: string; setCurriculumRevisionFilter: (value: string) => void;
  onReset: () => void;
};

export function SearchFilters({ books, dataStatus, searchQuery, setSearchQuery, publisherFilter, setPublisherFilter, subjectFilter, setSubjectFilter, gradeFilter, setGradeFilter, semesterFilter, setSemesterFilter, curriculumRevisionFilter, setCurriculumRevisionFilter, onReset }: SearchFiltersProps) {
  const countText = (count: number) => dataStatus === 'success' ? String(count) : '—';
  const optionsFor = (select: (book: Book) => string | null | undefined) => [
    '전체',
    ...Array.from(new Set(books.map(book => select(book)?.trim()).filter((value): value is string => Boolean(value)))).sort((a, b) => a.localeCompare(b, 'ko'))
  ];
  const countFor = (value: string, select: (book: Book) => string | null | undefined) =>
    countText(value === '전체' ? books.length : books.filter(book => select(book)?.trim() === value).length);
  const publishers = optionsFor(book => book.publisher);
  const subjects = optionsFor(book => book.subject);
  const grades = optionsFor(book => book.grade);
  const semesters = optionsFor(book => book.semester);
  return (
          <div className="bg-white p-5 rounded-3xl border border-[#E5E8EB] space-y-5 h-fit shadow-sm">
            <div className="flex items-center justify-between border-b border-[#F2F4F6] pb-3">
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
                  <option key={p} value={p}>{p === '전체' ? `전체 (${countFor(p, book => book.publisher)})` : `${p} (${countFor(p, book => book.publisher)})`}</option>
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
                    {s === '전체' ? `전체 (${countFor(s, book => book.subject)})` : `${s} (${countFor(s, book => book.subject)})`}
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
                    {g === '전체' ? `전체 (${countFor(g, book => book.grade)})` : `${g} (${countFor(g, book => book.grade)})`}
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
                    {sem === '전체' ? `전체 (${countFor(sem, book => book.semester)})` : `${sem} (${countFor(sem, book => book.semester)})`}
                  </button>
                ))}
              </div>
            </div>

            {/* Curriculum Revision Filter */}
            <div className="space-y-1.5">
              <label htmlFor="curriculum-revision-filter" className="text-xs font-bold text-[#333D4B]">교육과정 개정</label>
              <select
                id="curriculum-revision-filter"
                value={curriculumRevisionFilter}
                onChange={(e) => setCurriculumRevisionFilter(e.target.value)}
                className="w-full px-3.5 py-2.5 text-xs bg-[#F9FAFB] border border-[#E5E8EB] rounded-2xl font-semibold text-[#191F28] outline-none focus:border-[#3182F6]"
              >
                {CURRICULUM_REVISIONS.map(revision => <option key={revision} value={revision}>{revision}</option>)}
              </select>
            </div>
          </div>

  );
}
