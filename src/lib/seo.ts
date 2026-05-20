import { stripHtml, countWords } from './utils';

export type SeoCheck = {
  id: string;
  label: string;
  status: 'pass' | 'warn' | 'fail';
  message: string;
  weight: number; // 0-100
};

export type SeoAnalysis = {
  score: number; // 0-100
  checks: SeoCheck[];
  wordCount: number;
};

export type SeoInput = {
  title: string;
  metaTitle?: string | null;
  metaDescription?: string | null;
  focusKeyword?: string | null;
  contentHtml?: string | null;
  slug: string;
  ogImageUrl?: string | null;
  featuredImageAlt?: string | null;
};

function containsKeyword(text: string | null | undefined, keyword: string): boolean {
  if (!text || !keyword) return false;
  return text.toLowerCase().includes(keyword.toLowerCase());
}

export function analyzeSeo(input: SeoInput): SeoAnalysis {
  const checks: SeoCheck[] = [];
  const kw = input.focusKeyword?.trim() ?? '';
  const plainContent = input.contentHtml ? stripHtml(input.contentHtml) : '';
  const wordCount = countWords(input.contentHtml ?? '');

  // 1. Focus keyword được thiết lập
  checks.push({
    id: 'focus_keyword',
    label: 'Từ khóa chính',
    status: kw ? 'pass' : 'fail',
    message: kw ? `Đã đặt: "${kw}"` : 'Chưa thiết lập từ khóa chính',
    weight: 5,
  });

  // 2. Từ khóa trong tiêu đề
  if (kw) {
    checks.push({
      id: 'keyword_in_title',
      label: 'Từ khóa trong tiêu đề',
      status: containsKeyword(input.title, kw) ? 'pass' : 'fail',
      message: containsKeyword(input.title, kw)
        ? 'Tiêu đề chứa từ khóa chính'
        : 'Nên đưa từ khóa chính vào tiêu đề',
      weight: 15,
    });

    // 3. Từ khóa trong slug
    checks.push({
      id: 'keyword_in_slug',
      label: 'Từ khóa trong URL',
      status: containsKeyword(input.slug, kw.replace(/\s+/g, '-')) ? 'pass' : 'warn',
      message: containsKeyword(input.slug, kw.replace(/\s+/g, '-'))
        ? 'URL có chứa từ khóa'
        : 'Cân nhắc đưa từ khóa vào URL slug',
      weight: 8,
    });

    // 4. Từ khóa trong meta description
    checks.push({
      id: 'keyword_in_meta_desc',
      label: 'Từ khóa trong meta description',
      status: containsKeyword(input.metaDescription, kw) ? 'pass' : 'warn',
      message: containsKeyword(input.metaDescription, kw)
        ? 'Meta description có từ khóa'
        : 'Nên có từ khóa trong meta description',
      weight: 10,
    });

    // 5. Mật độ từ khóa trong nội dung
    const kwCount = plainContent.toLowerCase().split(kw.toLowerCase()).length - 1;
    const density = wordCount > 0 ? (kwCount / wordCount) * 100 : 0;
    let densityStatus: 'pass' | 'warn' | 'fail' = 'fail';
    let densityMsg = `Mật độ ${density.toFixed(1)}% - quá thấp`;
    if (density >= 0.5 && density <= 3) {
      densityStatus = 'pass';
      densityMsg = `Mật độ từ khóa tốt (${density.toFixed(1)}%)`;
    } else if (density > 3) {
      densityStatus = 'warn';
      densityMsg = `Mật độ ${density.toFixed(1)}% - có thể quá cao (spam)`;
    }
    checks.push({
      id: 'keyword_density',
      label: 'Mật độ từ khóa',
      status: densityStatus,
      message: densityMsg,
      weight: 10,
    });
  }

  // 6. Độ dài tiêu đề (50-60 ký tự lý tưởng)
  const titleLen = (input.metaTitle ?? input.title).length;
  let titleStatus: 'pass' | 'warn' | 'fail' = 'warn';
  let titleMsg = '';
  if (titleLen >= 30 && titleLen <= 60) {
    titleStatus = 'pass';
    titleMsg = `Tiêu đề ${titleLen} ký tự - tốt`;
  } else if (titleLen < 30) {
    titleStatus = 'warn';
    titleMsg = `Tiêu đề ${titleLen} ký tự - hơi ngắn`;
  } else {
    titleStatus = 'warn';
    titleMsg = `Tiêu đề ${titleLen} ký tự - có thể bị cắt trên Google`;
  }
  checks.push({
    id: 'title_length',
    label: 'Độ dài tiêu đề',
    status: titleStatus,
    message: titleMsg,
    weight: 10,
  });

  // 7. Meta description (120-160 ký tự)
  const metaLen = input.metaDescription?.length ?? 0;
  let metaStatus: 'pass' | 'warn' | 'fail' = 'fail';
  let metaMsg = 'Chưa có meta description';
  if (metaLen >= 120 && metaLen <= 160) {
    metaStatus = 'pass';
    metaMsg = `Meta description ${metaLen} ký tự - lý tưởng`;
  } else if (metaLen > 0 && metaLen < 120) {
    metaStatus = 'warn';
    metaMsg = `Meta description ${metaLen} ký tự - nên dài hơn`;
  } else if (metaLen > 160) {
    metaStatus = 'warn';
    metaMsg = `Meta description ${metaLen} ký tự - sẽ bị cắt`;
  }
  checks.push({
    id: 'meta_description',
    label: 'Meta description',
    status: metaStatus,
    message: metaMsg,
    weight: 12,
  });

  // 8. Độ dài nội dung
  let lenStatus: 'pass' | 'warn' | 'fail' = 'warn';
  let lenMsg = `${wordCount} từ`;
  if (wordCount >= 600) {
    lenStatus = 'pass';
    lenMsg = `${wordCount} từ - tốt cho SEO`;
  } else if (wordCount >= 300) {
    lenStatus = 'warn';
    lenMsg = `${wordCount} từ - nên dài hơn 600 từ`;
  } else {
    lenStatus = 'fail';
    lenMsg = `${wordCount} từ - quá ngắn`;
  }
  checks.push({
    id: 'content_length',
    label: 'Độ dài nội dung',
    status: lenStatus,
    message: lenMsg,
    weight: 10,
  });

  // 9. Có ảnh đại diện
  checks.push({
    id: 'featured_image',
    label: 'OG image',
    status: input.ogImageUrl ? 'pass' : 'warn',
    message: input.ogImageUrl ? 'Đã có OG image' : 'Nên thêm ảnh OG để chia sẻ MXH đẹp hơn',
    weight: 8,
  });

  // 10. Alt text cho ảnh đại diện
  if (input.ogImageUrl) {
    checks.push({
      id: 'image_alt',
      label: 'Alt text ảnh',
      status: input.featuredImageAlt ? 'pass' : 'warn',
      message: input.featuredImageAlt ? 'Có alt text' : 'Thiếu alt text mô tả ảnh',
      weight: 5,
    });
  }

  // 11. Heading H2 trong nội dung
  if (input.contentHtml) {
    const hasH2 = /<h2[^>]*>/i.test(input.contentHtml);
    checks.push({
      id: 'has_h2',
      label: 'Cấu trúc heading',
      status: hasH2 ? 'pass' : 'warn',
      message: hasH2 ? 'Có heading H2 phân chia nội dung' : 'Nên thêm heading H2 để chia phần',
      weight: 7,
    });
  }

  // Tính điểm
  const totalWeight = checks.reduce((s, c) => s + c.weight, 0);
  const earnedWeight = checks.reduce((s, c) => {
    if (c.status === 'pass') return s + c.weight;
    if (c.status === 'warn') return s + c.weight * 0.5;
    return s;
  }, 0);

  const score = totalWeight > 0 ? Math.round((earnedWeight / totalWeight) * 100) : 0;

  return { score, checks, wordCount };
}
