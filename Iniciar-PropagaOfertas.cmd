@echo off
cd /d "%~dp0"
if not exist node_modules (
  call npm install
  if errorlevel 1 goto erro
)
if not exist dist\index.html (
  call npm run build
  if errorlevel 1 goto erro
)
echo Abra http://127.0.0.1:3001 no navegador.
echo Mantenha esta janela aberta enquanto usar o PropagaOfertas.
call npm start
pause
exit /b
:erro
echo Nao foi possivel iniciar. Confira a mensagem acima.
pause
