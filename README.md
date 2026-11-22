# PDFSee

PDFSee 是一个免费开源的桌面 PDF 阅读器和页面工具，面向 macOS 和 Windows。应用使用 Electron、TypeScript 和 PDF.js，打开和处理文件时无需注册，文档保留在本机。

## 功能

- **阅读 PDF**。选择或拖入本地文件，查看缩略图和目录，搜索和复制文字，跳页、缩放、旋转视图，或将当前页导出为 PNG。支持输入 PDF 打开密码。
- **合并 PDF**。添加多份 PDF，调整文件顺序后导出。
- **拆分 PDF**。设置每份页数和可选的页码范围，输出到所选目录下的新文件夹。
- **提取和整理页面**。输入 `1-3, 5, 8-6` 可以选择正序和倒序范围。输入 `3,1,2` 可以重排页面。省略页码可删除相应页面，也可以旋转导出的页面。
- **图片转 PDF**。将 JPG、JPEG、PNG 按指定顺序转换，支持按图片尺寸、A4 或 Letter 生成各页。
- **PDF 转图片**。选择全部页面，或输入 `2`、`1-3, 5` 等页码，每页导出一张 PNG。结果保存在所选目录下的新文件夹中，文件名保留原页码；支持查看进度和取消转换，取消或失败时清理本次未完成的图片。也可直接使用正在阅读的 PDF；加密文档需先在阅读器中解锁。
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

在 macOS 的「PDFSee」菜单或 Windows 的「帮助」菜单选择「检查更新…」。应用会查询 GitHub Releases 的正式版本，发现更高版本时可下载安装。macOS 会优先选用通用包，已签名且有写入权限的安装可在校验后自动替换并重启，否则可在打开的磁盘映像中手动安装。Windows 会打开 NSIS 安装程序。

## 测试与打包

```sh
npm test
```

测试覆盖页码解析、导出页顺序、旋转、合并、图片转 PDF，以及 PDF 转图片的页码选择、文件保存与取消清理。

- 在 macOS 执行 `npm run package:mac`，生成当前架构的 Developer ID 签名 DMG。打包需要 Python 3、Swift 和 macOS 磁盘映像工具。脚本使用 dmgbuild 创建与 PicSee 一致的 Finder 布局和 Retina 背景。可传入 `-- --arm64`、`-- --x64` 或 `-- --universal` 指定架构。
- 在 Windows 执行 `npm run package:win`，生成 x64 的 NSIS 安装程序 `PDFSee-windows-版本号.exe`。

打包产物输出到 `release/`。macOS 脚本默认使用钥匙串中与 PicSee 相同团队的 Developer ID Application 身份。使用其他团队时，可设置 `PDFSEE_MAC_TEAM_ID`。

公开分发时，使用同团队的 Apple 公证凭据。已有钥匙串配置时可运行 `PDFSEE_NOTARY_PROFILE=你的配置名 npm run package:mac`。也支持 PicSee 使用的 `APPLE_ID`、`APPLE_TEAM_ID` 和 `APPLE_APP_PASSWORD` 环境变量。公证完成后，脚本会装订票据并验证 Gatekeeper 状态。通用版安装包命名为 `PDFSee-macos-版本号.dmg`，同时支持 Apple Silicon 和 Intel；单架构版保留 `-arm64` 或 `-x64` 后缀。仅签名、尚未公证的产物额外带有 `-signed` 后缀。

## 项目结构

- `src/` 包含阅读器界面、搜索和工具交互。
- `desktop/` 包含 Electron 主进程、文件操作和文档处理任务。
- `assets/` 包含应用图标原图和打包资源。
- `test/` 包含 PDF 页面处理测试。

## 许可证

PDFSee 按 [MIT 许可证](LICENSE) 免费开源。第三方依赖继续适用各自的许可证。

阅读器基于 [PDF.js](https://mozilla.github.io/pdf.js/)，页面和图片处理使用 [pdf-lib](https://pdf-lib.js.org/)。页面工具的功能设计参考了 [PDFsam Basic](https://pdfsam.org/pdfsam-basic/) 和 [Stirling PDF](https://docs.stirlingpdf.com/Tools/Guides/Page-Operations/)。
