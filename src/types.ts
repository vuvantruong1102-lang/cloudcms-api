import type { D1Database, R2Bucket, Ai } from '@cloudflare/workers-types';

export type Bindings = {
  DB: D1Database;
  MEDIA: R2Bucket;
  AI: Ai;
  SITE_URL: string;
  R2_PUBLIC_URL: string;
  JWT_ISSUER: string;
  JWT_SECRET: string;
  OPENAI_API_KEY?: string;
  INDEXNOW_KEY?: string;
};

export type Variables = {
  user: {
    id: string;
    email: string;
    role: 'admin' | 'editor';
    name: string;
  };
};

export type AppEnv = {
  Bindings: Bindings;
  Variables: Variables;
};

// Domain types
export type PostStatus = 'draft' | 'published' | 'scheduled' | 'archived';

export type Post = {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  content_html: string | null;
  content_json: string | null;
  meta_title: string | null;
  meta_description: string | null;
  meta_keywords: string | null;
  focus_keyword: string | null;
  canonical_url: string | null;
  og_title: string | null;
  og_description: string | null;
  og_image_url: string | null;
  og_type: string;
  twitter_card: string;
  schema_type: string;
  schema_json: string | null;
  featured_image_id: string | null;
  featured_image_alt: string | null;
  status: PostStatus;
  published_at: number | null;
  scheduled_at: number | null;
  robots_index: number;
  robots_follow: number;
  author_id: string;
  category_id: string | null;
  view_count: number;
  reading_time: number | null;
  word_count: number | null;
  seo_score: number | null;
  created_at: number;
  updated_at: number;
};

export type Media = {
  id: string;
  r2_key: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
  alt_text: string | null;
  caption: string | null;
  url: string;
  uploaded_by: string | null;
  created_at: number;
};
