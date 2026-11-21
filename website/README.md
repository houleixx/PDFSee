# PDFSee 网站

这是 PDFSee 项目的官方网站，部署在 Cloudflare Pages。

## 部署

网站目录 `website/` 直接作为 Cloudflare Pages 的构建输出目录。无需构建步骤。

## 目录结构

```
website/
  index.html                    # 中文首页
  en/
    index.html                  # 英文首页
  404.html                      # 404 页面（双语）
  assets/
    styles-f4a7b2c9.css         # 样式表
    language-d8e2f1a3.js        # 语言检测脚本
    brand-mark-c3d4e5f6.png     # 品牌图标（导航和页脚）
    favicon-a1b2c3d4.png        # 96x96 图标
    social-preview-e5f6g7h8.jpg # 社交分享预览图（1200x1000）
    hero-app-preview-b2c3d4e5.webp  # Hero 区域展示图（1200x1000）
    feature-read-pdf-c4d5e6f7.webp  # 功能1：阅读 PDF（1080x720）
    feature-merge-pdf-d5e6f7g8.webp   # 功能2：合并 PDF（1080x720）
    feature-split-pdf-e6f7g8h9.webp   # 功能3：拆分 PDF（1080x720）
    feature-extract-pages-f7g8h9i0.webp # 功能4：提取页面（1080x720）
    feature-convert-pdf-g8h9i0j1.webp   # 功能5：转换 PDF（1080x720）
  robots.txt
  sitemap.xml
  _headers                      # Cloudflare 缓存头
```

## 需要的图片

以下图片需要创建：

1. **brand-mark-c3d4e5f6.png** - 品牌图标，28x28 显示，建议使用 PDFSee 应用图标
2. **favicon-a1b2c3d4.png** - 96x96 网站图标
3. **social-preview-e5f6g7h8.jpg** - 社交分享预览，1200x1000，展示应用界面
4. **hero-app-preview-b2c3d4e5.webp** - Hero 展示图，1200x1000，应用界面截图或插画
5. **feature-read-pdf-c4d5e6f7.webp** - 阅读 PDF 功能截图，1080x720
6. **feature-merge-pdf-d5e6f7g8.webp** - 合并 PDF 功能截图，1080x720
7. **feature-split-pdf-e6f7g8h9.webp** - 拆分 PDF 功能截图，1080x720
8. **feature-extract-pages-f7g8h9i0.webp** - 提取页面功能截图，1080x720
9. **feature-convert-pdf-g8h9i0j1.webp** - 转换 PDF 功能截图，1080x720

图片文件名包含内容哈希，更新图片时需要同时更新文件名和 HTML 中的引用。

## 本地预览

```bash
cd website
python3 -m http.server 8080
# 访问 http://localhost:8080
```

## 语言切换

网站支持中文和英文。语言检测顺序：
1. URL 参数 `?lang=zh-CN` 或 `?lang=en`
2. localStorage 保存的偏好
3. 浏览器语言设置

中文用户默认访问 `/`，英文用户自动跳转到 `/en/`。
