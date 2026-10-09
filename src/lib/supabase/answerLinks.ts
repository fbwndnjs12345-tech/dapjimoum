import type { AnswerLink } from '../../types/book';
import { supabase } from './client';

export type AnswerLinkInput = Pick<AnswerLink, 'book_id' | 'title' | 'url'> &
  Partial<Pick<AnswerLink, 'source_name' | 'link_type' | 'verified'>>;

export type AnswerLinkUpdate = Pick<AnswerLink, 'title' | 'url'> &
  Partial<Pick<AnswerLink, 'source_name' | 'link_type' | 'verified'>>;

export async function getAnswerLinksByBookId(bookId: string): Promise<AnswerLink[]> {
  const { data, error } = await supabase
    .from('answer_links')
    .select('*')
    .eq('book_id', bookId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data ?? []) as AnswerLink[];
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
