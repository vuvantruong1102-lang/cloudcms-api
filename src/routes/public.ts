import { Hono } from 'hono';
import type { AppEnv } from '../types';

const app = new Hono<AppEnv>();

// Lấy bài viết theo slug (cho website chính)
app.get('/posts/:slug', async (c) => {
  const slug = c.req.param('slug');
  const post = await c.env.DB.prepare(
    `SELECT p.*, u.name as author_name, u.avatar_url as author_avatar, c.name as category_name, c.slug as category_slug
     FROM posts p
     LEFT JOIN users u ON u.id = p.author_id
     LEFT JOIN categories c ON c.id = p.category_id
     WHERE p.slug = ? AND p.status = 'published'`
  )
    .bind(slug)
    .first();

  if (!post) return c.json({ error: 'Not found' }, 404);

  const tags = await c.env.DB.prepare(
    `SELECT t.id, t.name, t.slug FROM tags t
     JOIN post_tags pt ON pt.tag_id = t.id
     WHERE pt.post_id = ?`
  )
    .bind((post as any).id)
    .all();

  // Tăng view count async (không block response)
  c.executionCtx.waitUntil(
    c.env.DB.prepare('UPDATE posts SET view_count = view_count + 1 WHERE id = ?')
      .bind((post as any).id)
      .run()
  );

  return c.json({ ...post, tags: tags.results });
});

// List bài đã publish (cho trang blog)
app.get('/posts', async (c) => {
  const page = Math.max(1, parseInt(c.req.query('page') ?? '1'));
  const limit = Math.min(50, Math.max(1, parseInt(c.req.query('limit') ?? '12')));
  const offset = (page - 1) * limit;
  const category = c.req.query('category');

  let where = "status = 'published'";
  const params: any[] = [];
  if (category) {
    where += ' AND c.slug = ?';
    params.push(category);
  }

  const items = await c.env.DB.prepare(
    `SELECT p.id, p.slug, p.title, p.excerpt, p.og_image_url, p.published_at, p.reading_time,
            u.name as author_name, c.name as category_name, c.slug as category_slug
     FROM posts p
     LEFT JOIN users u ON u.id = p.author_id
     LEFT JOIN categories c ON c.id = p.category_id
     WHERE ${where}
     ORDER BY p.published_at DESC
     LIMIT ? OFFSET ?`
  )
    .bind(...params, limit, offset)
    .all();

  return c.json({ items: items.results, page, limit });
});

// Sitemap XML
app.get('/sitemap.xml', async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT slug, updated_at FROM posts
     WHERE status = 'published' AND robots_index = 1
     ORDER BY updated_at DESC LIMIT 5000`
  ).all<{ slug: string; updated_at: number }>();

  const urls = rows.results
    .map((r) => {
      const lastmod = new Date(r.updated_at).toISOString();
      return `  <url><loc>${c.env.SITE_URL}/blog/${r.slug}</loc><lastmod>${lastmod}</lastmod></url>`;
    })
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`;

  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
});

// RSS feed
app.get('/rss.xml', async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT slug, title, excerpt, published_at FROM posts
     WHERE status = 'published' ORDER BY published_at DESC LIMIT 20`
  ).all<{ slug: string; title: string; excerpt: string; published_at: number }>();

  const items = rows.results
    .map((r) => `
    <item>
      <title><![CDATA[${r.title}]]></title>
      <link>${c.env.SITE_URL}/blog/${r.slug}</link>
      <description><![CDATA[${r.excerpt ?? ''}]]></description>
      <pubDate>${new Date(r.published_at).toUTCString()}</pubDate>
      <guid>${c.env.SITE_URL}/blog/${r.slug}</guid>
    </item>`)
    .join('');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Blog</title>
    <link>${c.env.SITE_URL}</link>
    <description>Latest posts</description>
    ${items}
  </channel>
</rss>`;

  return new Response(xml, { headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' } });
});

export default app;
