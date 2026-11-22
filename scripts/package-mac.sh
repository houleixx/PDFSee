#!/bin/bash
set -euo pipefail

if [[ "$(uname -s)" != Darwin ]]; then
  echo '请在 macOS 上运行此脚本。' >&2
  exit 1
fi

cd "$(dirname "$0")/.."

case "${1:-$(uname -m)}" in
  arm64|--arm64) arch=arm64 ;;
  x86_64|x64|--x64) arch=x64 ;;
  universal|--universal) arch=universal ;;
  *) echo '用法：npm run package:mac -- [--arm64|--x64|--universal]' >&2; exit 2 ;;
esac
if [[ $# -gt 1 ]]; then
  echo '一次只能指定一种架构。' >&2
  exit 2
fi

# Mac 版可复用 PicSee 的 Developer ID 团队。
team_id=${PDFSEE_MAC_TEAM_ID:-3989F32QL4}
if [[ ! "$team_id" =~ ^[A-Z0-9]{10}$ ]]; then
  echo 'PDFSEE_MAC_TEAM_ID 必须是 10 位 Apple 团队 ID。' >&2
  exit 2
fi
identity=$(security find-identity -v -p codesigning |
  awk -v team="($team_id)" '/"Developer ID Application:/ && index($0, team "\"") && !found { print $2; found=1 }')
if [[ -z "$identity" ]]; then
  printf '钥匙串中没有团队 %s 的有效 Developer ID Application 签名身份。\n' "$team_id" >&2
  exit 1
fi

profile=${PDFSEE_NOTARY_PROFILE:-}
if [[ -n "$profile" ]]; then
  notary_args=(--keychain-profile "$profile")
elif [[ -n "${APPLE_ID:-}${APPLE_TEAM_ID:-}${APPLE_APP_PASSWORD:-}" ]]; then
  if [[ -z "${APPLE_ID:-}" || "${APPLE_TEAM_ID:-}" != "$team_id" || -z "${APPLE_APP_PASSWORD:-}" ]]; then
    echo '公证需要 APPLE_ID、APPLE_APP_PASSWORD 和与签名一致的 APPLE_TEAM_ID。' >&2
    exit 2
  fi
  notary_args=(--apple-id "$APPLE_ID" --team-id "$APPLE_TEAM_ID" --password "$APPLE_APP_PASSWORD")
fi

# 先验证 Apple 服务认证，避免完成耗时的签名打包后才发现凭据失效。
if [[ -n "${profile}${APPLE_ID:-}" ]]; then
  if ! xcrun notarytool history "${notary_args[@]}" >/dev/null; then
    echo 'Apple 公证凭据校验失败，请检查网络及公证账号配置。若返回 401，请核对 APPLE_ID、APPLE_TEAM_ID，并更新 APPLE_APP_PASSWORD 为该账号的 App 专用密码；使用钥匙串配置时请更新对应配置。' >&2
    exit 1
  fi
fi

output="$PWD/release"
mkdir -p "$output"
stage=$(mktemp -d "$output/.pdfsee-dmg.XXXXXX")
mount_point="$stage/mount"
mkdir "$mount_point"
mounted=0
cleanup() {
  if [[ "$mounted" == 1 ]] && ! hdiutil detach "$mount_point" >/dev/null; then
    printf '无法卸载磁盘映像，已保留临时目录 %s。\n' "$stage" >&2
    return 1
  fi
  rm -rf -- "$stage"
}
trap cleanup EXIT

version=$(node -p 'require("./package.json").version')
name="PDFSee-macos-$version"
if [[ "$arch" != universal ]]; then
  name="$name-$arch"
fi
dmg="$stage/$name.dmg"
# 公证提交最终签名的 DMG，由 Apple 同时检查其中的应用。
npm run package -- --mac dir "--$arch" --publish never \
  "--config.directories.output=$stage" \
  "--config.mac.identity=$team_id" --config.mac.notarize=false \
  --config.forceCodeSigning=true

app_path=$(find "$stage" -path '*/PDFSee.app' -prune -print)
[[ -d "$app_path" ]] || { echo '找不到打包后的 PDFSee.app。' >&2; exit 1; }
bash scripts/create-dmg.sh "$app_path" "$dmg"
requirement="anchor apple generic and certificate leaf[subject.OU] = \"$team_id\" and certificate leaf[field.1.2.840.113635.100.6.1.13] exists"
codesign --sign "$identity" --timestamp "$dmg"
codesign --verify --strict --test-requirement="=$requirement" "$dmg"
hdiutil verify "$dmg"
hdiutil attach "$dmg" -readonly -nobrowse -mountpoint "$mount_point" >/dev/null
mounted=1
codesign --verify --deep --strict --test-requirement="=$requirement" "$mount_point/PDFSee.app"
[[ "$(readlink "$mount_point/Applications")" == /Applications ]] || {
  echo 'DMG 中缺少有效的 Applications 安装链接。' >&2
  exit 1
}
bundle_icon=$(/usr/libexec/PlistBuddy -c "Print :CFBundleIconFile" "$mount_point/PDFSee.app/Contents/Info.plist")
cmp assets/PDFSee.icns "$mount_point/PDFSee.app/Contents/Resources/$bundle_icon"
hdiutil detach "$mount_point" >/dev/null
mounted=0

signed_dmg="$output/$name-signed.dmg"
mv -f "$dmg" "$signed_dmg"
if [[ -n "${profile}${APPLE_ID:-}" ]]; then
  xcrun notarytool submit "$signed_dmg" "${notary_args[@]}" --wait --timeout 30m
  xcrun stapler staple "$signed_dmg"
  xcrun stapler validate "$signed_dmg"
  codesign --verify --strict --test-requirement="=$requirement" "$signed_dmg"
  spctl --assess --type open --context context:primary-signature --verbose=4 "$signed_dmg"
  mv -f "$signed_dmg" "$output/$name.dmg"
  printf '已签名并公证：%s\n' "$output/$name.dmg"
else
  printf '已签名，等待 Apple 公证：%s\n' "$signed_dmg"
fi
