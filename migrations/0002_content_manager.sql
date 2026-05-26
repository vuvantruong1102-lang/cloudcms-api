-- ============================================================
-- CloudCMS — Migration 0002: Content Manager (đa nền tảng)
-- Chạy: wrangler d1 execute cloudcms --remote --file=migrations/0002_content_manager.sql
-- Hoặc paste vào D1 Console (Explore Data).
-- Quy ước khớp 0001: id TEXT, timestamp INTEGER (ms từ Date.now()).
-- ============================================================

-- Nội dung gốc (1 ý tưởng → đăng nhiều nền tảng)
CREATE TABLE IF NOT EXISTS content_posts (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  content_type  TEXT NOT NULL DEFAULT 'post',      -- video | post | article
  body          TEXT,                               -- mô tả / kịch bản gốc
  link_url      TEXT,                               -- link bài web (nếu là article)
  post_id       TEXT REFERENCES posts(id) ON DELETE SET NULL,  -- liên kết bài viết CMS
  cover_media_id TEXT REFERENCES media(id) ON DELETE SET NULL, -- ảnh đại diện
  scheduled_at  INTEGER,                            -- thời điểm dự kiến đăng (ms)
  status        TEXT NOT NULL DEFAULT 'idea',       -- idea|draft|review|scheduled|posted|archived
  created_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
  assigned_to   TEXT REFERENCES users(id) ON DELETE SET NULL,
  remind_sent   INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cposts_status    ON content_posts(status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_cposts_scheduled ON content_posts(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_cposts_assigned  ON content_posts(assigned_to);
CREATE INDEX IF NOT EXISTS idx_cposts_updated   ON content_posts(updated_at DESC);

-- Mỗi nội dung × mỗi nền tảng (caption + trạng thái riêng)
CREATE TABLE IF NOT EXISTS content_targets (
  id           TEXT PRIMARY KEY,
  content_id   TEXT NOT NULL REFERENCES content_posts(id) ON DELETE CASCADE,
  platform     TEXT NOT NULL,                        -- youtube|facebook|zalo|tiktok
  caption      TEXT,
  media_ids    TEXT,                                  -- JSON array media.id
  status       TEXT NOT NULL DEFAULT 'pending',       -- pending|posted|skipped
  posted_url   TEXT,
  posted_at    INTEGER,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ctargets_content  ON content_targets(content_id);
CREATE INDEX IF NOT EXISTS idx_ctargets_platform ON content_targets(platform, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ctargets_unique ON content_targets(content_id, platform);

-- Mẫu caption theo nền tảng
CREATE TABLE IF NOT EXISTS caption_templates (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  platform    TEXT,                                   -- youtube|facebook|zalo|tiktok|all
  body        TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_captpl_platform ON caption_templates(platform);

-- Seed vài mẫu caption (chạy lại an toàn nhờ INSERT OR IGNORE + id cố định)
INSERT OR IGNORE INTO caption_templates (id, name, platform, body, created_at, updated_at) VALUES
 ('captpl_fb_intro','FB - Giới thiệu sản phẩm','facebook',
  '🔋 {ten_san_pham} — chỉ {gia}đ!

{mo_ta}

✅ Bảo hành 12 tháng
✅ Giao hàng toàn quốc (COD)
🛒 Đặt ngay: {link}

#yokool #sacduphong #phukiencongnghe',
  strftime('%s','now')*1000, strftime('%s','now')*1000),
 ('captpl_tt_short','TikTok - Ngắn gọn','tiktok',
  '{ten_san_pham} 🔥 {gia}đ
Link giỏ hàng ở bio 👆
#yokool #review #congnghe #fyp #xuhuong',
  strftime('%s','now')*1000, strftime('%s','now')*1000),
 ('captpl_yt_desc','YouTube - Mô tả video','youtube',
  '{ten_san_pham} - đánh giá chi tiết

Mua chính hãng: {link}
Website: https://yokool.vn

#yokool #review',
  strftime('%s','now')*1000, strftime('%s','now')*1000),
 ('captpl_zl_promo','Zalo - Khuyến mãi','zalo',
  '🎁 ƯU ĐÃI {ten_san_pham}
Giá chỉ còn {gia}đ
{mo_ta}
Inbox hoặc gọi hotline để đặt hàng nhé!',
  strftime('%s','now')*1000, strftime('%s','now')*1000);
