@echo off
cd /d "%~dp0"
where py >nul 2>nul
if errorlevel 1 (
  python "%~dp0windows_clip_helper.py" %*
) else (
  py -3 "%~dp0windows_clip_helper.py" %*
)
pause
