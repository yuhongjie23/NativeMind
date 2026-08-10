# 打包便携版：cargo build --release + vec0.dll → portable/ 目录 → NativeMind-便携版.zip
#
# 用法：右键「使用 PowerShell 运行」，或在本目录执行：
#   powershell -ExecutionPolicy Bypass -File build-portable.ps1
#
# 产物：NativeMind-便携版.zip —— 目标机解压后：
#   1. 双击运行 setup_ollama.bat（装 Ollama + 拉模型）
#   2. 双击 nativemind.exe 启动
#
# 注意：首次 release 编译较慢（10-30 分钟）；需要 cargo 网络（拉依赖）。
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

Write-Host "=== 1/3 构建前端（npm run build） ==="
npm run build
if ($LASTEXITCODE -ne 0) { throw "前端构建失败" }

Write-Host "=== 2/3 构建 release exe（cargo build --release） ==="
Push-Location (Join-Path $PSScriptRoot "src-tauri")
cargo build --release
$cargoOk = $LASTEXITCODE
Pop-Location
if ($cargoOk -ne 0) { throw "cargo build --release 失败，请检查上方报错" }

$exe = Join-Path $PSScriptRoot "src-tauri\target\release\nativemind.exe"
if (-not (Test-Path $exe)) { throw "找不到 release exe：$exe" }

Write-Host "=== 3/3 组装便携目录并压缩 ==="
$out = Join-Path $PSScriptRoot "portable"
if (Test-Path $out) { Remove-Item $out -Recurse -Force }
New-Item -ItemType Directory -Path $out | Out-Null

# 主程序 + sqlite-vec 扩展（放在 exe 旁边，lib.rs 从 resource_dir 取）
Copy-Item $exe $out -Force
Copy-Item (Join-Path $PSScriptRoot "src-tauri\resources\vec0.dll") (Join-Path $out "vec0.dll") -Force -ErrorAction SilentlyContinue

# 附上 Ollama 环境脚本 + 部署说明
Copy-Item (Join-Path $PSScriptRoot "setup_ollama.bat") $out -Force
if (Test-Path (Join-Path $PSScriptRoot "README-部署.md")) {
  Copy-Item (Join-Path $PSScriptRoot "README-部署.md") $out -Force
}

# 压缩
$zip = Join-Path $PSScriptRoot "NativeMind-便携版.zip"
if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path $out -DestinationPath $zip

$sizeMb = [math]::Round((Get-Item $zip).Length / 1MB)
Write-Host ""
Write-Host "完成！便携版已生成："
Write-Host "  $zip  （约 ${sizeMb} MB）"
Write-Host ""
Write-Host "把 zip 发给对方 → 解压 → 先跑 setup_ollama.bat → 再双击 nativemind.exe"
