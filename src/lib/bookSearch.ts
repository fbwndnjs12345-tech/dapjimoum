import type { Book } from '../types/book';

const SEARCH_FIELDS = (book: Book) => [
  book.title,
  book.series,
  book.publisher,
  book.subject,
  book.grade,
  book.semester,
  book.edition,
  book.curriculum_revision,
  book.isbn13,
  book.author,
  book.description
].filter((value): value is string => Boolean(value?.trim()));

export function normalizeBookSearch(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('ko-KR')
    .replace(/[\\s·ㆍ_\\-–—()[\\]{}:：,.]+/g, '');
}

/** Returns zero for a non-match; title and series matches rank above metadata matches. */
export function scoreBookSearch(book: Book, rawQuery: string): number {
  const query = normalizeBookSearch(rawQuery.trim());
  if (!query) return 1;

  const title = normalizeBookSearch(book.title ?? '');
  const series = normalizeBookSearch(book.series ?? '');
  const publisher = normalizeBookSearch(book.publisher ?? '');
  const subject = normalizeBookSearch(book.subject ?? '');
  const gradeSemester = normalizeBookSearch([book.grade, book.semester].filter(Boolean).join(' '));
  const fields = SEARCH_FIELDS(book).map(normalizeBookSearch).filter(Boolean);

  if (title === query) return 150;
  if (title.startsWith(query)) return 140;
  if (title.includes(query)) return 130;
  if (series === query) return 125;
  if (series.includes(query)) return 120;
  if (publisher === query) return 110;
  if (publisher.includes(query)) return 105;
  if (subject === query) return 110;
  if (subject.includes(query)) return 100;
  if (gradeSemester.includes(query)) return 95;
  if (fields.some(field => field.includes(query))) return 80;

  // Multi-word queries use AND semantics: every token must occur in the same
  // book's searchable metadata. No edit-distance guessing that adds unrelated books.
  const tokens = rawQuery.normalize('NFKC').toLocaleLowerCase('ko-KR')
    .match(/[가-힣]+|[a-z]+|[0-9]+/g) ?? [];
  if (!tokens.length) return 0;
  const normalizedTokens = tokens.map(normalizeBookSearch).filter(Boolean);
  const hits = normalizedTokens.filter(token => fields.some(field => field.includes(token)));
  if (hits.length !== normalizedTokens.length) return 0;
  return 60 + Math.min(15, hits.length * 2);
}
