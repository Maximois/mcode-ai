@echo off
echo Iniciando MCodeAI en modo desarrollo...
echo Asegurate de tener Node.js y npm instalados y accesibles desde la linea de comandos.
echo Esto instalará las dependencias si es necesario y luego lanzara la aplicacion.
echo Puedes minimizar o cerrar esta ventana despues de que la aplicacion se inicie completamente.

REM Cambiar al directorio del script para asegurar que npm se ejecute en la raiz del proyecto
pushd "%~dp0"

echo.
echo Verificando e instalando dependencias (esto puede tardar la primera vez)...
call npm install
if %errorlevel% neq 0 (
    echo.
    echo ERROR: Fallo al instalar las dependencias.
    echo Por favor, revisa el mensaje de error anterior y asegurate de tener Node.js y npm instalados correctamente.
    pause
    popd
    goto :eof
)

echo.
echo Iniciando la aplicacion MCodeAI en modo desarrollo...
REM El comando 'npm run dev' ya maneja la espera del servidor Vite y el lanzamiento de Electron.
call npm run dev
if %errorlevel% neq 0 (
    echo.
    echo ERROR: Fallo al iniciar la aplicacion.
    echo Por favor, revisa el mensaje de error anterior en esta ventana.
    pause
    popd
    goto :eof
)

echo.
echo La aplicacion MCodeAI ha sido cerrada o ha ocurrido un error.
pause
popd
