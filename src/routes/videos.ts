import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { AppEnv } from '../types';
import { requireAuth } from '../middleware/auth';
import { generateId, now } from '../lib/utils';

const app = new Hono<AppEnv>();
app.use('*', requireAuth);

// Tách Google Drive file id từ nhiều dạng link:
//   https://drive.google.com/file/d/FILE_ID/view?usp=sharing
//   https://drive.google.com/open?id=FILE_ID
//   https://drive.google.com/uc?id=FILE_ID
function extractDriveId(url: string): string | null {
  if (!url) return null;
  const m1 = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (m1) return m1[1] ?? null;
  const m2 = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (m2) return m2[1] ?? null;
  return null;
}

app.get('/', async (c) => {
  const search = c.req.query('q');
  let where = '1=1';
  const params: any[] = [];
  if (search) { where += ' AND (title LIKE ? OR tags LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
  const rows = await c.env.DB.prepare(
    `SELECT * FROM videos WHERE ${where} ORDER BY created_at DESC`
  ).bind(...params).all();
  return c.json({ items: rows.results ?? [] });
});

app.post('/', zValidator('json', z.object({
  title: z.string().min(1).max(255),
  drive_url: z.string().min(1),
  thumbnail: z.string().optional().nullable(),
  duration: z.number().optional().nullable(),
  note: z.string().optional().nullable(),
  tags: z.string().optional().nullable(),
})), async (c) => {
  const data = c.req.valid('json');
  const user = c.get('user');
  const id = generateId('vid');
  const ts = now();
  const driveId = extractDriveId(data.drive_url);

  await c.env.DB.prepare(
    `INSERT INTO videos (id, title, drive_url, drive_file_id, thumbnail, duration, note, tags, uploaded_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, data.title, data.drive_url, driveId, data.thumbnail ?? null, data.duration ?? null,
         data.note ?? null, data.tags ?? null, user.id, ts, ts).run();

  return c.json({ id, drive_file_id: driveId });
});

app.put('/:id', zValidator('json', z.object({
  title: z.string().min(1).max(255).optional(),
  drive_url: z.string().optional(),
  thumbnail: z.string().optional().nullable(),
  duration: z.number().optional().nullable(),
  note: z.string().optional().nullable(),
  tags: z.string().optional().nullable(),
})), async (c) => {
  const id = c.req.param('id');
  const data = c.req.valid('json');
  const fields: string[] = [];
  const values: any[] = [];
  if (data.title !== undefined) { fields.push('title = ?'); values.push(data.title); }
  if (data.drive_url !== undefined) {
    fields.push('drive_url = ?'); values.push(data.drive_url);
    fields.push('drive_file_id = ?'); values.push(extractDriveId(data.drive_url));
  }
  if (data.thumbnail !== undefined) { fields.push('thumbnail = ?'); values.push(data.thumbnail); }
  if (data.duration !== undefined) { fields.push('duration = ?'); values.push(data.duration); }
  if (data.note !== undefined) { fields.push('note = ?'); values.push(data.note); }
  if (data.tags !== undefined) { fields.push('tags = ?'); values.push(data.tags); }
  if (!fields.length) return c.json({ ok: true });
  fields.push('updated_at = ?'); values.push(now());
  await c.env.DB.prepare(`UPDATE videos SET ${fields.join(', ')} WHERE id = ?`).bind(...values, id).run();
  return c.json({ ok: true });
});

app.delete('/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM videos WHERE id = ?').bind(c.req.param('id')).run();
  return c.json({ ok: true });
});

export default app;
