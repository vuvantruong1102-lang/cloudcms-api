-- ============================================================
-- CloudCMS — Migration 0005: Thư mục video lồng nhiều cấp
-- Chạy trong D1 Studio: dán TỪNG câu lệnh rồi Run.
-- ============================================================

CREATE TABLE IF NOT EXISTS video_folders (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  parent_id   TEXT REFERENCES video_folders(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vfolders_parent ON video_folders(parent_id);

ALTER TABLE videos ADD COLUMN folder_id TEXT;
CREATE INDEX IF NOT EXISTS idx_videos_folder ON videos(folder_id);
