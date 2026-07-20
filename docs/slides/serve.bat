@echo off
cd /d "%~dp0dist"
echo Open http://localhost:8080 in your browser
python -m http.server 8080
pause
