-- Users (admin/editor)
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'editor', -- 'admin' | 'editor'
  avatar_url TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Categories (danh mục bài viết)
CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  parent_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL
);

-- Tags
CREATE TABLE tags (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- Bài viết (posts) - đầy đủ trường SEO
CREATE TABLE posts (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  excerpt TEXT,                    -- mô tả ngắn
  content_html TEXT,               -- HTML render từ editor
  content_json TEXT,               -- JSON state của editor (tiptap)

  -- SEO fields
  meta_title TEXT,                 -- <title> tag, fallback = title
  meta_description TEXT,           -- meta description (max 160)
  meta_keywords TEXT,              -- comma-separated
  focus_keyword TEXT,              -- từ khóa chính để chấm SEO
  canonical_url TEXT,              -- canonical URL nếu khác

  -- Open Graph / Twitter Card
  og_title TEXT,
  og_description TEXT,
  og_image_url TEXT,
  og_type TEXT DEFAULT 'article',
  twitter_card TEXT DEFAULT 'summary_large_image',

  -- Schema.org
  schema_type TEXT DEFAULT 'Article', -- Article | BlogPosting | NewsArticle
  schema_json TEXT,                   -- JSON-LD raw nếu user muốn override

  -- Featured image
  featured_image_id TEXT REFERENCES media(id) ON DELETE SET NULL,
  featured_image_alt TEXT,

  -- Publishing
  status TEXT NOT NULL DEFAULT 'draft', -- 'draft' | 'published' | 'scheduled' | 'archived'
  published_at INTEGER,
  scheduled_at INTEGER,

  -- Indexing controls
  robots_index INTEGER DEFAULT 1,  -- 0 = noindex
  robots_follow INTEGER DEFAULT 1, -- 0 = nofollow

  -- Relations
  author_id TEXT NOT NULL REFERENCES users(id),
  category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,

  -- Stats
  view_count INTEGER DEFAULT 0,
  reading_time INTEGER,            -- minutes
  word_count INTEGER,
  seo_score INTEGER,               -- 0-100

  -- Timestamps
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_posts_status ON posts(status);
CREATE INDEX idx_posts_published ON posts(published_at DESC) WHERE status = 'published';
CREATE INDEX idx_posts_author ON posts(author_id);
CREATE INDEX idx_posts_category ON posts(category_id);
CREATE INDEX idx_posts_slug ON posts(slug);

-- Many-to-many: posts <-> tags
CREATE TABLE post_tags (
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (post_id, tag_id)
);

-- Media library (ảnh trong R2)
CREATE TABLE media (
  id TEXT PRIMARY KEY,
  r2_key TEXT UNIQUE NOT NULL,     -- key trong R2 bucket
  filename TEXT NOT NULL,           -- tên file gốc
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  width INTEGER,
  height INTEGER,
  alt_text TEXT,
  caption TEXT,
  url TEXT NOT NULL,                -- public URL (qua custom domain hoặc r2.dev)
  uploaded_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_media_uploader ON media(uploaded_by);
CREATE INDEX idx_media_created ON media(created_at DESC);

-- Revisions (lưu phiên bản cũ của bài viết)
CREATE TABLE post_revisions (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content_html TEXT,
  content_json TEXT,
  saved_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_revisions_post ON post_revisions(post_id, created_at DESC);

-- Site settings (key-value)
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Default settings
INSERT INTO settings (key, value, updated_at) VALUES
  ('site_name', 'My Website', strftime('%s', 'now') * 1000),
  ('site_url', 'https://example.com', strftime('%s', 'now') * 1000),
  ('default_og_image', '', strftime('%s', 'now') * 1000),
  ('twitter_handle', '', strftime('%s', 'now') * 1000);
