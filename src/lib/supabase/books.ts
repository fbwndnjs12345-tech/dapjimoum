import type { Book } from '../../types/book';
import { supabase } from './client';

export interface BookSearchFilters {
  title?: string;
  publisher?: string;
  subject?: string;
  grade?: string;
  semester?: string;
  series?: string;
  edition?: string;
}

export type BookInput = Pick<Book, 'title'> & Partial<Omit<Book, 'id' | 'created_at' | 'title'>>;

let booksCache: { expiresAt: number; value: Book[] } | null = null;
let booksRequest: Promise<Book[]> | null = null;
const BOOKS_CACHE_TTL_MS = 60_000;

function invalidateBooksCache() {
  booksCache = null;
  booksRequest = null;
}

export async function getBooks(): Promise<Book[]> {
  if (booksCache && booksCache.expiresAt > Date.now()) return booksCache.value;
  if (booksRequest) return booksRequest;
  booksRequest = (async () => {
  const pageSize = 1000;
  const records: Book[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from('books')
      .select('*')
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (error) throw error;
    const page = (data ?? []) as Book[];
    records.push(...page);
    if (page.length < pageSize) {
      booksCache = { value: records, expiresAt: Date.now() + BOOKS_CACHE_TTL_MS };
      return records;
    }
  }
  })();
  try { return await booksRequest; } finally { booksRequest = null; }
}

export async function createBook(book: BookInput): Promise<Book> {
  const { data, error } = await supabase
    .from('books')
    .insert(book)
    .select('*')
    .single();

  if (error) throw error;
  invalidateBooksCache();
  return data as Book;
}

export async function updateBook(id: string, book: BookInput): Promise<Book> {
  const { data, error } = await supabase
    .from('books')
    .update({ ...book, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single();

  if (error) throw error;
  invalidateBooksCache();
  return data as Book;
}

export async function deleteBook(id: string): Promise<void> {
  const { error } = await supabase.from('books').delete().eq('id', id);
  if (error) throw error;
  invalidateBooksCache();
}

export async function getBookById(id: string): Promise<Book | null> {
  const { data, error } = await supabase
    .from('books')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  return data as Book | null;
}

export async function searchBooks(filters: BookSearchFilters): Promise<Book[]> {
  const searchTerm = filters.title?.trim();
  const escaped = searchTerm?.replace(/[\\%_]/g, '\\$&').replace(/[,()]/g, '\\$&');
  const buildQuery = () => {
    let query = supabase.from('books').select('*');
    if (searchTerm && escaped) {
      query = query.or([
        `title.ilike.%${escaped}%`,
        `publisher.ilike.%${escaped}%`,
        `subject.ilike.%${escaped}%`,
        `grade.ilike.%${escaped}%`,
        `semester.ilike.%${escaped}%`,
        `series.ilike.%${escaped}%`,
        `edition.ilike.%${escaped}%`,
      ].join(','));
    }
    if (filters.publisher) query = query.eq('publisher', filters.publisher.trim());
    if (filters.subject) query = query.eq('subject', filters.subject.trim());
    if (filters.grade) query = query.eq('grade', filters.grade.trim());
    if (filters.semester) query = query.eq('semester', filters.semester.trim());
    if (filters.series) query = query.eq('series', filters.series.trim());
    if (filters.edition) query = query.eq('edition', filters.edition.trim());
    return query;
  };

  const pageSize = 1000;
  const records: Book[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await buildQuery()
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (error) throw error;
    const page = (data ?? []) as Book[];
    records.push(...page);
    if (page.length < pageSize) return records;
  }
}
