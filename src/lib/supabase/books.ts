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
  curriculumRevision?: string;
}

export type BookInput = Pick<Book, 'title'> & Partial<Omit<Book, 'id' | 'created_at' | 'title'>>;

export async function getBooks(): Promise<Book[]> {
  const { data, error } = await supabase
    .from('books')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data ?? []) as Book[];
}

export async function createBook(book: BookInput): Promise<Book> {
  const { data, error } = await supabase
    .from('books')
    .insert(book)
    .select('*')
    .single();

  if (error) throw error;
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
  return data as Book;
}

export async function deleteBook(id: string): Promise<void> {
  const { error } = await supabase.from('books').delete().eq('id', id);
  if (error) throw error;
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
  let query = supabase.from('books').select('*');

  const searchTerm = filters.title?.trim();
  if (searchTerm) {
    const escaped = searchTerm.replace(/[\\%_]/g, '\\$&').replace(/[,()]/g, '\\$&');
    query = query.or([
      `title.ilike.%${escaped}%`,
      `publisher.ilike.%${escaped}%`,
      `subject.ilike.%${escaped}%`,
      `grade.ilike.%${escaped}%`,
      `semester.ilike.%${escaped}%`,
      `series.ilike.%${escaped}%`,
      `edition.ilike.%${escaped}%`,
      `curriculum_revision.ilike.%${escaped}%`
    ].join(','));
  }

  if (filters.publisher) query = query.eq('publisher', filters.publisher.trim());
  if (filters.subject) query = query.eq('subject', filters.subject.trim());
  if (filters.grade) query = query.eq('grade', filters.grade.trim());
  if (filters.semester) query = query.eq('semester', filters.semester.trim());
  if (filters.series) query = query.eq('series', filters.series.trim());
  if (filters.edition) query = query.eq('edition', filters.edition.trim());
  if (filters.curriculumRevision) query = query.eq('curriculum_revision', filters.curriculumRevision.trim());

  const { data, error } = await query.order('created_at', { ascending: false }).limit(100);

  if (error) throw error;
  return (data ?? []) as Book[];
}
