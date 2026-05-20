import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { AppEnv, Post } from '../types';
import { requireAuth } from '../middleware/auth';
import { generateId, slugify, now, countWords, readingTimeMinutes } from '../lib/utils';
import { analyzeSeo } from '../lib/seo';

const app = new Hono<AppEnv>();

app.use('*', requireAuth);

const postInputSchema = z.object({
  title: z.string().min(1).max(255),
  slug: z.string().optional(),
  excerpt: z.string().optional().nullable(),
  content_html: z.string().optional().nullable(),
  content_json: z.string().optional().nullable(),
  meta_title: z.string().optional().nullable(),
  meta_description: z.string().max(300).optional().nullable(),
  meta_keywords: z.string().optional().nullable(),
  focus_keyword: z.string().optional().nullable(),
  canonical_url: z.string().url().optional().nullable().or(z.literal('')),
  og_title: z.string().optional().nullable(),
  og_description: z.string().optional().nullable(),
  og_image_url: z.string().optional().nullable(),
  og_type: z.string().optional(),
  twitter_card: z.string().optional(),
  schema_type: z.string().optional(),
  schema_json: z.string().optional().nullable(),
  featured_image_id: z.string().optional().nullable(),
  featured_image_alt: z.string().optional().nullable(),
  status: z.enum(['draft', 'published', 'scheduled', 'archived']).optional(),
  published_at: z.number().optional().nullable(),
  scheduled_at: z.number().optional().nullable(),
  robots_index: z.number().min(0).max(1).optional(),
  robots_follow: z.number().min(0).max(1).optional(),
  category_id: z.string().optional().nullable(),
  tag_ids: z.array(z.string()).optional(),
});

// List bài viết với filter & pagination
app.get('/', async (c) => {
  const status = c.req.query('status');
  const search = c.req.query('q');
  const page = Math.max(1, parseInt(c.req.query('page') ?? '1'));
  const limit = Math.min(50, Math.max(1, parseInt(c.req.query('limit') ?? '20')));
  const offset = (page - 1) * limit;

  let where = '1=1';
  const params: any[] = [];
  if (status) {
    where += ' AND status = ?';
    params.push(status);
  }
  if (search) {
    where += ' AND (title LIKE ? OR excerpt LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }

  const items = await c.env.DB.prepare(
    `SELECT p.*, u.name as author_name, c.name as category_name
     FROM posts p
     LEFT JOIN users u ON u.id = p.author_id
     LEFT JOIN categories c ON c.id = p.category_id
     WHERE ${where}
     ORDER BY p.updated_at DESC
     LIMIT ? OFFSET ?`
  )
    .bind(...params, limit, offset)
    .all();

  const total = await c.env.DB.prepare(
    `SELECT COUNT(*) as cnt FROM posts WHERE ${where}`
  )
    .bind(...params)
    .first<{ cnt: number }>();

  return c.json({
    items: items.results,
    total: total?.cnt ?? 0,
    page,
    limit,
  });
});

// Get một bài viết
app.get('/:id', async (c) => {
  const id = c.req.param('id');
  const post = await c.env.DB.prepare(
    `SELECT p.*, u.name as author_name
     FROM posts p
     LEFT JOIN users u ON u.id = p.author_id
     WHERE p.id = ?`
  )
    .bind(id)
    .first();

  if (!post) return c.json({ error: 'Không tìm thấy bài viết' }, 404);

  // Lấy tags
  const tags = await c.env.DB.prepare(
    `SELECT t.id, t.name, t.slug
     FROM tags t
     JOIN post_tags pt ON pt.tag_id = t.id
     WHERE pt.post_id = ?`
  )
    .bind(id)
    .all();

  return c.json({ ...post, tags: tags.results });
});

// Đảm bảo slug unique - thêm số đuôi nếu trùng
async function ensureUniqueSlug(db: D1Database, baseSlug: string, excludeId?: string): Promise<string> {
  let slug = baseSlug;
  let suffix = 1;
  while (true) {
    const existing = await db
      .prepare('SELECT id FROM posts WHERE slug = ? AND id != ?')
      .bind(slug, excludeId ?? '')
      .first();
    if (!existing) return slug;
    suffix++;
    slug = `${baseSlug}-${suffix}`;
  }
}

// Create bài viết
app.post('/', zValidator('json', postInputSchema), async (c) => {
  const data = c.req.valid('json');
  const user = c.get('user');

  const baseSlug = data.slug?.trim() || slugify(data.title);
  const slug = await ensureUniqueSlug(c.env.DB, baseSlug);
  const id = generateId('post');
  const ts = now();
  const wordCount = data.content_html ? countWords(data.content_html) : 0;
  const reading = readingTimeMinutes(wordCount);

  // SEO score
  const seo = analyzeSeo({
    title: data.title,
    metaTitle: data.meta_title,
    metaDescription: data.meta_description,
    focusKeyword: data.focus_keyword,
    contentHtml: data.content_html,
    slug,
    ogImageUrl: data.og_image_url,
    featuredImageAlt: data.featured_image_alt,
  });

  await c.env.DB.prepare(
    `INSERT INTO posts (
      id, slug, title, excerpt, content_html, content_json,
      meta_title, meta_description, meta_keywords, focus_keyword, canonical_url,
      og_title, og_description, og_image_url, og_type, twitter_card,
      schema_type, schema_json, featured_image_id, featured_image_alt,
      status, published_at, scheduled_at, robots_index, robots_follow,
      author_id, category_id, word_count, reading_time, seo_score,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id, slug, data.title, data.excerpt ?? null,
      data.content_html ?? null, data.content_json ?? null,
      data.meta_title ?? null, data.meta_description ?? null,
      data.meta_keywords ?? null, data.focus_keyword ?? null,
      data.canonical_url || null,
      data.og_title ?? null, data.og_description ?? null,
      data.og_image_url ?? null, data.og_type ?? 'article',
      data.twitter_card ?? 'summary_large_image',
      data.schema_type ?? 'Article', data.schema_json ?? null,
      data.featured_image_id ?? null, data.featured_image_alt ?? null,
      data.status ?? 'draft',
      data.status === 'published' ? (data.published_at ?? ts) : data.published_at ?? null,
      data.scheduled_at ?? null,
      data.robots_index ?? 1, data.robots_follow ?? 1,
      user.id, data.category_id ?? null,
      wordCount, reading, seo.score,
      ts, ts
    )
    .run();

  // Sync tags
  if (data.tag_ids?.length) {
    const stmts = data.tag_ids.map((tagId) =>
      c.env.DB.prepare('INSERT OR IGNORE INTO post_tags (post_id, tag_id) VALUES (?, ?)').bind(id, tagId)
    );
    await c.env.DB.batch(stmts);
  }

  return c.json({ id, slug, seo_score: seo.score });
});

// Update bài viết
app.put('/:id', zValidator('json', postInputSchema.partial()), async (c) => {
  const id = c.req.param('id');
  const data = c.req.valid('json');
  const user = c.get('user');

  const existing = await c.env.DB.prepare('SELECT * FROM posts WHERE id = ?').bind(id).first<Post>();
  if (!existing) return c.json({ error: 'Không tìm thấy bài viết' }, 404);

  // Lưu revision của bản cũ trước khi update
  if (data.content_html !== undefined && data.content_html !== existing.content_html) {
    await c.env.DB.prepare(
      `INSERT INTO post_revisions (id, post_id, title, content_html, content_json, saved_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        generateId('rev'), id, existing.title,
        existing.content_html, existing.content_json,
        user.id, now()
      )
      .run();
  }

  // Tính lại slug nếu thay đổi
  let newSlug = existing.slug;
  if (data.slug && data.slug !== existing.slug) {
    newSlug = await ensureUniqueSlug(c.env.DB, slugify(data.slug), id);
  } else if (data.title && data.title !== existing.title && !data.slug) {
    // Không tự đổi slug khi đổi title trừ khi user yêu cầu
  }

  // Tính lại word count & seo score
  const newContent = data.content_html ?? existing.content_html;
  const wordCount = newContent ? countWords(newContent) : 0;
  const reading = readingTimeMinutes(wordCount);
  const seo = analyzeSeo({
    title: data.title ?? existing.title,
    metaTitle: data.meta_title ?? existing.meta_title,
    metaDescription: data.meta_description ?? existing.meta_description,
    focusKeyword: data.focus_keyword ?? existing.focus_keyword,
    contentHtml: newContent,
    slug: newSlug,
    ogImageUrl: data.og_image_url ?? existing.og_image_url,
    featuredImageAlt: data.featured_image_alt ?? existing.featured_image_alt,
  });

  // Build dynamic UPDATE
  const updateFields: string[] = [];
  const updateValues: any[] = [];
  const fieldMap: Record<string, any> = {
    slug: newSlug,
    title: data.title,
    excerpt: data.excerpt,
    content_html: data.content_html,
    content_json: data.content_json,
    meta_title: data.meta_title,
    meta_description: data.meta_description,
    meta_keywords: data.meta_keywords,
    focus_keyword: data.focus_keyword,
    canonical_url: data.canonical_url || null,
    og_title: data.og_title,
    og_description: data.og_description,
    og_image_url: data.og_image_url,
    og_type: data.og_type,
    twitter_card: data.twitter_card,
    schema_type: data.schema_type,
    schema_json: data.schema_json,
    featured_image_id: data.featured_image_id,
    featured_image_alt: data.featured_image_alt,
    status: data.status,
    scheduled_at: data.scheduled_at,
    robots_index: data.robots_index,
    robots_follow: data.robots_follow,
    category_id: data.category_id,
  };

  for (const [k, v] of Object.entries(fieldMap)) {
    if (v !== undefined) {
      updateFields.push(`${k} = ?`);
      updateValues.push(v);
    }
  }

  // Khi chuyển sang published lần đầu, set published_at
  if (data.status === 'published' && existing.status !== 'published') {
    updateFields.push('published_at = ?');
    updateValues.push(data.published_at ?? now());
  }

  updateFields.push('word_count = ?', 'reading_time = ?', 'seo_score = ?', 'updated_at = ?');
  updateValues.push(wordCount, reading, seo.score, now());

  await c.env.DB.prepare(`UPDATE posts SET ${updateFields.join(', ')} WHERE id = ?`)
    .bind(...updateValues, id)
    .run();

  // Sync tags nếu được provided
  if (data.tag_ids) {
    await c.env.DB.prepare('DELETE FROM post_tags WHERE post_id = ?').bind(id).run();
    if (data.tag_ids.length) {
      const stmts = data.tag_ids.map((tagId) =>
        c.env.DB.prepare('INSERT OR IGNORE INTO post_tags (post_id, tag_id) VALUES (?, ?)').bind(id, tagId)
      );
      await c.env.DB.batch(stmts);
    }
  }

  return c.json({ id, slug: newSlug, seo_score: seo.score });
});

// Delete (soft delete = archive, hoặc hard delete)
app.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const hard = c.req.query('hard') === '1';

  if (hard) {
    await c.env.DB.prepare('DELETE FROM posts WHERE id = ?').bind(id).run();
  } else {
    await c.env.DB.prepare('UPDATE posts SET status = ?, updated_at = ? WHERE id = ?')
      .bind('archived', now(), id)
      .run();
  }

  return c.json({ ok: true });
});

// Phân tích SEO realtime (không lưu DB)
app.post('/analyze-seo', zValidator('json', z.object({
  title: z.string(),
  metaTitle: z.string().optional().nullable(),
  metaDescription: z.string().optional().nullable(),
  focusKeyword: z.string().optional().nullable(),
  contentHtml: z.string().optional().nullable(),
  slug: z.string(),
  ogImageUrl: z.string().optional().nullable(),
  featuredImageAlt: z.string().optional().nullable(),
})), (c) => {
  const result = analyzeSeo(c.req.valid('json'));
  return c.json(result);
});

// List revisions
app.get('/:id/revisions', async (c) => {
  const id = c.req.param('id');
  const rows = await c.env.DB.prepare(
    `SELECT r.id, r.title, r.created_at, u.name as saved_by_name
     FROM post_revisions r
     LEFT JOIN users u ON u.id = r.saved_by
     WHERE r.post_id = ?
     ORDER BY r.created_at DESC
     LIMIT 20`
  )
    .bind(id)
    .all();
  return c.json(rows.results);
});

// Restore revision
app.post('/:id/revisions/:revId/restore', async (c) => {
  const id = c.req.param('id');
  const revId = c.req.param('revId');

  const rev = await c.env.DB.prepare(
    'SELECT title, content_html, content_json FROM post_revisions WHERE id = ? AND post_id = ?'
  )
    .bind(revId, id)
    .first<{ title: string; content_html: string; content_json: string }>();

  if (!rev) return c.json({ error: 'Revision not found' }, 404);

  await c.env.DB.prepare(
    'UPDATE posts SET title = ?, content_html = ?, content_json = ?, updated_at = ? WHERE id = ?'
  )
    .bind(rev.title, rev.content_html, rev.content_json, now(), id)
    .run();

  return c.json({ ok: true });
});

export default app;
