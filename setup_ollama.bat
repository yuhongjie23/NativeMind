@echo off
echo ============================================
echo  NativeMind setup: Ollama + local models
echo ============================================
echo.

echo [1/3] Checking Ollama...
where ollama >nul 2>nul
if %errorlevel%==0 (
  echo   Ollama found, skip install.
) else (
  echo   Ollama not found, installing via winget (downloads ~1.5GB)...
  winget install --id Ollama.Ollama -e --accept-source-agreements --accept-package-agreements
  rem Re-check after install: winget may report success even if download failed
  where ollama >nul 2>nul
  if %errorlevel%==0 (
    echo   Ollama installed successfully.
  ) else (
    echo.
    echo   !!! Ollama install failed (likely a network issue downloading from GitHub).
    echo   Please do one of these, then run this script again:
    echo     1. Download Ollama manually from  https://ollama.com/download  and install it, OR
    echo     2. Check your internet connection and retry.
    echo.
    pause
    exit /b 1
  )
)

echo.
echo [2/3] Ensure Ollama service is running...
where ollama >nul 2>nul
if %errorlevel%==0 (
  tasklist 2>nul | find /i "ollama" >nul 2>nul
  if %errorlevel%==0 (
    echo   Ollama is running.
  ) else (
    echo   Starting Ollama service...
    start "" "ollama" serve
    timeout /t 4 >nul
  )
)

echo.
echo [3/3] Pulling NativeMind models...
echo     (1.5b ~1GB / 7b ~4.7GB / 14b ~9GB, keep what you need)
call :pull qwen2.5:1.5b
call :pull qwen2.5:7b
call :pull qwen2.5:14b

echo.
echo ============================================
echo  Done! Now launch NativeMind.
echo  Tip: on 4060 GPU use 7b; 14b is slow,
echo  delete the "call :pull qwen2.5:14b" line to skip.
echo ============================================
echo.
pause
exit /b 0

:pull
echo   -- Pulling %~1 ...
ollama pull %~1
if errorlevel 1 echo   (Pull failed for %~1, can re-run later)
exit /b 0
