export interface Book {
  id: string;
  title: string;
  publisher: string;
  subject: string;
  grade: string;
  semester: string;
  series?: string;
  edition?: string;
  curriculum_revision?: '2015 개정' | '2022 개정' | null;
  catalog_key?: string;
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
