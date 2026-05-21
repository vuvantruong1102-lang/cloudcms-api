import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import type { AppEnv } from './types';

import authRoutes from './routes/auth';
import postsRoutes from './routes/posts';
import mediaRoutes from './routes/media';
import categoriesRoutes from './routes/categories';
import aiRoutes from './routes/ai';
import aiImageRoutes from './routes/ai-image';
import publicRoutes from './routes/public';

const app = new Hono<AppEnv>();

app.use('*', logger());
app.use(
  '*',
  cors({
    origin: (origin) => origin, // tạm thời cho phép mọi origin; production nên whitelist
    credentials: true,
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    exposeHeaders: ['Content-Length'],
  })
);

app.get('/', (c) => c.json({ name: 'CloudCMS API', version: '0.2.0' }));

// Public API (đọc bài viết cho website chính)
app.route('/api/public', publicRoutes);

// Admin API (yêu cầu auth)
app.route('/api/auth', authRoutes);
app.route('/api/posts', postsRoutes);
app.route('/api/media', mediaRoutes);
app.route('/api/categories', categoriesRoutes);
app.route('/api/ai', aiRoutes);
app.route('/api/ai-image', aiImageRoutes);

app.onError((err, c) => {
  console.error('Error:', err);
  return c.json({ error: err.message || 'Internal Server Error' }, 500);
});

app.notFound((c) => c.json({ error: 'Not Found' }, 404));

export default app;
