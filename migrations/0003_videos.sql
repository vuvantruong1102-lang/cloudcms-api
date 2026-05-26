-- ============================================================
-- CloudCMS — Migration 0003: Video library (Google Drive links)
-- Chạy trong D1 Studio: dán TỪNG câu lệnh (mỗi câu kết thúc bằng ;) rồi Run.
-- Quy ước: id TEXT, timestamp INTEGER (ms).
-- ============================================================

CREATE TABLE IF NOT EXISTS videos (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  drive_url    TEXT NOT NULL,          -- link chia sẻ Google Drive
  drive_file_id TEXT,                   -- id file Drive (tách từ url, để tạo link tải trực tiếp)
  thumbnail    TEXT,                    -- ảnh đại diện (tuỳ chọn)
  duration     INTEGER,                 -- giây (tuỳ chọn, nhập tay)
  note         TEXT,                    -- ghi chú
  tags         TEXT,                    -- tag phân tách dấu phẩy
  uploaded_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_videos_created ON videos(created_at DESC);
