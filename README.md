# PDFSee

PDFSee 是一个免费开源的桌面 PDF 阅读器和页面工具，面向 macOS 和 Windows。应用使用 Electron、TypeScript 和 PDF.js，打开和处理文件时无需注册，文档保留在本机。

## 功能

- **阅读 PDF**。选择或拖入本地文件，查看缩略图和目录，搜索和复制文字，跳页、缩放、旋转视图，或将当前页导出为 PNG。支持输入 PDF 打开密码。
- **合并 PDF**。添加多份 PDF，调整文件顺序后导出。
- **拆分 PDF**。设置每份页数和可选的页码范围，输出到所选目录下的新文件夹。
- **提取和整理页面**。输入 `1-3, 5, 8-6` 可以选择正序和倒序范围。输入 `3,1,2` 可以重排页面。省略页码可删除相应页面，也可以旋转导出的页面。
- **图片转 PDF**。将 JPG、JPEG、PNG 按指定顺序转换，支持按图片尺寸、A4 或 Letter 生成各页。
- **文档转 PDF**。支持 Word、Excel、PowerPoint、OpenDocument、RTF 和 TXT。转换需要本机安装 [LibreOffice](https://www.libreoffice.org/)，排版效果取决于 LibreOffice 和本机字体。

页面工具导出新文件，使用未加密的源 PDF。复制页面时，文档级书签和交互表单可能丢失，数字签名可能失效。扫描版 PDF 需要原有的 OCR 文本层才能搜索和复制文字。

## 从源码运行

需要 Node.js 22.12 或更高版本及 npm。首次安装需要下载 npm 依赖和 Electron 运行时。

```sh
npm install
npm start
```

LibreOffice 安装在常见位置时，PDFSee 会自动查找。也可以将它加入 `PATH`，或配置 `PDFSEE_SOFFICE` 指向实际可执行文件。

安装后，可在系统的「打开方式」里选择 PDFSee 作为默认 PDF 阅读器。macOS 上点击窗口的红色关闭按钮或按 `⌘W` 会退出应用，按 `⌘⇧W` 可单独关闭当前文档。

## 测试与打包

```sh
npm test
```

测试覆盖页码解析、导出页顺序、旋转、合并和图片转 PDF。

- 在 macOS 执行 `npm run package -- --mac`，生成 DMG。
- 在 Windows 执行 `npm run package -- --win`，生成 NSIS 安装程序。

打包产物输出到 `release/`。公开分发时，可通过 electron-builder 配置代码签名和 macOS 公证。

## 项目结构

- `src/` 包含阅读器界面、搜索和工具交互。
- `desktop/` 包含 Electron 主进程、文件操作和文档处理任务。
- `assets/` 包含应用图标原图和打包资源。
- `test/` 包含 PDF 页面处理测试。

## 许可证

PDFSee 按 [MIT 许可证](LICENSE) 免费开源。第三方依赖继续适用各自的许可证。

阅读器基于 [PDF.js](https://mozilla.github.io/pdf.js/)，页面和图片处理使用 [pdf-lib](https://pdf-lib.js.org/)。页面工具的功能设计参考了 [PDFsam Basic](https://pdfsam.org/pdfsam-basic/) 和 [Stirling PDF](https://docs.stirlingpdf.com/Tools/Guides/Page-Operations/)。
