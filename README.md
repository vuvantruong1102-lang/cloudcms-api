# CỤM A — Editor cho cloudcms-admin

## File trong gói này (5 file)

```
cum-a-editor/
├── package.json                          ← REPLACE
└── src/
    ├── styles.css                        ← REPLACE
    ├── components/
    │   └── ArticleEditor.tsx             ← REPLACE
    └── lib/
        ├── ResizableImage.tsx            ← NEW
        └── CalloutExtension.ts           ← NEW
```

## Cách upload (drag-drop, giữ structure)

1. Giải nén `cum-a-editor.zip` được folder `cum-a-editor/`
2. Mở folder, **chọn TẤT CẢ thứ bên trong** (Ctrl+A): `package.json` + folder `src/`
3. Vào https://github.com/vuvantruong1102-lang/cloudcms-admin
4. **Add file** → **Upload files**
5. **Kéo cả 2 thứ vừa chọn** thả vào ô upload
6. GitHub sẽ hiện danh sách:
   - `package.json` (đè file cũ)
   - `src/styles.css` (đè file cũ)
   - `src/components/ArticleEditor.tsx` (đè file cũ)
   - `src/lib/ResizableImage.tsx` (file mới)
   - `src/lib/CalloutExtension.ts` (file mới)
7. Commit message: `Editor v2: drag-drop, image resize, callouts, YouTube, table`
8. **Commit changes**

## Sau khi commit

Cloudflare Pages auto build. Đợi 2-3 phút → vào https://cloudcms-admin.pages.dev

### Nếu build FAIL
- Vào Cloudflare Pages → cloudcms-admin → Deployments → click deployment lỗi
- Tab **Build log** → copy đoạn error cuối → gửi mình

### Nếu build OK
1. Login vào admin
2. Tạo bài mới hoặc edit bài có sẵn
3. Test các tính năng:

| Tính năng | Cách test |
|---|---|
| Drag-drop ảnh | Kéo ảnh từ máy tính thả vào editor |
| Paste ảnh | Copy ảnh ở Pinterest/Photoshop → Ctrl+V trong editor |
| Resize ảnh | Click ảnh → kéo handle xanh 2 bên, hoặc nhập px vào ô width |
| Align ảnh | Click ảnh → toolbar nổi → căn trái/giữa/phải |
| Callout | Chọn đoạn văn → click icon Info → chọn loại box |
| YouTube | Click icon YouTube → paste URL `https://youtube.com/watch?v=...` |
| Table | Click icon Table → bảng 3×3 |

## Lưu ý

- **Lần build đầu tiên có thể lâu hơn (~5 phút)** vì cần npm install 5 packages mới
- Editor mới tương thích ngược: bài cũ vẫn đọc/sửa được bình thường
- Ảnh resize tạo ra `<figure data-resizable-image>` thay vì `<img>` trần — đẹp hơn cho frontend
