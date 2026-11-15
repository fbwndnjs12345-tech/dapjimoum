export interface Book {
  id: string;
  title: string;
  publisher: string;
  subject: string;
  grade: string;
  semester: string;
  series?: string;
  edition?: string;
  isbn13?: string | null;
  author?: string | null;
  published_at?: string | null;
  page_count?: number | null;
  list_price?: number | null;
  cover_image_source?: string | null;
  catalog_key?: string;
  book_url?: string | null;
  thumbnail_url?: string;
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
}
