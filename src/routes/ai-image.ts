// AI Image Generation routes
// - POST /generate: sinh ảnh từ prompt, lưu vào R2 + media record
// - POST /generate-og: sinh OG image 1200x630 cho post, auto-update post
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { AppEnv } from '../types';
import { requireAuth } from '../middleware/auth';
import { generateId, slugify, now } from '../lib/utils';

const app = new Hono<AppEnv>();
app.use('*', requireAuth);

// Sinh ảnh từ prompt
app.post(
  '/generate',
  zValidator(
    'json',
    z.object({
      prompt: z.string().min(5).max(500),
      model: z.enum(['flux', 'sdxl']).default('flux'),
      width: z.number().min(256).max(1280).default(1024),
      height: z.number().min(256).max(1280).default(1024),
      saveToLibrary: z.boolean().default(true),
    })
  ),
  async (c) => {
    const { prompt, model, width, height, saveToLibrary } = c.req.valid('json');
    const user = c.get('user');

    const modelId =
      model === 'flux'
        ? '@cf/black-forest-labs/flux-1-schnell'
        : '@cf/stabilityai/stable-diffusion-xl-base-1.0';

    try {
      const result: any = await c.env.AI.run(modelId as any, {
        prompt,
        width,
        height,
        num_steps: model === 'flux' ? 4 : 20,
      });

      // FLUX trả base64 trong result.image, SDXL trả ReadableStream
      let imageBytes: Uint8Array;
      if (result.image) {
        // FLUX: base64 string
        const binary = atob(result.image);
        imageBytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) imageBytes[i] = binary.charCodeAt(i);
      } else if (result instanceof ReadableStream) {
        // SDXL: PNG stream
        const reader = result.getReader();
        const chunks: Uint8Array[] = [];
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
        }
        const total = chunks.reduce((s, ch) => s + ch.length, 0);
        imageBytes = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) {
          imageBytes.set(chunk, offset);
          offset += chunk.length;
        }
      } else {
        return c.json({ error: 'AI model trả về định dạng không hỗ trợ' }, 500);
      }

      if (!saveToLibrary) {
        // Trả base64 luôn, không lưu R2
        const base64 = btoa(String.fromCharCode(...imageBytes));
        return c.json({ image_base64: base64, mime_type: 'image/png' });
      }

      // Upload vào R2 + lưu media record
      const id = generateId('med');
      const safeName = slugify(prompt.slice(0, 50)) || 'ai-generated';
      const date = new Date();
      const yyyy = date.getFullYear();
      const mm = String(date.getMonth() + 1).padStart(2, '0');
      const r2Key = `${yyyy}/${mm}/${id}-${safeName}.png`;

      await c.env.MEDIA.put(r2Key, imageBytes, {
        httpMetadata: { contentType: 'image/png' },
        customMetadata: {
          uploadedBy: user.id,
          generatedBy: 'ai',
          model: modelId,
          prompt: prompt.slice(0, 200),
        },
      });

      const publicUrl = `${c.env.R2_PUBLIC_URL}/${r2Key}`;
      const altText = prompt.slice(0, 200);

      await c.env.DB.prepare(
        `INSERT INTO media (id, r2_key, filename, mime_type, size_bytes, width, height, alt_text, caption, url, uploaded_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(
          id,
          r2Key,
          `${safeName}.png`,
          'image/png',
          imageBytes.length,
          width,
          height,
          altText,
          `AI generated: ${prompt.slice(0, 100)}`,
          publicUrl,
          user.id,
          now()
        )
        .run();

      return c.json({
        id,
        url: publicUrl,
        r2_key: r2Key,
        filename: `${safeName}.png`,
        mime_type: 'image/png',
        size_bytes: imageBytes.length,
        width,
        height,
        alt_text: altText,
        model: modelId,
      });
    } catch (err: any) {
      console.error('AI image generation failed:', err);
      return c.json(
        { error: 'Lỗi sinh ảnh: ' + (err.message || 'unknown') },
        500
      );
    }
  }
);

// Sinh OG image cho 1 bài viết (1200x630), tự động gán vào post
app.post(
  '/generate-og',
  zValidator(
    'json',
    z.object({
      postId: z.string(),
      title: z.string().min(1),
      focusKeyword: z.string().optional(),
      style: z.enum(['photo', 'illustration', 'minimalist', 'tech']).default('tech'),
    })
  ),
  async (c) => {
    const { postId, title, focusKeyword, style } = c.req.valid('json');
    const user = c.get('user');

    const stylePrompts: Record<string, string> = {
      photo: 'professional photography, natural lighting, depth of field, ultra detailed',
      illustration: 'modern flat illustration, vibrant colors, clean design',
      minimalist: 'minimalist design, lots of white space, simple shapes, modern',
      tech: 'futuristic tech style, neon accents, dark gradient background, modern design, sleek',
    };

    const prompt = `${title}${focusKeyword ? `, focus: ${focusKeyword}` : ''}, ${stylePrompts[style]}, blog header image, 1200x630, no text`;

    try {
      const result: any = await c.env.AI.run(
        '@cf/black-forest-labs/flux-1-schnell' as any,
        { prompt, width: 1200, height: 630, num_steps: 4 }
      );

      if (!result.image) {
        return c.json({ error: 'AI generation failed' }, 500);
      }

      const binary = atob(result.image);
      const imageBytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) imageBytes[i] = binary.charCodeAt(i);

      const id = generateId('med');
      const date = new Date();
      const yyyy = date.getFullYear();
      const mm = String(date.getMonth() + 1).padStart(2, '0');
      const r2Key = `${yyyy}/${mm}/og-${postId}-${id}.png`;

      await c.env.MEDIA.put(r2Key, imageBytes, {
        httpMetadata: { contentType: 'image/png' },
        customMetadata: {
          uploadedBy: user.id,
          generatedBy: 'ai-og',
          postId,
        },
      });

      const publicUrl = `${c.env.R2_PUBLIC_URL}/${r2Key}`;

      await c.env.DB.prepare(
        `INSERT INTO media (id, r2_key, filename, mime_type, size_bytes, width, height, alt_text, caption, url, uploaded_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(
          id,
          r2Key,
          `og-${postId}.png`,
          'image/png',
          imageBytes.length,
          1200,
          630,
          title,
          `OG image for: ${title}`,
          publicUrl,
          user.id,
          now()
        )
        .run();

      // Auto-update post với og_image_url + featured_image_id
      await c.env.DB.prepare(
        'UPDATE posts SET og_image_url = ?, featured_image_id = ?, updated_at = ? WHERE id = ?'
      )
        .bind(publicUrl, id, now(), postId)
        .run();

      return c.json({ id, url: publicUrl, width: 1200, height: 630 });
    } catch (err: any) {
      console.error('OG generation failed:', err);
      return c.json(
        { error: 'Lỗi sinh OG image: ' + (err.message || 'unknown') },
        500
      );
    }
  }
);

export default app;
