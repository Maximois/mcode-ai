@echo off
REM ============================================================
REM  Sube tus commits a GitHub (rama actual).
REM  Hace un checkpoint antes por si quedo algo sin guardar.
REM  Si no hay sesion de GitHub, abre el login automaticamente.
REM ============================================================
cd /d "%~dp0.."

call "%~dp0checkpoint.bat" "checkpoint: antes de push - %date% %time%"

git push -u origin HEAD
if errorlevel 1 (
  echo.
  echo El push fallo. Probablemente falta iniciar sesion. Abriendo login...
  call "%~dp0github-login.bat"
  git push -u origin HEAD
)
if errorlevel 1 (
  echo [X] No se pudo subir. Revisa el mensaje de arriba.
  pause
  exit /b 1
)
echo.
echo [OK] Subido a GitHub.
pause
