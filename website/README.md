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
    styles-ae6c64a0.css         # 样式表
    language-d8e2f1a3.js        # 语言检测脚本
    brand-mark-27f00275.png     # 品牌图标（导航和页脚）
    favicon-b047b4a1.png        # 96x96 图标
    social-preview-459ce210.jpg # 社交分享预览图（1200x630）
    hero-app-preview-cd9a6f14.webp  # Hero 区域展示图（1200x1006）
    feature-read-pdf-ad1da149.webp  # 功能1：阅读 PDF（1080x720）
    feature-merge-pdf-e79c04a5.webp   # 功能2：合并 PDF（1080x729）
    feature-split-pdf-6cd6f516.webp   # 功能3：拆分 PDF（1080x900）
    feature-extract-pages-a70b2f69.webp # 功能4：提取页面（1080x777）
    feature-export-pdf-cea3aea1.webp   # 功能5：从 PDF 导出（1080x720）
    feature-convert-pdf-585df8f7.webp   # 功能6：生成 PDF（1080x729）
  robots.txt
  sitemap.xml
  _headers                      # Cloudflare 缓存头
```

## 产品截图

首屏和功能图来自 PDFSee 的实际界面，使用专为网站生成的样本文档。社交分享图使用应用图标和阅读器截图。更新图片或样式时，请更换文件名中的内容哈希，并同步更新中英文首页的引用，避免 CDN 继续提供旧资源。

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
