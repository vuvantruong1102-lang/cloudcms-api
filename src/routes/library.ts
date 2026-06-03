import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { AppEnv } from '../types';
import { requireAuth } from '../middleware/auth';
import { generateId, slugify, stripHtml, now } from '../lib/utils';

const app = new Hono<AppEnv>();
app.use('*', requireAuth);

function makeExcerpt(html: string): string {
  const text = stripHtml(html ?? '');
  return text.slice(0, 200);
}

// ---------- List (không trả html để nhẹ) ----------
app.get('/', async (c) => {
  const search = c.req.query('q');
  let where = '1=1';
  const params: any[] = [];
  if (search) { where += ' AND title LIKE ?'; params.push(`%${search}%`); }
  const rows = await c.env.DB.prepare(
    `SELECT id, title, slug, excerpt, created_at, updated_at
     FROM library_articles WHERE ${where} ORDER BY updated_at DESC`
  ).bind(...params).all();
  return c.json({ items: rows.results ?? [] });
});

// ---------- Get one (kèm html đầy đủ) ----------
app.get('/:id', async (c) => {
  const id = c.req.param('id');
  const row = await c.env.DB.prepare(
    `SELECT id, title, slug, html, excerpt, created_at, updated_at FROM library_articles WHERE id = ?`
  ).bind(id).first();
  if (!row) return c.json({ error: 'Not found' }, 404);
  return c.json(row);
});

// ---------- Create ----------
app.post('/', zValidator('json', z.object({
  title: z.string().min(1).max(255),
  html: z.string().optional().nullable(),
  slug: z.string().optional().nullable(),
})), async (c) => {
  const { title, html, slug } = c.req.valid('json');
  const id = generateId('lib');
  const ts = now();
  const body = html ?? '';
  await c.env.DB.prepare(
    `INSERT INTO library_articles (id, title, slug, html, excerpt, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, title, slug ?? slugify(title), body, makeExcerpt(body), ts, ts).run();
  return c.json({ id, title, slug: slug ?? slugify(title), html: body, excerpt: makeExcerpt(body), created_at: ts, updated_at: ts });
});

// ---------- Update ----------
app.put('/:id', zValidator('json', z.object({
  title: z.string().min(1).max(255).optional(),
  html: z.string().optional().nullable(),
  slug: z.string().optional().nullable(),
})), async (c) => {
  const id = c.req.param('id');
  const { title, html, slug } = c.req.valid('json');
  const fields: string[] = []; const values: any[] = [];
  if (title !== undefined) { fields.push('title = ?'); values.push(title); }
  if (slug !== undefined) { fields.push('slug = ?'); values.push(slug); }
  if (html !== undefined) {
    fields.push('html = ?'); values.push(html ?? '');
    fields.push('excerpt = ?'); values.push(makeExcerpt(html ?? ''));
  }
  if (!fields.length) return c.json({ ok: true });
  fields.push('updated_at = ?'); values.push(now());
  await c.env.DB.prepare(`UPDATE library_articles SET ${fields.join(', ')} WHERE id = ?`).bind(...values, id).run();
  return c.json({ ok: true });
});

// ---------- Delete ----------
app.delete('/:id', async (c) => {
  const id = c.req.param('id');
  await c.env.DB.prepare('DELETE FROM library_articles WHERE id = ?').bind(id).run();
  return c.json({ ok: true });
});

export default app;
