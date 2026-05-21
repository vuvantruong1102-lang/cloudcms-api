# CỤM B — Backend cho cloudcms-api

## File trong gói này (5 file)

```
cum-b-backend/
└── src/
    ├── index.ts                          ← REPLACE
    ├── types.ts                          ← REPLACE
    ├── lib/
    │   └── indexnow.ts                   ← NEW
    └── routes/
        ├── ai-image.ts                   ← NEW
        └── posts.ts                      ← REPLACE
```

## Cách upload

1. Giải nén `cum-b-backend.zip` được folder `cum-b-backend/`
2. Chọn **TẤT CẢ thứ bên trong**: chỉ có folder `src/`
3. Vào https://github.com/vuvantruong1102-lang/cloudcms-api (hoặc tên repo backend bạn)
4. **Add file** → **Upload files** → kéo folder `src/` vào
5. GitHub sẽ hiện 5 file thay đổi:
   - `src/index.ts` (đè)
   - `src/types.ts` (đè)
   - `src/routes/posts.ts` (đè)
   - `src/lib/indexnow.ts` (mới)
   - `src/routes/ai-image.ts` (mới)
6. Commit: `Add AI image generation + IndexNow webhook`
7. Commit changes

## Set environment variables (BẮT BUỘC)

Sau khi commit code, vào **Cloudflare → Workers & Pages → cloudcms-api → Settings → Variables and Secrets**:

| Variable | Type | Value |
|---|---|---|
| `INDEXNOW_KEY` | **Secret** | Chuỗi random 32-128 ký tự (chỉ a-z, 0-9, dash) |
| `SITE_URL` | Text | `https://yokool.vn` |

(Nếu `SITE_URL` đã có rồi thì không cần thêm lại.)

### Tạo INDEXNOW_KEY

Có 2 cách:

**Cách 1**: Vào https://www.bing.com/indexnow → click **Generate API key** → copy chuỗi

**Cách 2**: Mở browser console (F12) chạy:
```js
crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '')
```
→ copy chuỗi 64 ký tự

### Tạo file verify trên yokool.vn

Sau khi có INDEXNOW_KEY (giả sử là `a1b2c3d4e5f6789012345678abcdef12`):

1. Vào repo **Yokoolwebnew**
2. Tạo file mới ở **ROOT** repo (cùng cấp với `index.html`):
   - Tên file: `a1b2c3d4e5f6789012345678abcdef12.txt` (tên file = chính chuỗi KEY)
   - Nội dung file: chuỗi KEY đó (1 dòng, không thêm gì)
3. Commit → đợi Pages deploy
4. **Verify**: mở `https://yokool.vn/a1b2c3d4e5f6789012345678abcdef12.txt` phải hiện ra chính chuỗi key

Nếu chưa có file verify → IndexNow không hoạt động (trả 422 Unprocessable Entity).

## Test

### Test IndexNow

1. Vào CMS admin → tạo bài mới → publish
2. Vào Cloudflare → Workers → cloudcms-api → tab **Logs** (Real-time)
3. Sẽ thấy log:
   ```
   [IndexNow] Pinged 3 URLs
   ```
4. Sau ~5 phút search `site:yokool.vn` trên Google → bài mới có hiện

### Test AI image API

Mở DevTools trong CMS admin → tab **Console** chạy (thay JWT):
```js
fetch('https://cloudcms-api.vuvantruong-1102.workers.dev/api/ai-image/generate', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ' + localStorage.cms_token,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    prompt: 'futuristic tech style with neon red accents, blog header image',
    model: 'flux',
    width: 1200,
    height: 630,
  }),
}).then(r => r.json()).then(d => { console.log(d); window.open(d.url); });
```

Đợi ~10 giây → mở URL ảnh ở tab mới → thấy ảnh AI đã sinh + lưu trong R2.

## Lưu ý

- **AI image dùng Workers AI Free Tier**: 10,000 neurons/ngày, đủ ~250 lần sinh ảnh FLUX
- **Generate-OG endpoint** tự update post: `og_image_url` + `featured_image_id`. Sau đó post hiển thị ảnh OG mới trên frontend.
- **IndexNow ping bất đồng bộ**: gọi `executionCtx.waitUntil` nên không làm chậm response API
