@echo off
title Instalador - A Mensagem Control

echo =======================================================
echo           Instalador - A Mensagem Control
echo =======================================================
echo.
echo Instalando o aplicativo no seu computador...
echo.

set "TARGET_DIR=C:\A Mensagem Control"
set "SRC_DIR=%~dp0A Mensagem Control-win32-x64"

if not exist "%SRC_DIR%" (
    echo [ERRO] Pasta de origem nao encontrada!
    echo Certifique-se de extrair o arquivo ZIP antes de rodar.
    pause
    exit /b 1
)

echo Copiando arquivos para %TARGET_DIR%...
xcopy "%SRC_DIR%" "%TARGET_DIR%" /E /I /H /Y /Q > nul

if errorlevel 1 (
    echo [ERRO] Falha ao copiar os arquivos.
    echo Tente executar este instalador como Administrador.
    pause
    exit /b 1
)

echo.
echo Liberando o Firewall do Windows para o OBS em outro computador...
echo Se o Windows perguntar, clique em "Sim".
netsh advfirewall firewall show rule name="A Mensagem Control (OBS em outro PC)" >nul 2>&1
if errorlevel 1 powershell -NoProfile -Command "Start-Process netsh -Verb RunAs -WindowStyle Hidden -Wait -ArgumentList 'advfirewall firewall add rule name=\"A Mensagem Control (OBS em outro PC)\" dir=in action=allow protocol=TCP localport=3000 profile=any'" >nul 2>&1
netsh advfirewall firewall show rule name="A Mensagem Control (OBS em outro PC)" >nul 2>&1
if errorlevel 1 echo [AVISO] Firewall nao liberado. Depois, no app: Configuracoes, Link para o OBS, botao "Liberar no Firewall".

echo.
echo Iniciando o aplicativo para criar atalhos e configurar...
start "" "%TARGET_DIR%\A Mensagem Control.exe"

echo.
echo =======================================================
echo      Instalacao Concluida com Sucesso!
echo =======================================================
echo.
echo O atalho "A Mensagem Control" foi criado na sua
echo Area de Trabalho. Voce ja pode fechar esta janela.
echo.
pause
