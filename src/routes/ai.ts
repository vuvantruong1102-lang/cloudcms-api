import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { AppEnv } from '../types';
import { requireAuth } from '../middleware/auth';
import { stripHtml } from '../lib/utils';

const app = new Hono<AppEnv>();
app.use('*', requireAuth);

// Helper: gọi Workers AI hoặc OpenAI tùy config
async function runAi(c: any, prompt: string, system?: string): Promise<string> {
  // Ưu tiên OpenAI nếu có key
  if (c.env.OPENAI_API_KEY) {
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${c.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          ...(system ? [{ role: 'system', content: system }] : []),
          { role: 'user', content: prompt },
        ],
        temperature: 0.7,
      }),
    });
    const data: any = await resp.json();
    return data.choices?.[0]?.message?.content?.trim() ?? '';
  }

  // Fallback: Workers AI (Llama 3.1)
  const result: any = await c.env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
    messages: [
      ...(system ? [{ role: 'system', content: system }] : []),
      { role: 'user', content: prompt },
    ],
  });
  return (result.response ?? '').trim();
}

// Gợi ý meta description từ nội dung bài
app.post('/suggest-meta', zValidator('json', z.object({
  title: z.string(),
  content: z.string(),
  focusKeyword: z.string().optional(),
})), async (c) => {
  const { title, content, focusKeyword } = c.req.valid('json');
  const plain = stripHtml(content).slice(0, 2000);

  const system = `Bạn là chuyên gia SEO. Viết meta description tiếng Việt cho bài viết.
Yêu cầu:
- Độ dài 140-160 ký tự
- Hấp dẫn, có CTA nhẹ
- Tự nhiên, không nhồi nhét từ khóa
${focusKeyword ? `- BẮT BUỘC chứa từ khóa: "${focusKeyword}"` : ''}
Chỉ trả về MỘT câu meta description, không thêm chú thích.`;

  const prompt = `Tiêu đề: ${title}\n\nNội dung:\n${plain}`;
  const result = await runAi(c, prompt, system);
  return c.json({ suggestion: result });
});

// Gợi ý từ khóa SEO
app.post('/suggest-keywords', zValidator('json', z.object({
  title: z.string(),
  content: z.string(),
})), async (c) => {
  const { title, content } = c.req.valid('json');
  const plain = stripHtml(content).slice(0, 2000);

  const system = `Bạn là chuyên gia SEO tiếng Việt. Đề xuất 5-8 từ khóa phù hợp cho bài viết.
Chỉ trả về danh sách từ khóa, mỗi từ trên một dòng. Không thêm số thứ tự, không giải thích.`;

  const prompt = `Tiêu đề: ${title}\n\nNội dung:\n${plain}`;
  const result = await runAi(c, prompt, system);
  const keywords = result.split('\n').map((s) => s.replace(/^[-*\d.)\s]+/, '').trim()).filter(Boolean);
  return c.json({ keywords });
});

// Gợi ý cải thiện tiêu đề (SEO-friendly)
app.post('/suggest-titles', zValidator('json', z.object({
  title: z.string(),
  focusKeyword: z.string().optional(),
})), async (c) => {
  const { title, focusKeyword } = c.req.valid('json');

  const system = `Bạn là chuyên gia content tiếng Việt. Đề xuất 3 phiên bản tiêu đề SEO tốt hơn cho bài viết.
Yêu cầu:
- Độ dài 40-60 ký tự
- Hấp dẫn click
${focusKeyword ? `- BẮT BUỘC chứa từ khóa: "${focusKeyword}"` : ''}
Trả về 3 tiêu đề, mỗi tiêu đề trên một dòng. Không số thứ tự, không giải thích.`;

  const result = await runAi(c, `Tiêu đề hiện tại: ${title}`, system);
  const titles = result.split('\n').map((s) => s.replace(/^[-*\d.)\s]+/, '').trim()).filter(Boolean).slice(0, 3);
  return c.json({ titles });
});

// Viết tiếp đoạn văn / paragraph
app.post('/continue-writing', zValidator('json', z.object({
  context: z.string().min(10),
  instruction: z.string().optional(),
})), async (c) => {
  const { context, instruction } = c.req.valid('json');
  const system = `Bạn là cây bút viết blog tiếng Việt giỏi. Viết tiếp đoạn văn dựa trên ngữ cảnh được cho.
Yêu cầu:
- Văn phong tự nhiên, dễ đọc
- 1-3 đoạn ngắn, mỗi đoạn 2-4 câu
- Liền mạch với đoạn trước
${instruction ? `- Hướng dẫn thêm: ${instruction}` : ''}
Chỉ trả về văn bản, không HTML, không chú thích.`;

  const result = await runAi(c, `Đoạn trước đó:\n${stripHtml(context)}\n\nViết tiếp:`, system);
  return c.json({ text: result });
});

// Tóm tắt nội dung thành excerpt
app.post('/summarize', zValidator('json', z.object({
  content: z.string(),
  maxWords: z.number().min(20).max(100).default(40),
})), async (c) => {
  const { content, maxWords } = c.req.valid('json');
  const plain = stripHtml(content).slice(0, 4000);

  const system = `Tóm tắt nội dung bài viết tiếng Việt trong khoảng ${maxWords} từ, văn phong cuốn hút.
Chỉ trả về đoạn tóm tắt, không giải thích.`;

  const result = await runAi(c, plain, system);
  return c.json({ summary: result });
});

// Gợi ý caption mạng xã hội theo nền tảng (Content Manager)
const PLATFORM_GUIDE: Record<string, string> = {
  facebook: 'Văn phong thân thiện, emoji vừa phải, 3-6 dòng, kết bằng CTA + 3-5 hashtag.',
  tiktok: 'Cực ngắn 1-2 dòng bắt trend, nhiều hashtag (#fyp #xuhuong), giọng trẻ trung.',
  youtube: 'Mô tả video: 1 câu hook, vài dòng mô tả, có link mua hàng, 3-5 hashtag cuối.',
  zalo: 'Lịch sự, rõ ràng, hướng chốt đơn qua inbox/hotline, ít hashtag.',
};

app.post('/caption', zValidator('json', z.object({
  platform: z.enum(['youtube', 'facebook', 'zalo', 'tiktok']),
  topic: z.string().optional(),
  productInfo: z.string().optional(),
})), async (c) => {
  const { platform, topic, productInfo } = c.req.valid('json');
  if (!topic && !productInfo) return c.json({ error: 'Cần chủ đề hoặc thông tin sản phẩm' }, 400);

  const guide = PLATFORM_GUIDE[platform] ?? 'Viết caption mạng xã hội tiếng Việt.';
  const system = `Bạn là chuyên gia content marketing cho Yokool — thương hiệu phụ kiện công nghệ năng lượng di động Made in Vietnam. Viết caption tiếng Việt tự nhiên, đúng nền tảng. ${guide} Chỉ trả về nội dung caption, không giải thích.`;
  const prompt = `Nền tảng: ${platform}\nChủ đề: ${topic ?? '(không có)'}\nThông tin sản phẩm: ${productInfo ?? '(không có)'}`;

  const result = await runAi(c, prompt, system);
  return c.json({ caption: result });
});

export default app;
