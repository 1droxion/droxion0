@echo off
setlocal
cd /d "%~dp0"
where python >nul 2>nul || (echo Install Python 3.11 or newer && pause && exit /b 1)
where ffmpeg >nul 2>nul || (echo Install FFmpeg with: winget install --id Gyan.FFmpeg -e && pause && exit /b 1)
python -m pip install -r requirements.txt || (pause && exit /b 1)
echo DroxionClips running at http://127.0.0.1:8769
start "" http://127.0.0.1:8769
python -m uvicorn app:app --host 127.0.0.1 --port 8769
pause
