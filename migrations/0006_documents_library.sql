-- ============================================================
-- CloudCMS — Migration 0006: Tài liệu (PDF/Excel/Word) + Thư viện bài viết HTML
-- Chạy trong D1 Studio: dán TỪNG câu lệnh (mỗi câu kết thúc bằng ;) rồi Run.
-- Quy ước: id TEXT, timestamp INTEGER (ms).
-- ============================================================

-- ---------- Thư mục tài liệu (lồng nhiều cấp) ----------
CREATE TABLE IF NOT EXISTS document_folders (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  parent_id   TEXT REFERENCES document_folders(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dfolders_parent ON document_folders(parent_id);

-- ---------- Tài liệu (file lưu trên R2) ----------
CREATE TABLE IF NOT EXISTS documents (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL,            -- tên hiển thị
  filename     TEXT NOT NULL,            -- tên file gốc
  r2_key       TEXT NOT NULL,            -- key trên R2
  public_url   TEXT,                     -- url public (nếu bucket public)
  size_bytes   INTEGER,
  mime_type    TEXT,
  note         TEXT,
  folder_id    TEXT,                     -- NULL = thư mục gốc
  uploaded_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_documents_created ON documents(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_documents_folder ON documents(folder_id);

-- ---------- Thư viện bài viết HTML ----------
CREATE TABLE IF NOT EXISTS library_articles (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  slug        TEXT,
  html        TEXT NOT NULL DEFAULT '',  -- mã HTML thô của bài viết
  excerpt     TEXT,                       -- trích đoạn (tự sinh từ html)
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_library_updated ON library_articles(updated_at DESC);
