@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist node_modules (
  echo 처음 실행: 필요한 파일을 설치합니다...
  call npm install
)
if not exist dist (
  call npm run build
)
echo.
echo 브라우저에서 http://localhost:4173 을 엽니다. 이 창을 닫으면 앱이 종료됩니다.
start "" http://localhost:4173
call npx vite preview --port 4173 --strictPort
