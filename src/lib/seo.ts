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

// ============================================================
// Helpers: chuẩn hóa text tiếng Việt để so sánh keyword
// ============================================================

/**
 * Chuẩn hóa text:
 * - Lowercase
 * - Bỏ dấu tiếng Việt (á → a)
 * - Collapse whitespace
 */
function normalize(text: string | null | undefined): string {
  if (!text) return '';
  return text
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Check text có chứa keyword không (tolerant tiếng Việt):
 * - So sánh sau khi đã bỏ dấu
 * - Không phân biệt khoảng trắng thừa
 *
 * Ví dụ:
 *   containsKeyword("Quà tặng công nghệ", "Doanh Nghiệp") → false (không có)
 *   containsKeyword("Quà tặng cho doanh nghiệp", "doanh nghiệp") → true
 *   containsKeyword("Quà tặng cho doanh nghiệp", "Doanh Nghiệp") → true (case insensitive)
 *   containsKeyword("Quà tặng cho doanh-nghiệp", "doanh nghiệp") → true (slug có dash)
 */
function containsKeyword(text: string | null | undefined, keyword: string): boolean {
  if (!text || !keyword) return false;
  const normText = normalize(text).replace(/[-_]/g, ' ');
  const normKw = normalize(keyword);
  return normText.includes(normKw);
}

/**
 * Đếm số lần keyword xuất hiện trong text (tolerant tiếng Việt)
 */
function countKeyword(text: string, keyword: string): number {
  if (!text || !keyword) return 0;
  const normText = normalize(text);
  const normKw = normalize(keyword);
  if (!normKw) return 0;
  // split-based count để tính đúng số lần xuất hiện
  return normText.split(normKw).length - 1;
}

// ============================================================
// Main analyzer
// ============================================================

export function analyzeSeo(input: SeoInput): SeoAnalysis {
  const checks: SeoCheck[] = [];
  const kw = input.focusKeyword?.trim() ?? '';
  const plainContent = input.contentHtml ? stripHtml(input.contentHtml) : '';
  const wordCount = countWords(input.contentHtml ?? '');

  // Combine title + heading 1 (nhiều editor lưu tiêu đề trong content_html dưới dạng H1)
  // → check ở cả title và content_html cho chắc
  const titleForCheck = input.title || '';

  // ============================================================
  // 1. Focus keyword được thiết lập
  // ============================================================
  checks.push({
    id: 'focus_keyword',
    label: 'Từ khóa chính',
    status: kw ? 'pass' : 'fail',
    message: kw ? `Đã đặt: "${kw}"` : 'Chưa thiết lập từ khóa chính',
    weight: 5,
  });

  // Các check phụ thuộc keyword (#2-#5)
  if (kw) {
    // 2. Từ khóa trong tiêu đề
    const inTitle = containsKeyword(titleForCheck, kw);
    checks.push({
      id: 'keyword_in_title',
      label: 'Từ khóa trong tiêu đề',
      status: inTitle ? 'pass' : 'fail',
      message: inTitle
        ? 'Tiêu đề chứa từ khóa chính'
        : 'Nên đưa từ khóa chính vào tiêu đề',
      weight: 15,
    });

    // 3. Từ khóa trong slug
    // Slug đã chuẩn hóa thành dạng `tu-khoa-chinh`, ta so sánh sau khi normalize cả 2
    const inSlug = containsKeyword(input.slug, kw);
    checks.push({
      id: 'keyword_in_slug',
      label: 'Từ khóa trong URL',
      status: inSlug ? 'pass' : 'warn',
      message: inSlug
        ? 'URL có chứa từ khóa'
        : 'Cân nhắc đưa từ khóa vào URL slug',
      weight: 8,
    });

    // 4. Từ khóa trong meta description
    const inMeta = containsKeyword(input.metaDescription, kw);
    checks.push({
      id: 'keyword_in_meta_desc',
      label: 'Từ khóa trong meta description',
      status: inMeta ? 'pass' : 'warn',
      message: inMeta
        ? 'Meta description có từ khóa'
        : 'Nên có từ khóa trong meta description',
      weight: 10,
    });

    // 5. Mật độ từ khóa trong nội dung
    const kwCount = countKeyword(plainContent, kw);
    const density = wordCount > 0 ? (kwCount / wordCount) * 100 : 0;
    let densityStatus: 'pass' | 'warn' | 'fail' = 'fail';
    let densityMsg = `Mật độ ${density.toFixed(1)}% (${kwCount} lần) - quá thấp`;
    if (density >= 0.5 && density <= 3) {
      densityStatus = 'pass';
      densityMsg = `Mật độ từ khóa tốt ${density.toFixed(1)}% (${kwCount} lần)`;
    } else if (density > 3) {
      densityStatus = 'warn';
      densityMsg = `Mật độ ${density.toFixed(1)}% (${kwCount} lần) - có thể quá cao (spam)`;
    } else if (density > 0) {
      densityStatus = 'warn';
      densityMsg = `Mật độ ${density.toFixed(1)}% (${kwCount} lần) - hơi thấp`;
    }
    checks.push({
      id: 'keyword_density',
      label: 'Mật độ từ khóa',
      status: densityStatus,
      message: densityMsg,
      weight: 10,
    });
  }

  // ============================================================
  // 6. Độ dài tiêu đề (50-60 ký tự lý tưởng)
  // BUG FIX: dùng `||` thay vì `??` để fallback khi metaTitle = ""
  // ============================================================
  const effectiveTitle = (input.metaTitle && input.metaTitle.trim()) || input.title || '';
  const titleLen = effectiveTitle.length;
  let titleStatus: 'pass' | 'warn' | 'fail' = 'warn';
  let titleMsg = '';
  if (titleLen >= 30 && titleLen <= 60) {
    titleStatus = 'pass';
    titleMsg = `Tiêu đề ${titleLen} ký tự - tốt`;
  } else if (titleLen === 0) {
    titleStatus = 'fail';
    titleMsg = 'Chưa có tiêu đề';
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

  // ============================================================
  // 7. Meta description (120-160 ký tự)
  // ============================================================
  const metaLen = input.metaDescription?.length ?? 0;
  let metaStatus: 'pass' | 'warn' | 'fail' = 'fail';
  let metaMsg = 'Chưa có meta description';
  if (metaLen >= 120 && metaLen <= 160) {
    metaStatus = 'pass';
    metaMsg = `Meta description ${metaLen} ký tự - lý tưởng`;
  } else if (metaLen > 0 && metaLen < 120) {
    metaStatus = 'warn';
    metaMsg = `Meta description ${metaLen} ký tự - nên dài hơn (120-160)`;
  } else if (metaLen > 160) {
    metaStatus = 'warn';
    metaMsg = `Meta description ${metaLen} ký tự - sẽ bị cắt (>160)`;
  }
  checks.push({
    id: 'meta_description',
    label: 'Meta description',
    status: metaStatus,
    message: metaMsg,
    weight: 12,
  });

  // ============================================================
  // 8. Độ dài nội dung
  // ============================================================
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
    lenMsg = `${wordCount} từ - quá ngắn (nên ≥300)`;
  }
  checks.push({
    id: 'content_length',
    label: 'Độ dài nội dung',
    status: lenStatus,
    message: lenMsg,
    weight: 10,
  });

  // ============================================================
  // 9. Có ảnh đại diện
  // ============================================================
  checks.push({
    id: 'featured_image',
    label: 'OG image',
    status: input.ogImageUrl ? 'pass' : 'warn',
    message: input.ogImageUrl ? 'Đã có OG image' : 'Nên thêm ảnh OG để chia sẻ MXH đẹp hơn',
    weight: 8,
  });

  // ============================================================
  // 10. Alt text cho ảnh đại diện
  // ============================================================
  if (input.ogImageUrl) {
    checks.push({
      id: 'image_alt',
      label: 'Alt text ảnh',
      status: input.featuredImageAlt ? 'pass' : 'warn',
      message: input.featuredImageAlt ? 'Có alt text' : 'Thiếu alt text mô tả ảnh',
      weight: 5,
    });
  }

  // ============================================================
  // 11. Heading H2 trong nội dung
  // ============================================================
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

  // ============================================================
  // 12. NEW - Mở đầu chứa keyword (first 100 words)
  // ============================================================
  if (kw && plainContent) {
    const first100 = plainContent.split(/\s+/).slice(0, 100).join(' ');
    const inIntro = containsKeyword(first100, kw);
    checks.push({
      id: 'keyword_in_intro',
      label: 'Từ khóa trong đoạn mở đầu',
      status: inIntro ? 'pass' : 'warn',
      message: inIntro
        ? 'Đoạn mở đầu có từ khóa chính'
        : 'Nên đưa từ khóa vào 100 từ đầu',
      weight: 6,
    });
  }

  // ============================================================
  // Tính điểm
  // ============================================================
  const totalWeight = checks.reduce((s, c) => s + c.weight, 0);
  const earnedWeight = checks.reduce((s, c) => {
    if (c.status === 'pass') return s + c.weight;
    if (c.status === 'warn') return s + c.weight * 0.5;
    return s;
  }, 0);

  const score = totalWeight > 0 ? Math.round((earnedWeight / totalWeight) * 100) : 0;

  return { score, checks, wordCount };
}
