# 验证 .claude/skills/*/SKILL.md 中引用的仓库路径是否真实存在。
# 防止 Skill 稳定地指导代理修改死代码（旧组件被删后路径引用失效）。
# 用法：powershell -ExecutionPolicy Bypass -File scripts/check-skill-paths.ps1
# 退出码：0 = 全部有效；1 = 存在失效引用（输出明细）。

$root = Split-Path -Parent $PSScriptRoot
$skills = Join-Path $root ".claude\skills"

if (-not (Test-Path $skills)) {
    Write-Host "未找到 skills 目录: $skills"
    exit 1
}

$broken = 0
$dirs = Get-ChildItem $skills -Directory -Force | Where-Object { $_.Name -notlike '`.' -and $_.Name -notlike '`.agents' }
foreach ($dir in $dirs) {
    $md = Join-Path $dir.FullName "SKILL.md"
    if (-not (Test-Path $md)) {
        Write-Host "[$($dir.Name)] 缺少 SKILL.md"
        $broken++
        continue
    }
    $content = Get-Content $md -Encoding UTF8 -Raw
    $found = [regex]::Matches($content, '(src/[\w\-/\.]+\.(?:tsx?|ts|jsx?|css|md|json))')
    $paths = $found | ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique
    foreach ($p in $paths) {
        $full = Join-Path $root $p
        if (-not (Test-Path $full)) {
            Write-Host "[$($dir.Name)] 失效引用: $p"
            $broken++
        }
    }
}

if ($broken -gt 0) {
    Write-Host "共 $broken 处失效引用，需要修复 SKILL.md。"
    exit 1
}
Write-Host "所有 SKILL.md 路径引用有效。"
exit 0
