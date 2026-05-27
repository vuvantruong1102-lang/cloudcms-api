import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { AppEnv } from '../types';
import { requireAuth } from '../middleware/auth';
import { generateId, now } from '../lib/utils';

const app = new Hono<AppEnv>();
app.use('*', requireAuth);

// Danh sách folder ảnh
app.get('/list', async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT id, name, parent_id, created_at FROM media_folders ORDER BY name`
  ).all();
  return c.json({ items: rows.results ?? [] });
});

app.post('/', zValidator('json', z.object({
  name: z.string().min(1).max(120),
  parent_id: z.string().optional().nullable(),
})), async (c) => {
  const { name, parent_id } = c.req.valid('json');
  const id = generateId('mfd');
  const ts = now();
  await c.env.DB.prepare(
    `INSERT INTO media_folders (id, name, parent_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`
  ).bind(id, name, parent_id ?? null, ts, ts).run();
  return c.json({ id });
});

app.put('/:id', zValidator('json', z.object({
  name: z.string().min(1).max(120).optional(),
  parent_id: z.string().optional().nullable(),
})), async (c) => {
  const id = c.req.param('id');
  const { name, parent_id } = c.req.valid('json');
  const fields: string[] = []; const values: any[] = [];
  if (name !== undefined) { fields.push('name = ?'); values.push(name); }
  if (parent_id !== undefined) { fields.push('parent_id = ?'); values.push(parent_id); }
  if (!fields.length) return c.json({ ok: true });
  fields.push('updated_at = ?'); values.push(now());
  await c.env.DB.prepare(`UPDATE media_folders SET ${fields.join(', ')} WHERE id = ?`).bind(...values, id).run();
  return c.json({ ok: true });
});

// Xoá folder: ảnh bên trong về gốc, folder con cascade
app.delete('/:id', async (c) => {
  const id = c.req.param('id');
  await c.env.DB.prepare('UPDATE media SET folder_id = NULL WHERE folder_id = ?').bind(id).run();
  await c.env.DB.prepare('DELETE FROM media_folders WHERE id = ?').bind(id).run();
  return c.json({ ok: true });
});

// Di chuyển ảnh vào folder
app.put('/move/:mediaId', zValidator('json', z.object({
  folder_id: z.string().optional().nullable(),
})), async (c) => {
  const mediaId = c.req.param('mediaId');
  const { folder_id } = c.req.valid('json');
  await c.env.DB.prepare('UPDATE media SET folder_id = ? WHERE id = ?').bind(folder_id ?? null, mediaId).run();
  return c.json({ ok: true });
});

export default app;
