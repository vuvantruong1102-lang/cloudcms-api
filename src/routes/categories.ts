import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { AppEnv } from '../types';
import { requireAuth } from '../middleware/auth';
import { generateId, slugify, now } from '../lib/utils';

const app = new Hono<AppEnv>();
app.use('*', requireAuth);

app.get('/', async (c) => {
  const rows = await c.env.DB.prepare(
    'SELECT * FROM categories ORDER BY name ASC'
  ).all();
  return c.json(rows.results);
});

app.post('/', zValidator('json', z.object({
  name: z.string().min(1),
  slug: z.string().optional(),
  description: z.string().optional(),
  parent_id: z.string().optional().nullable(),
})), async (c) => {
  const data = c.req.valid('json');
  const id = generateId('cat');
  const slug = data.slug?.trim() || slugify(data.name);
  try {
    await c.env.DB.prepare(
      'INSERT INTO categories (id, slug, name, description, parent_id, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    )
      .bind(id, slug, data.name, data.description ?? null, data.parent_id ?? null, now())
      .run();
  } catch (e: any) {
    if (e.message?.includes('UNIQUE')) return c.json({ error: 'Slug đã tồn tại' }, 409);
    throw e;
  }
  return c.json({ id, slug });
});

app.delete('/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM categories WHERE id = ?').bind(c.req.param('id')).run();
  return c.json({ ok: true });
});

export default app;
