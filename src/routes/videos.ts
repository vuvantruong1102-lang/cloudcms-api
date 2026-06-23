import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { AwsClient } from 'aws4fetch';
import type { AppEnv } from '../types';
import { requireAuth } from '../middleware/auth';
import { generateId, slugify, now } from '../lib/utils';

const app = new Hono<AppEnv>();
app.use('*', requireAuth);

const VIDEO_MIME = new Set(['video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska', 'video/x-msvideo']);
const MAX_SIZE = 2 * 1024 * 1024 * 1024; // 2 GB trần an toàn

// --- Drive helper (giữ tương thích kiểu cũ) ---
function extractDriveId(url: string): string | null {
  if (!url) return null;
  const m1 = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (m1) return m1[1] ?? null;
  const m2 = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (m2) return m2[1] ?? null;
  return null;
}

// --- R2 S3 client để ký presigned URL ---
// Cần env: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
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
  const folderId = c.req.query('folder'); // 'root' hoặc id; bỏ qua nếu đang search
  let where = '1=1';
  const params: any[] = [];
  if (search) {
    where += ' AND (title LIKE ? OR tags LIKE ?)'; params.push(`%${search}%`, `%${search}%`);
  } else if (folderId && folderId !== 'all') {
    if (folderId === 'root') where += ' AND folder_id IS NULL';
    else { where += ' AND folder_id = ?'; params.push(folderId); }
  }
  const rows = await c.env.DB.prepare(
    `SELECT * FROM videos WHERE ${where} ORDER BY created_at DESC`
  ).bind(...params).all();
  return c.json({ items: rows.results ?? [] });
});

// ---------- Folders ----------
app.get('/folders/list', async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT id, name, parent_id, created_at FROM video_folders ORDER BY name`
  ).all();
  return c.json({ items: rows.results ?? [] });
});

app.post('/folders', zValidator('json', z.object({
  name: z.string().min(1).max(120),
  parent_id: z.string().optional().nullable(),
})), async (c) => {
  const { name, parent_id } = c.req.valid('json');
  const id = generateId('vfd');
  const ts = now();
  await c.env.DB.prepare(
    `INSERT INTO video_folders (id, name, parent_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`
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
  await c.env.DB.prepare(`UPDATE video_folders SET ${fields.join(', ')} WHERE id = ?`).bind(...values, id).run();
  return c.json({ ok: true });
});

// Xoá folder: video bên trong chuyển về gốc (folder_id = NULL), folder con cascade
app.delete('/folders/:id', async (c) => {
  const id = c.req.param('id');
  await c.env.DB.prepare('UPDATE videos SET folder_id = NULL WHERE folder_id = ?').bind(id).run();
  await c.env.DB.prepare('DELETE FROM video_folders WHERE id = ?').bind(id).run();
  return c.json({ ok: true });
});

// Di chuyển video vào folder (hoặc về gốc với folder_id = null)
app.put('/:id/move', zValidator('json', z.object({
  folder_id: z.string().optional().nullable(),
})), async (c) => {
  const id = c.req.param('id');
  const { folder_id } = c.req.valid('json');
  await c.env.DB.prepare('UPDATE videos SET folder_id = ?, updated_at = ? WHERE id = ?')
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
  if (!VIDEO_MIME.has(content_type)) return c.json({ error: `Định dạng không hỗ trợ: ${content_type}` }, 400);
  if (size > MAX_SIZE) return c.json({ error: 'File quá lớn (tối đa 2GB)' }, 400);

  const r2 = getR2Client(c);
  if (!r2) return c.json({ error: 'R2 S3 credentials chưa cấu hình (xem hướng dẫn)' }, 500);

  const ext = filename.split('.').pop()?.toLowerCase() ?? 'mp4';
  const safe = slugify(filename.replace(/\.[^.]+$/, '')) || 'video';
  const d = new Date();
  const r2Key = `videos/${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${generateId('vid')}-${safe}.${ext}`;

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
  source: z.enum(['drive', 'r2']).optional(),
  drive_url: z.string().optional().nullable(),
  r2_key: z.string().optional().nullable(),
  public_url: z.string().optional().nullable(),
  size_bytes: z.number().optional().nullable(),
  mime_type: z.string().optional().nullable(),
  thumbnail: z.string().optional().nullable(),
  duration: z.number().optional().nullable(),
  note: z.string().optional().nullable(),
  tags: z.string().optional().nullable(),
  folder_id: z.string().optional().nullable(),
})), async (c) => {
  const data = c.req.valid('json');
  const user = c.get('user');
  const id = generateId('vid');
  const ts = now();
  const source = data.source ?? (data.r2_key ? 'r2' : 'drive');

  let driveUrl = data.drive_url ?? null;
  let driveId: string | null = null;
  if (source === 'drive') {
    if (!driveUrl) return c.json({ error: 'Thiếu link Drive' }, 400);
    driveId = extractDriveId(driveUrl);
  }
  const urlForOpen = source === 'r2' ? (data.public_url ?? '') : driveUrl;

  await c.env.DB.prepare(
    `INSERT INTO videos (id, title, source, drive_url, drive_file_id, r2_key, size_bytes, mime_type,
       thumbnail, duration, note, tags, folder_id, uploaded_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, data.title, source, urlForOpen, driveId, data.r2_key ?? null,
         data.size_bytes ?? null, data.mime_type ?? null,
         data.thumbnail ?? null, data.duration ?? null, data.note ?? null, data.tags ?? null,
         data.folder_id ?? null, user.id, ts, ts).run();

  return c.json({ id });
});

// ---------- Tải về: R2 ký URL GET tạm thời (kể cả bucket private) ----------
// Thêm response-content-disposition=attachment để trình duyệt (đặc biệt iOS Safari)
// buộc TẢI FILE thay vì phát video inline.
app.get('/:id/download', async (c) => {
  const id = c.req.param('id');
  const v = await c.env.DB.prepare('SELECT source, drive_url, r2_key, title, mime_type FROM videos WHERE id = ?')
    .bind(id).first<{ source: string; drive_url: string; r2_key: string | null; title: string | null; mime_type: string | null }>();
  if (!v) return c.json({ error: 'Not found' }, 404);

  if (v.source === 'r2' && v.r2_key) {
    const r2 = getR2Client(c);
    if (!r2) return c.json({ error: 'R2 chưa cấu hình' }, 500);

    // Tên file tải về: lấy title, làm sạch, gắn đuôi từ r2_key
    const ext = v.r2_key.split('.').pop()?.toLowerCase() || 'mp4';
    const base = (v.title || 'video').replace(/[\/\\?%*:|"<>]/g, '').trim() || 'video';
    const downloadName = base.toLowerCase().endsWith('.' + ext) ? base : `${base}.${ext}`;

    const url = new URL(`${r2.endpoint}/${r2.bucket}/${v.r2_key}`);
    // Ghi đè header phản hồi qua query (S3/R2 hỗ trợ) — phải có TRƯỚC khi ký
    url.searchParams.set('response-content-disposition', `attachment; filename="${encodeURIComponent(downloadName)}"`);
    if (v.mime_type) url.searchParams.set('response-content-type', v.mime_type);

    const signed = await r2.client.sign(
      new Request(url.toString(), { method: 'GET' }),
      { aws: { signQuery: true } }
    );
    return c.json({ download_url: signed.url, filename: downloadName });
  }
  return c.json({ download_url: v.drive_url });
});

// ---------- Delete ----------
app.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const v = await c.env.DB.prepare('SELECT source, r2_key FROM videos WHERE id = ?')
    .bind(id).first<{ source: string; r2_key: string | null }>();
  if (v?.source === 'r2' && v.r2_key) {
    try { await c.env.MEDIA.delete(v.r2_key); } catch {}
  }
  await c.env.DB.prepare('DELETE FROM videos WHERE id = ?').bind(id).run();
  return c.json({ ok: true });
});

export default app;
