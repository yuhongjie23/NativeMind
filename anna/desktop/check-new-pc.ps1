param([string]$PackageDirectory = $PSScriptRoot)
$ErrorActionPreference = 'Stop'
# Read-only preflight. No installs, model downloads, data migration or cloud requests.
$packageRoot = [IO.Path]::GetFullPath($PackageDirectory)
$report = Get-Content -LiteralPath (Join-Path $packageRoot 'acceptance.json') -Raw | ConvertFrom-Json
if ($report.archive -notmatch '^nativemind-[0-9]+\.[0-9]+\.[0-9]+-windows-x86_64\.zip$') {
    throw 'Invalid archive filename'
}
$archive = Join-Path $packageRoot $report.archive
$actual = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
$hashMatches = $actual -eq $report.sha256
$webview = @()
foreach ($registryRoot in @('HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients', 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients', 'HKCU:\Software\Microsoft\EdgeUpdate\Clients')) {
    if (Test-Path -LiteralPath $registryRoot) {
        $webview += @(Get-ChildItem -LiteralPath $registryRoot | Get-ItemProperty | Where-Object { $_.name -like '*WebView2*' -and $_.pv -ne '0.0.0.0' })
    }
}
[ordered]@{
    archiveIntegrity = $hashMatches
    windows64Bit = [Environment]::Is64BitOperatingSystem
    architecture = $env:PROCESSOR_ARCHITECTURE
    webView2Detected = $webview.Count -gt 0
    ollamaOnPath = [bool](Get-Command ollama -ErrorAction SilentlyContinue)
    nodeRustPythonRequired = $false
    annaLocalAgentInstall = 'manual verification required'
    launchAndCancel = 'manual verification required'
    offlineStudyAndRestart = 'manual verification required'
    updateAndDataPreservation = 'manual verification required'
    publisherSignature = 'not configured; local hash check is not publisher authentication'
    cleanPcAcceptance = 'not established by preflight alone'
} | ConvertTo-Json
if (-not $hashMatches) { exit 2 }
