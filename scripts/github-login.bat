@echo off
REM ============================================================
REM  Vincula esta PC con GitHub (se hace UNA sola vez).
REM  Abre el navegador, inicias sesion y las credenciales quedan
REM  guardadas en el Administrador de credenciales de Windows.
REM  Despues, git push funciona sin pedir nada.
REM ============================================================
cd /d "%~dp0.."

where git >nul 2>&1
if errorlevel 1 (
  echo [X] Git no esta instalado. Instalalo desde https://git-scm.com/download/win
  pause
  exit /b 1
)

where gh >nul 2>&1
if errorlevel 1 (
  echo GitHub CLI no esta instalado. Instalando con winget...
  winget install --id GitHub.cli -e --source winget
  echo.
  echo Cerra y volve a abrir esta ventana, y ejecuta de nuevo este script.
  pause
  exit /b 0
)

gh auth status >nul 2>&1
if errorlevel 1 (
  echo Iniciando sesion en GitHub en el navegador...
  gh auth login --hostname github.com --git-protocol https --web
)

REM Hace que git use la sesion de gh para push/pull
gh auth setup-git

REM Identidad de commits (solo si falta)
for /f "delims=" %%i in ('git config --global user.name') do set GIT_NAME=%%i
if not defined GIT_NAME (
  set /p GIT_NAME=Tu nombre para los commits: 
  git config --global user.name "%GIT_NAME%"
)
for /f "delims=" %%i in ('git config --global user.email') do set GIT_MAIL=%%i
if not defined GIT_MAIL (
  set /p GIT_MAIL=Tu email de GitHub: 
  git config --global user.email "%GIT_MAIL%"
)

REM Remoto del proyecto (solo si falta)
git remote get-url origin >nul 2>&1
if errorlevel 1 git remote add origin https://github.com/Maximois/mcode-ai.git

echo.
gh auth status
echo.
echo [OK] Listo. Ya podes usar scripts\push.bat
pause
