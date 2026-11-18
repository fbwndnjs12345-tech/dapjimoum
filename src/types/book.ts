export interface Book {
  id: string;
  title: string;
  publisher: string;
  subject: string;
  grade: string;
  semester: string;
  series?: string;
  edition?: string;
  curriculum_revision?: string | null;
  isbn13?: string | null;
  author?: string | null;
  published_at?: string | null;
  page_count?: number | null;
  list_price?: number | null;
  cover_image_source?: string | null;
  catalog_key?: string;
  book_url?: string | null;
  thumbnail_url?: string | null;
  description?: string;
  created_at: string;
}

export interface AnswerLink {
  id: string;
  book_id: string;
  title: string;
  url: string;
  source_name: string;
  link_type: string;
  verified: boolean;
  last_checked_at?: string;
  click_count: number;
  health_status?: string;
  health_checked_at?: string | null;
  health_final_url?: string | null;
  health_is_download?: boolean | null;
  health_file_name?: string | null;
  health_match_status?: 'unknown' | 'matched' | 'mismatch' | 'uncertain' | 'not_applicable' | null;
  health_match_note?: string | null;
}
