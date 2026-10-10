@echo off
REM ============================================================
REM  CHECKPOINT: guarda el estado actual en un commit.
REM  Uso:  scripts\checkpoint.bat            (mensaje automatico)
REM        scripts\checkpoint.bat "mensaje"
REM  Ejecutalo SIEMPRE antes de editar codigo.
REM ============================================================
cd /d "%~dp0.."

git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 (
  echo [X] Esto no es un repositorio git.
  exit /b 1
)

git add -A
git diff --cached --quiet
if not errorlevel 1 (
  echo [OK] Nada pendiente: el ultimo commit ya es tu punto de retorno.
  git log -1 --format="     %%h %%s"
  exit /b 0
)

if "%~1"=="" (
  git commit -m "checkpoint: antes de editar - %date% %time%"
) else (
  git commit -m "%~1"
)
if errorlevel 1 exit /b 1

echo.
echo [OK] Checkpoint creado. Para volver atras:
echo      git reset --hard HEAD~1     (descarta lo editado despues)
echo      git revert HEAD             (deshace de forma segura)
