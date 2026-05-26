import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { AppEnv } from '../types';
import { requireAuth } from '../middleware/auth';
import { generateId, now } from '../lib/utils';

const app = new Hono<AppEnv>();
app.use('*', requireAuth);

const PLATFORMS = ['youtube', 'facebook', 'zalo', 'tiktok', 'all'] as const;

app.get('/', async (c) => {
  const platform = c.req.query('platform');
  let where = '1=1';
  const params: any[] = [];
  if (platform && PLATFORMS.includes(platform as any)) {
    where += " AND (platform = ? OR platform = 'all')";
    params.push(platform);
  }
  const rows = await c.env.DB.prepare(
    `SELECT id, name, platform, body, updated_at FROM caption_templates WHERE ${where} ORDER BY platform, name`
  ).bind(...params).all();
  return c.json({ items: rows.results ?? [] });
});

app.post('/', zValidator('json', z.object({
  name: z.string().min(1).max(120),
  platform: z.enum(PLATFORMS).optional(),
  body: z.string().min(1).max(5000),
})), async (c) => {
  const data = c.req.valid('json');
  const id = generateId('captpl');
  const ts = now();
  await c.env.DB.prepare(
    `INSERT INTO caption_templates (id, name, platform, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(id, data.name, data.platform ?? 'all', data.body, ts, ts).run();
  return c.json({ id });
});

app.put('/:id', zValidator('json', z.object({
  name: z.string().min(1).max(120).optional(),
  platform: z.enum(PLATFORMS).optional(),
  body: z.string().min(1).max(5000).optional(),
})), async (c) => {
  const id = c.req.param('id');
  const data = c.req.valid('json');
  const fields: string[] = [];
  const values: any[] = [];
  if (data.name !== undefined) { fields.push('name = ?'); values.push(data.name); }
  if (data.platform !== undefined) { fields.push('platform = ?'); values.push(data.platform); }
  if (data.body !== undefined) { fields.push('body = ?'); values.push(data.body); }
  if (!fields.length) return c.json({ ok: true });
  fields.push('updated_at = ?'); values.push(now());
  await c.env.DB.prepare(`UPDATE caption_templates SET ${fields.join(', ')} WHERE id = ?`)
    .bind(...values, id).run();
  return c.json({ ok: true });
});

app.delete('/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM caption_templates WHERE id = ?').bind(c.req.param('id')).run();
  return c.json({ ok: true });
});

export default app;
