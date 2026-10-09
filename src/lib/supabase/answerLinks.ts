import type { AnswerLink } from '../../types/book';
import { supabase } from './client';

export type AnswerLinkInput = Pick<AnswerLink, 'book_id' | 'title' | 'url'> &
  Partial<Pick<AnswerLink, 'source_name' | 'link_type' | 'verified'>>;

export type AnswerLinkUpdate = Pick<AnswerLink, 'title' | 'url'> &
  Partial<Pick<AnswerLink, 'source_name' | 'link_type' | 'verified'>>;

export async function getAnswerLinksByBookId(bookId: string): Promise<AnswerLink[]> {
  const pageSize = 1000;
  const records: AnswerLink[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from('answer_links')
      .select('*')
      .eq('book_id', bookId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (error) throw error;
    const page = (data ?? []) as AnswerLink[];
    records.push(...page);
    if (page.length < pageSize) return records;
  }
}

export async function getAnswerLinks(): Promise<AnswerLink[]> {
  const pageSize = 1000;
  const records: AnswerLink[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from('answer_links')
      .select('*')
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (error) throw error;
    const page = (data ?? []) as AnswerLink[];
    records.push(...page);
    if (page.length < pageSize) return records;
  }
}

export type AnswerLinkImportRecord = Pick<AnswerLink, 'id' | 'book_id' | 'url'>;

export async function getAnswerLinkById(id: string): Promise<AnswerLink | null> {
  const { data, error } = await supabase
    .from('answer_links')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  return data as AnswerLink | null;
}

export async function getAnswerLinksForImport(): Promise<AnswerLinkImportRecord[]> {
  const pageSize = 1000;
  const result: AnswerLinkImportRecord[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from('answer_links')
      .select('id, book_id, url')
      .order('id')
      .range(offset, offset + pageSize - 1);

    if (error) throw error;
    const page = (data ?? []) as AnswerLinkImportRecord[];
    result.push(...page);
    if (page.length < pageSize) return result;
  }
}

export async function createAnswerLink(link: AnswerLinkInput): Promise<AnswerLink> {
  const values = link.verified ? { ...link, last_checked_at: new Date().toISOString() } : link;
  const { data, error } = await supabase
    .from('answer_links')
    .insert(values)
    .select('*')
    .single();

  if (error) throw error;
  return data as AnswerLink;
}

export async function updateAnswerLink(id: string, link: AnswerLinkUpdate): Promise<AnswerLink> {
  const values = {
    ...link,
    ...(link.verified === true ? { last_checked_at: new Date().toISOString() } : {}),
    ...(link.verified === false ? { last_checked_at: null } : {}),
    updated_at: new Date().toISOString()
  };
  const { data, error } = await supabase
    .from('answer_links')
    .update(values)
    .eq('id', id)
    .select('*')
    .single();

  if (error) throw error;
  return data as AnswerLink;
}

export async function deleteAnswerLink(id: string): Promise<void> {
  const { error } = await supabase.from('answer_links').delete().eq('id', id);
  if (error) throw error;
}

export async function recordAnswerLinkClick(linkId: string, clickId: string): Promise<number> {
  const { data, error } = await supabase.rpc('record_answer_link_click', {
    p_link_id: linkId,
    p_click_id: clickId
  });

  if (error) throw error;
  return data as number;
}
