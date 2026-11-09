param([switch]$Apply)
$ErrorActionPreference = 'Stop'
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$root = [IO.Path]::GetFullPath((Join-Path $workspace 'anna\packages'))
if (-not $root.StartsWith($workspace + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid package root' }
if ((Get-Item -LiteralPath $root).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Package root is a link' }
$keep = @('nativemind-local-win32-x64-release-wwMw38', 'nativemind-local-win32-x64-release-RBcxje')
# Always preserve the newest package as well when this script is reused later.
$newest = Get-ChildItem -LiteralPath $root -Directory | Where-Object { $_.Name -match '^nativemind-local-win32-x64-release-' } | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if ($newest) { $keep += $newest.Name }
# The incomplete RBcxje package is deliberately excluded from automatic cleanup.
$savedData = $null
$profile = Join-Path $env:LOCALAPPDATA 'NativeMind\Anna\launcher.json'
if (Test-Path -LiteralPath $profile) { $savedData = (Get-Content -LiteralPath $profile -Raw | ConvertFrom-Json).dataDirectory }
$activeCommands = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'node|python|nativemind' } | ForEach-Object { $_.CommandLine })
function Read-PackageFiles([string]$directory) {
  foreach ($item in Get-ChildItem -LiteralPath $directory -Force) {
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Contains a link' }
    if ($item.PSIsContainer) {
      if ($item.Name -match '^(\.local-data|imports|backups|models|\.anna)$') { throw 'Contains runtime or learning data' }
      Read-PackageFiles $item.FullName
    } else { $item }
  }
}
$results = foreach ($directory in Get-ChildItem -LiteralPath $root -Directory) {
  $target = [IO.Path]::GetFullPath($directory.FullName)
  $bytes = 0L; $action = 'kept'; $reason = ''
  try {
    if ($keep -contains $directory.Name) { throw 'Preserved latest or incomplete package' }
    if ($directory.Name -notmatch '^nativemind-local-win32-x64-release-[A-Za-z0-9]+$' -or [IO.Path]::GetDirectoryName($target) -ne $root) { throw 'Unexpected directory' }
    if ($directory.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Package is a link' }
    if ($savedData -and ([IO.Path]::GetFullPath($savedData)).StartsWith($target + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Used by saved launcher profile' }
    if ($activeCommands | Where-Object { $_ -and $_.IndexOf($target, [StringComparison]::OrdinalIgnoreCase) -ge 0 }) { throw 'Referenced by an active process' }
    $manifest = Get-Content -LiteralPath (Join-Path $target 'package-manifest.json') -Raw | ConvertFrom-Json
    if ($manifest.format -ne 1 -or $manifest.mode -ne 'local-development') { throw 'Unknown manifest format' }
    $expected = @{}
    foreach ($file in $manifest.files) {
      if ($file.path -match '(^/|\\|:|(^|/)\.\.(/|$)|\.(db|sqlite|key|pem)(-|$))' -or $expected.ContainsKey($file.path)) { throw 'Unsafe manifest' }
      $expected[$file.path] = $file
    }
    $actual = @(Read-PackageFiles $target | Where-Object { $_.FullName -ne (Join-Path $target 'package-manifest.json') })
    if ($actual.Count -ne $expected.Count) { throw 'Files differ from original build inventory' }
    foreach ($file in $actual) {
      $relative = $file.FullName.Substring($target.Length + 1).Replace('\', '/')
      $entry = $expected[$relative]
      if (-not $entry -or $file.Length -ne $entry.bytes -or (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash -ne $entry.sha256) { throw 'Modified or additional files' }
      $bytes += $file.Length
    }
    $action = 'eligible'
    if ($Apply) {
      # All checked paths are direct children of the fixed workspace package root.
      Remove-Item -LiteralPath $target -Recurse -Force
      $action = 'deleted'
    }
  } catch { $reason = $_.Exception.Message }
  [pscustomobject]@{ name = $directory.Name; action = $action; bytes = $bytes; reason = $reason }
}
$results | ConvertTo-Json -Depth 3
