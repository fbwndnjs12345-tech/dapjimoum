import type { Book } from '../types/book';

const PLACEHOLDER_VALUE = /^(테스트|샘플|seed|example|예시|mock|placeholder|임시)$/i;

/** Hide obvious test records from public catalog views without deleting database rows. */
export function isPlaceholderBook(book: Pick<Book, 'title' | 'publisher' | 'subject'>): boolean {
  const coreValues = [book.title, book.publisher, book.subject]
    .map(value => value?.normalize('NFKC').trim() ?? '')
    .filter(value => PLACEHOLDER_VALUE.test(value));
  return coreValues.length >= 2;
}
