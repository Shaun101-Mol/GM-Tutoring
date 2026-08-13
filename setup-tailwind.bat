@echo off
REM ============================================
REM Modern React + Tailwind CSS v4 Setup Script
REM ============================================
REM This replaces the outdated commands that were
REM previously in settings.json.
REM
REM NOTE: create-react-app is deprecated.
REM Vite is now the recommended way to create
REM React apps. Tailwind v4 uses @tailwindcss/vite.
REM ============================================

echo Creating React app with Vite...
call npm create vite@latest my-app -- --template react

echo.
echo Moving into project directory...
cd my-app

echo.
echo Installing dependencies...
call npm install

echo.
echo Installing Tailwind CSS v4...
call npm install tailwindcss @tailwindcss/vite

echo.
echo ============================================
echo Setup complete!
echo.
echo Next steps:
echo   1. Open src/index.css and add:
echo      @import "tailwindcss";
echo.
echo   2. Open vite.config.js and add:
echo      import tailwindcss from '@tailwindcss/vite'
echo      export default defineConfig({
echo        plugins: [react(), tailwindcss()],
echo      })
echo.
echo   3. Run: npm run dev
echo ============================================
pause