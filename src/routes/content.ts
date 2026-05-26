import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { AppEnv } from '../types';
import { requireAuth } from '../middleware/auth';
import { generateId, now } from '../lib/utils';

const app = new Hono<AppEnv>();
app.use('*', requireAuth);

const PLATFORMS = ['youtube', 'facebook', 'zalo', 'tiktok'] as const;
const CONTENT_STATUS = ['idea', 'draft', 'review', 'scheduled', 'posted', 'archived'] as const;
const CONTENT_TYPES = ['video', 'post', 'article'] as const;
const TARGET_STATUS = ['pending', 'posted', 'skipped'] as const;

const targetSchema = z.object({
  platform: z.enum(PLATFORMS),
  caption: z.string().optional().nullable(),
  media_ids: z.array(z.string()).optional().nullable(),
  status: z.enum(TARGET_STATUS).optional(),
  posted_url: z.string().optional().nullable(),
  posted_at: z.number().optional().nullable(),
});

const createSchema = z.object({
  title: z.string().min(1).max(255),
  content_type: z.enum(CONTENT_TYPES).optional(),
  body: z.string().optional().nullable(),
  link_url: z.string().optional().nullable(),
  post_id: z.string().optional().nullable(),
  cover_media_id: z.string().optional().nullable(),
  scheduled_at: z.number().optional().nullable(),
  status: z.enum(CONTENT_STATUS).optional(),
  assigned_to: z.string().optional().nullable(),
  platforms: z.array(z.enum(PLATFORMS)).optional(), // tạo nhanh targets rỗng
});

const updateSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  content_type: z.enum(CONTENT_TYPES).optional(),
  body: z.string().optional().nullable(),
  link_url: z.string().optional().nullable(),
  post_id: z.string().optional().nullable(),
  cover_media_id: z.string().optional().nullable(),
  scheduled_at: z.number().optional().nullable(),
  status: z.enum(CONTENT_STATUS).optional(),
  assigned_to: z.string().optional().nullable(),
  targets: z.array(targetSchema).optional(),
  delete_platform: z.enum(PLATFORMS).optional(),
});

// ---------- List ----------
app.get('/', async (c) => {
  const status = c.req.query('status');
  const platform = c.req.query('platform');
  const assigned = c.req.query('assigned');
  const from = c.req.query('from'); // ms
  const to = c.req.query('to');     // ms
  const page = Math.max(1, parseInt(c.req.query('page') ?? '1'));
  const limit = Math.min(100, Math.max(1, parseInt(c.req.query('limit') ?? '50')));
  const offset = (page - 1) * limit;

  let where = '1=1';
  const params: any[] = [];
  if (status && CONTENT_STATUS.includes(status as any)) { where += ' AND cp.status = ?'; params.push(status); }
  if (assigned) { where += ' AND cp.assigned_to = ?'; params.push(assigned); }
  if (from) { where += ' AND cp.scheduled_at >= ?'; params.push(parseInt(from)); }
  if (to) { where += ' AND cp.scheduled_at <= ?'; params.push(parseInt(to)); }

  let join = '';
  if (platform && PLATFORMS.includes(platform as any)) {
    join = 'JOIN content_targets ct ON ct.content_id = cp.id AND ct.platform = ?';
    params.push(platform);
  }

  const items = await c.env.DB.prepare(
    `SELECT DISTINCT cp.id, cp.title, cp.content_type, cp.scheduled_at, cp.status,
            cp.assigned_to, cp.created_at, cp.updated_at, u.name as assigned_name
     FROM content_posts cp
     ${join}
     LEFT JOIN users u ON u.id = cp.assigned_to
     WHERE ${where}
     ORDER BY COALESCE(cp.scheduled_at, cp.updated_at) DESC
     LIMIT ? OFFSET ?`
  ).bind(...params, limit, offset).all();

  const rows = (items.results ?? []) as any[];

  // gắn badges nền tảng
  if (rows.length) {
    const ids = rows.map((r) => r.id);
    const placeholders = ids.map(() => '?').join(',');
    const tg = await c.env.DB.prepare(
      `SELECT content_id, platform, status FROM content_targets WHERE content_id IN (${placeholders})`
    ).bind(...ids).all();
    const byId: Record<string, any[]> = {};
    for (const t of (tg.results ?? []) as any[]) {
      (byId[t.content_id] ||= []).push({ platform: t.platform, status: t.status });
    }
    for (const r of rows) r.targets = byId[r.id] ?? [];
  }

  return c.json({ items: rows, page, limit });
});

// ---------- Notifications (chuông) — đặt TRƯỚC /:id để không bị nuốt ----------
app.get('/notifications', async (c) => {
  const ts = now();
  const dayAhead = ts + 24 * 60 * 60 * 1000;
  const upcoming = await c.env.DB.prepare(
    `SELECT id, title, scheduled_at FROM content_posts
     WHERE status='scheduled' AND scheduled_at IS NOT NULL
       AND scheduled_at > ? AND scheduled_at <= ?
     ORDER BY scheduled_at ASC LIMIT 20`
  ).bind(ts, dayAhead).all();
  const overdue = await c.env.DB.prepare(
    `SELECT id, title, scheduled_at FROM content_posts
     WHERE status='scheduled' AND scheduled_at IS NOT NULL AND scheduled_at < ?
     ORDER BY scheduled_at ASC LIMIT 20`
  ).bind(ts).all();
  const up = upcoming.results ?? [];
  const od = overdue.results ?? [];
  return c.json({ count: up.length + od.length, upcoming: up, overdue: od });
});

// ---------- Detail ----------
app.get('/:id', async (c) => {
  const id = c.req.param('id');
  const post = await c.env.DB.prepare(
    `SELECT cp.*, cb.name as created_name, au.name as assigned_name
     FROM content_posts cp
     LEFT JOIN users cb ON cb.id = cp.created_by
     LEFT JOIN users au ON au.id = cp.assigned_to
     WHERE cp.id = ?`
  ).bind(id).first();
  if (!post) return c.json({ error: 'Không tìm thấy nội dung' }, 404);

  const targets = await c.env.DB.prepare(
    `SELECT id, platform, caption, media_ids, status, posted_url, posted_at
     FROM content_targets WHERE content_id = ?
     ORDER BY CASE platform WHEN 'youtube' THEN 1 WHEN 'facebook' THEN 2
       WHEN 'zalo' THEN 3 WHEN 'tiktok' THEN 4 ELSE 9 END`
  ).bind(id).all();

  return c.json({ ...post, targets: targets.results ?? [] });
});

// ---------- Create ----------
app.post('/', zValidator('json', createSchema), async (c) => {
  const data = c.req.valid('json');
  const user = c.get('user');
  const id = generateId('cnt');
  const ts = now();

  await c.env.DB.prepare(
    `INSERT INTO content_posts
       (id, title, content_type, body, link_url, post_id, cover_media_id,
        scheduled_at, status, created_by, assigned_to, remind_sent, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
  ).bind(
    id, data.title, data.content_type ?? 'post', data.body ?? null,
    data.link_url ?? null, data.post_id ?? null, data.cover_media_id ?? null,
    data.scheduled_at ?? null, data.status ?? 'idea',
    user.id, data.assigned_to ?? null, ts, ts
  ).run();

  if (data.platforms?.length) {
    const stmts = data.platforms.map((pf) =>
      c.env.DB.prepare(
        `INSERT OR IGNORE INTO content_targets (id, content_id, platform, status, created_at, updated_at)
         VALUES (?, ?, ?, 'pending', ?, ?)`
      ).bind(generateId('tgt'), id, pf, ts, ts)
    );
    await c.env.DB.batch(stmts);
  }

  return c.json({ id });
});

// ---------- Update (+ upsert targets) ----------
app.put('/:id', zValidator('json', updateSchema), async (c) => {
  const id = c.req.param('id');
  const data = c.req.valid('json');

  const existing = await c.env.DB.prepare('SELECT id, status FROM content_posts WHERE id = ?').bind(id).first<{ id: string; status: string }>();
  if (!existing) return c.json({ error: 'Không tìm thấy nội dung' }, 404);

  const fields: string[] = [];
  const values: any[] = [];
  const map: Record<string, any> = {
    title: data.title, content_type: data.content_type, body: data.body,
    link_url: data.link_url, post_id: data.post_id, cover_media_id: data.cover_media_id,
    scheduled_at: data.scheduled_at, status: data.status, assigned_to: data.assigned_to,
  };
  for (const [k, v] of Object.entries(map)) {
    if (v !== undefined) { fields.push(`${k} = ?`); values.push(v); }
  }
  // đổi lịch hoặc set scheduled → reset cờ nhắc
  if (data.scheduled_at !== undefined || data.status === 'scheduled') {
    fields.push('remind_sent = ?'); values.push(0);
  }
  if (fields.length) {
    fields.push('updated_at = ?'); values.push(now());
    await c.env.DB.prepare(`UPDATE content_posts SET ${fields.join(', ')} WHERE id = ?`)
      .bind(...values, id).run();
  }

  // upsert targets
  if (data.targets?.length) {
    const ts = now();
    for (const t of data.targets) {
      const mediaIds = t.media_ids != null ? JSON.stringify(t.media_ids) : null;
      const tStatus = t.status ?? 'pending';
      const postedAt = tStatus === 'posted' ? (t.posted_at ?? ts) : null;
      await c.env.DB.prepare(
        `INSERT INTO content_targets (id, content_id, platform, caption, media_ids, status, posted_url, posted_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(content_id, platform) DO UPDATE SET
           caption=excluded.caption, media_ids=excluded.media_ids, status=excluded.status,
           posted_url=excluded.posted_url, posted_at=excluded.posted_at, updated_at=excluded.updated_at`
      ).bind(generateId('tgt'), id, t.platform, t.caption ?? null, mediaIds, tStatus,
             t.posted_url ?? null, postedAt, ts, ts).run();
    }
  }

  if (data.delete_platform) {
    await c.env.DB.prepare('DELETE FROM content_targets WHERE content_id = ? AND platform = ?')
      .bind(id, data.delete_platform).run();
  }

  return c.json({ ok: true });
});

// ---------- Delete ----------
app.delete('/:id', async (c) => {
  const id = c.req.param('id');
  await c.env.DB.prepare('DELETE FROM content_posts WHERE id = ?').bind(id).run();
  return c.json({ ok: true });
});

export default app;
