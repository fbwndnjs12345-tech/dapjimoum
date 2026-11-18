import type { Book } from '../types/book';

const PLACEHOLDER_VALUE = /^(테스트|샘플|seed|example|예시|mock|placeholder|임시)$/i;

/** Hide obvious test records from public catalog views without deleting database rows. */
export function isPlaceholderBook(book: Pick<Book, 'title' | 'publisher' | 'subject'>): boolean {
  const coreValues = [book.title, book.publisher, book.subject]
    .map(value => value?.normalize('NFKC').trim() ?? '')
    .filter(value => PLACEHOLDER_VALUE.test(value));
  return coreValues.length >= 2;
}


/** Legacy numeric grade values were verified against middle-school math book titles. */
export function normalizeGradeLabel(value: string | null | undefined): string {
  const grade = value?.trim() ?? '';
  if (grade === '1') return '중1';
  if (grade === '2') return '중2';
  if (grade === '3') return '중3';
  return grade;
}
