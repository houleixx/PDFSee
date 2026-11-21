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

- 在 macOS 执行 `npm run package:mac`，生成当前架构的 Developer ID 签名 DMG。可传入 `-- --arm64`、`-- --x64` 或 `-- --universal` 指定架构。
- 在 Windows 执行 `npm run package -- --win`，生成 NSIS 安装程序。

打包产物输出到 `release/`。macOS 脚本默认使用钥匙串中与 PicSee 相同团队的 Developer ID Application 身份。使用其他团队时，可设置 `PDFSEE_MAC_TEAM_ID`。

公开分发时，使用同团队的 Apple 公证凭据。已有钥匙串配置时可运行 `PDFSEE_NOTARY_PROFILE=你的配置名 npm run package:mac`。也支持 PicSee 使用的 `APPLE_ID`、`APPLE_TEAM_ID` 和 `APPLE_APP_PASSWORD` 环境变量。公证完成后，脚本会装订票据并验证 Gatekeeper 状态。仅签名的产物以 `-signed.dmg` 结尾，已公证的产物以架构名结尾。

## GitHub 自动生成 DMG

发布工作流位于 `.github/workflows/release.yml`。在仓库 Settings → Secrets and variables → Actions 配置与 PicSee 同名的六项 Secrets。

| Secret | 内容 |
| --- | --- |
| `MACOS_CERTIFICATE_BASE64` | 包含私钥的 Developer ID Application P12 文件的 Base64 |
| `MACOS_CERTIFICATE_PASSWORD` | P12 导出密码 |
| `KEYCHAIN_PASSWORD` | runner 临时钥匙串密码 |
| `APPLE_ID` | Apple 公证账号邮箱 |
| `APPLE_TEAM_ID` | 证书所属团队 ID |
| `APPLE_APP_PASSWORD` | Apple 账号的 App 专用密码 |

推送与 `package.json` 版本一致的标签（例如 `v0.1.0`）会自动构建 Universal DMG，支持 Apple Silicon 和 Intel，并上传至对应 GitHub Release。也可以在 Actions 中手动运行工作流，选择 Universal、arm64 或 x64，通过该次运行的 Artifacts 下载产物。

工作流依次执行测试、导入证书、签名应用与 DMG、Apple 公证、装订票据、Gatekeeper 校验和上传。全部验证通过后上传版本化 DMG、固定下载名 `PDFSee.dmg` 和 `SHA256SUMS.txt`。公证失败会使工作流失败，签名材料在任务结束时清理。

## 项目结构

- `src/` 包含阅读器界面、搜索和工具交互。
- `desktop/` 包含 Electron 主进程、文件操作和文档处理任务。
- `assets/` 包含应用图标原图和打包资源。
- `test/` 包含 PDF 页面处理测试。

## 许可证

PDFSee 按 [MIT 许可证](LICENSE) 免费开源。第三方依赖继续适用各自的许可证。

阅读器基于 [PDF.js](https://mozilla.github.io/pdf.js/)，页面和图片处理使用 [pdf-lib](https://pdf-lib.js.org/)。页面工具的功能设计参考了 [PDFsam Basic](https://pdfsam.org/pdfsam-basic/) 和 [Stirling PDF](https://docs.stirlingpdf.com/Tools/Guides/Page-Operations/)。
