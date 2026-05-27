import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { AppEnv } from '../types';
import { requireAuth } from '../middleware/auth';
import { generateId, slugify, now } from '../lib/utils';

const app = new Hono<AppEnv>();

app.use('*', requireAuth);

const ALLOWED_MIME = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif', 'image/svg+xml',
]);
const MAX_SIZE = 10 * 1024 * 1024; // 10 MB

// Upload trực tiếp (multipart form)
app.post('/upload', async (c) => {
  const user = c.get('user');
  const formData = await c.req.formData();
  const file = formData.get('file');
  const altText = (formData.get('alt') as string | null) ?? null;
  const caption = (formData.get('caption') as string | null) ?? null;
  const folderId = (formData.get('folder_id') as string | null) || null;

  if (!(file instanceof File)) return c.json({ error: 'Thiếu file' }, 400);

  if (!ALLOWED_MIME.has(file.type)) {
    return c.json({ error: `Loại file không hỗ trợ: ${file.type}` }, 400);
  }
  if (file.size > MAX_SIZE) {
    return c.json({ error: 'File quá lớn (max 10MB)' }, 400);
  }

  const id = generateId('med');
  const ext = file.name.split('.').pop()?.toLowerCase() ?? 'bin';
  const safeName = slugify(file.name.replace(/\.[^.]+$/, '')) || 'image';
  const date = new Date();
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const r2Key = `${yyyy}/${mm}/${id}-${safeName}.${ext}`;

  // Upload lên R2
  await c.env.MEDIA.put(r2Key, file.stream(), {
    httpMetadata: { contentType: file.type },
    customMetadata: { uploadedBy: user.id, originalName: file.name },
  });

  const publicUrl = `${c.env.R2_PUBLIC_URL}/${r2Key}`;

  // Lấy width/height nếu có thể (đơn giản: bỏ qua, để client gửi lên nếu cần)
  const width = Number(formData.get('width')) || null;
  const height = Number(formData.get('height')) || null;

  await c.env.DB.prepare(
    `INSERT INTO media (id, r2_key, filename, mime_type, size_bytes, width, height, alt_text, caption, url, folder_id, uploaded_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(id, r2Key, file.name, file.type, file.size, width, height, altText, caption, publicUrl, folderId, user.id, now())
    .run();

  return c.json({
    id, r2_key: r2Key, filename: file.name, mime_type: file.type,
    size_bytes: file.size, width, height, alt_text: altText, caption,
    url: publicUrl,
  });
});

// List media với pagination
app.get('/', async (c) => {
  const page = Math.max(1, parseInt(c.req.query('page') ?? '1'));
  const limit = Math.min(50, Math.max(1, parseInt(c.req.query('limit') ?? '24')));
  const offset = (page - 1) * limit;
  const search = c.req.query('q');

  let where = '1=1';
  const params: any[] = [];
  if (search) {
    where += ' AND (filename LIKE ? OR alt_text LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  } else {
    const folder = c.req.query('folder');
    if (folder && folder !== 'all') {
      if (folder === 'root') where += ' AND folder_id IS NULL';
      else { where += ' AND folder_id = ?'; params.push(folder); }
    }
  }

  const items = await c.env.DB.prepare(
    `SELECT * FROM media WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
  )
    .bind(...params, limit, offset)
    .all();

  const total = await c.env.DB.prepare(`SELECT COUNT(*) as cnt FROM media WHERE ${where}`)
    .bind(...params)
    .first<{ cnt: number }>();

  return c.json({ items: items.results, total: total?.cnt ?? 0, page, limit });
});

// Update metadata (alt text, caption)
app.patch('/:id', zValidator('json', z.object({
  alt_text: z.string().optional().nullable(),
  caption: z.string().optional().nullable(),
})), async (c) => {
  const id = c.req.param('id');
  const data = c.req.valid('json');

  const updates: string[] = [];
  const values: any[] = [];
  if (data.alt_text !== undefined) { updates.push('alt_text = ?'); values.push(data.alt_text); }
  if (data.caption !== undefined) { updates.push('caption = ?'); values.push(data.caption); }

  if (!updates.length) return c.json({ ok: true });

  await c.env.DB.prepare(`UPDATE media SET ${updates.join(', ')} WHERE id = ?`)
    .bind(...values, id)
    .run();

  return c.json({ ok: true });
});

// Delete - xóa cả R2 object và DB record
app.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const media = await c.env.DB.prepare('SELECT r2_key FROM media WHERE id = ?').bind(id).first<{ r2_key: string }>();
  if (!media) return c.json({ error: 'Not found' }, 404);

  await c.env.MEDIA.delete(media.r2_key);
  await c.env.DB.prepare('DELETE FROM media WHERE id = ?').bind(id).run();

  return c.json({ ok: true });
});

export default app;
