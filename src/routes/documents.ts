import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { AwsClient } from 'aws4fetch';
import type { AppEnv } from '../types';
import { requireAuth } from '../middleware/auth';
import { generateId, slugify, now } from '../lib/utils';

const app = new Hono<AppEnv>();
app.use('*', requireAuth);

// PDF, Excel (xlsx/xls/csv), Word (doc/docx)
const DOC_MIME = new Set([
  'application/pdf',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/octet-stream', // fallback khi trình duyệt không nhận diện được
]);
const MAX_SIZE = 200 * 1024 * 1024; // 200 MB

// --- R2 S3 client để ký presigned URL (giống videos) ---
function getR2Client(c: any): { client: AwsClient; endpoint: string; bucket: string } | null {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = c.env;
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET) return null;
  const client = new AwsClient({
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
    service: 's3',
    region: 'auto',
  });
  const endpoint = `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  return { client, endpoint, bucket: R2_BUCKET };
}

// ---------- List (lọc theo folder) ----------
app.get('/', async (c) => {
  const search = c.req.query('q');
  const folderId = c.req.query('folder'); // 'root' | id | 'all'
  let where = '1=1';
  const params: any[] = [];
  if (search) {
    where += ' AND (title LIKE ? OR filename LIKE ?)'; params.push(`%${search}%`, `%${search}%`);
  } else if (folderId && folderId !== 'all') {
    if (folderId === 'root') where += ' AND folder_id IS NULL';
    else { where += ' AND folder_id = ?'; params.push(folderId); }
  }
  const rows = await c.env.DB.prepare(
    `SELECT * FROM documents WHERE ${where} ORDER BY created_at DESC`
  ).bind(...params).all();
  return c.json({ items: rows.results ?? [] });
});

// ---------- Folders ----------
app.get('/folders/list', async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT id, name, parent_id, created_at FROM document_folders ORDER BY name`
  ).all();
  return c.json({ items: rows.results ?? [] });
});

app.post('/folders', zValidator('json', z.object({
  name: z.string().min(1).max(120),
  parent_id: z.string().optional().nullable(),
})), async (c) => {
  const { name, parent_id } = c.req.valid('json');
  const id = generateId('dfd');
  const ts = now();
  await c.env.DB.prepare(
    `INSERT INTO document_folders (id, name, parent_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`
  ).bind(id, name, parent_id ?? null, ts, ts).run();
  return c.json({ id });
});

app.put('/folders/:id', zValidator('json', z.object({
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
  await c.env.DB.prepare(`UPDATE document_folders SET ${fields.join(', ')} WHERE id = ?`).bind(...values, id).run();
  return c.json({ ok: true });
});

// Xoá folder: tài liệu bên trong chuyển về gốc, folder con cascade
app.delete('/folders/:id', async (c) => {
  const id = c.req.param('id');
  await c.env.DB.prepare('UPDATE documents SET folder_id = NULL WHERE folder_id = ?').bind(id).run();
  await c.env.DB.prepare('DELETE FROM document_folders WHERE id = ?').bind(id).run();
  return c.json({ ok: true });
});

// Di chuyển tài liệu vào folder (hoặc về gốc với folder_id = null)
app.put('/:id/move', zValidator('json', z.object({
  folder_id: z.string().optional().nullable(),
})), async (c) => {
  const id = c.req.param('id');
  const { folder_id } = c.req.valid('json');
  await c.env.DB.prepare('UPDATE documents SET folder_id = ?, updated_at = ? WHERE id = ?')
    .bind(folder_id ?? null, now(), id).run();
  return c.json({ ok: true });
});

// ---------- Bước 1: xin presigned URL để upload thẳng lên R2 ----------
app.post('/presign', zValidator('json', z.object({
  filename: z.string().min(1),
  content_type: z.string().min(1),
  size: z.number().positive(),
})), async (c) => {
  const { filename, content_type, size } = c.req.valid('json');
  if (!DOC_MIME.has(content_type)) return c.json({ error: `Định dạng không hỗ trợ: ${content_type}` }, 400);
  if (size > MAX_SIZE) return c.json({ error: 'File quá lớn (tối đa 200MB)' }, 400);

  const r2 = getR2Client(c);
  if (!r2) return c.json({ error: 'R2 S3 credentials chưa cấu hình (xem hướng dẫn)' }, 500);

  const ext = filename.split('.').pop()?.toLowerCase() ?? 'bin';
  const safe = slugify(filename.replace(/\.[^.]+$/, '')) || 'tai-lieu';
  const d = new Date();
  const r2Key = `documents/${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${generateId('doc')}-${safe}.${ext}`;

  const signed = await r2.client.sign(
    new Request(`${r2.endpoint}/${r2.bucket}/${r2Key}`, {
      method: 'PUT',
      headers: { 'content-type': content_type },
    }),
    { aws: { signQuery: true } }
  );

  const publicUrl = c.env.R2_PUBLIC_URL ? `${c.env.R2_PUBLIC_URL}/${r2Key}` : null;
  return c.json({ upload_url: signed.url, r2_key: r2Key, public_url: publicUrl });
});

// ---------- Bước 2: sau khi upload xong, lưu metadata ----------
app.post('/', zValidator('json', z.object({
  title: z.string().min(1).max(255),
  filename: z.string().min(1).max(255),
  r2_key: z.string().min(1),
  public_url: z.string().optional().nullable(),
  size_bytes: z.number().optional().nullable(),
  mime_type: z.string().optional().nullable(),
  note: z.string().optional().nullable(),
  folder_id: z.string().optional().nullable(),
})), async (c) => {
  const data = c.req.valid('json');
  const user = c.get('user');
  const id = generateId('doc');
  const ts = now();

  await c.env.DB.prepare(
    `INSERT INTO documents (id, title, filename, r2_key, public_url, size_bytes, mime_type,
       note, folder_id, uploaded_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, data.title, data.filename, data.r2_key, data.public_url ?? null,
         data.size_bytes ?? null, data.mime_type ?? null,
         data.note ?? null, data.folder_id ?? null, user.id, ts, ts).run();

  return c.json({ id });
});

// ---------- Tải về: R2 ký URL GET tạm thời (kể cả bucket private) ----------
app.get('/:id/download', async (c) => {
  const id = c.req.param('id');
  const d = await c.env.DB.prepare('SELECT r2_key, public_url FROM documents WHERE id = ?')
    .bind(id).first<{ r2_key: string | null; public_url: string | null }>();
  if (!d) return c.json({ error: 'Not found' }, 404);

  if (d.r2_key) {
    const r2 = getR2Client(c);
    if (!r2) return c.json({ error: 'R2 chưa cấu hình' }, 500);
    const signed = await r2.client.sign(
      new Request(`${r2.endpoint}/${r2.bucket}/${d.r2_key}`, { method: 'GET' }),
      { aws: { signQuery: true } }
    );
    return c.json({ download_url: signed.url });
  }
  return c.json({ download_url: d.public_url });
});

// ---------- Delete ----------
app.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const d = await c.env.DB.prepare('SELECT r2_key FROM documents WHERE id = ?')
    .bind(id).first<{ r2_key: string | null }>();
  if (d?.r2_key) {
    try { await c.env.MEDIA.delete(d.r2_key); } catch {}
  }
  await c.env.DB.prepare('DELETE FROM documents WHERE id = ?').bind(id).run();
  return c.json({ ok: true });
});

export default app;
