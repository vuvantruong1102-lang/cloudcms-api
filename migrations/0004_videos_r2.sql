-- ============================================================
-- CloudCMS — Migration 0004: Video lưu trên R2 (upload thẳng)
-- Chạy trong D1 Studio: dán TỪNG câu lệnh (mỗi câu kết thúc bằng ;) rồi Run.
-- Thêm cột cho video lưu trực tiếp trên R2 (bổ sung cho kiểu Drive cũ).
-- ============================================================

-- source: 'drive' (link Drive) | 'r2' (file trên R2)
ALTER TABLE videos ADD COLUMN source TEXT NOT NULL DEFAULT 'drive';

-- key của file trên R2 (khi source='r2')
ALTER TABLE videos ADD COLUMN r2_key TEXT;

-- dung lượng file (bytes) + mime, để hiển thị
ALTER TABLE videos ADD COLUMN size_bytes INTEGER;
ALTER TABLE videos ADD COLUMN mime_type TEXT;
