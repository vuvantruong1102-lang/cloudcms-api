import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { AppEnv } from '../types';
import { hashPassword, verifyPassword, signJwt } from '../lib/auth';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { generateId, now } from '../lib/utils';

const app = new Hono<AppEnv>();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

app.post('/login', zValidator('json', loginSchema), async (c) => {
  const { email, password } = c.req.valid('json');

  const user = await c.env.DB.prepare(
    'SELECT id, email, password_hash, name, role FROM users WHERE email = ?'
  )
    .bind(email)
    .first<{ id: string; email: string; password_hash: string; name: string; role: 'admin' | 'editor' }>();

  if (!user) return c.json({ error: 'Email hoặc mật khẩu không đúng' }, 401);

  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) return c.json({ error: 'Email hoặc mật khẩu không đúng' }, 401);

  const token = await signJwt(
    {
      sub: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
      iss: c.env.JWT_ISSUER,
    },
    c.env.JWT_SECRET
  );

  return c.json({
    token,
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
  });
});

// Tạo user mới - chỉ admin được phép, hoặc dùng để seed user đầu tiên
const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1),
  role: z.enum(['admin', 'editor']).default('editor'),
});

// Endpoint setup ban đầu (chỉ chạy được khi chưa có user nào)
app.post('/setup', zValidator('json', registerSchema), async (c) => {
  const existing = await c.env.DB.prepare('SELECT COUNT(*) as cnt FROM users').first<{ cnt: number }>();
  if (existing && existing.cnt > 0) {
    return c.json({ error: 'Hệ thống đã có user, vui lòng dùng /register' }, 400);
  }

  const data = c.req.valid('json');
  const id = generateId('usr');
  const hash = await hashPassword(data.password);
  const ts = now();

  await c.env.DB.prepare(
    `INSERT INTO users (id, email, password_hash, name, role, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'admin', ?, ?)`
  )
    .bind(id, data.email, hash, data.name, ts, ts)
    .run();

  return c.json({ ok: true, message: 'Tài khoản admin đầu tiên đã được tạo' });
});

app.post('/register', requireAuth, requireAdmin, zValidator('json', registerSchema), async (c) => {
  const data = c.req.valid('json');
  const id = generateId('usr');
  const hash = await hashPassword(data.password);
  const ts = now();

  try {
    await c.env.DB.prepare(
      `INSERT INTO users (id, email, password_hash, name, role, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(id, data.email, hash, data.name, data.role, ts, ts)
      .run();
  } catch (e: any) {
    if (e.message?.includes('UNIQUE')) return c.json({ error: 'Email đã tồn tại' }, 409);
    throw e;
  }

  return c.json({ id, email: data.email, name: data.name, role: data.role });
});

app.get('/me', requireAuth, (c) => {
  return c.json(c.get('user'));
});

export default app;
