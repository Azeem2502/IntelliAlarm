@echo off
title IntelliAlarm Server Launcher
echo ==============================================
echo    Starting IntelliAlarm MQTT Broker & Backend
echo ==============================================
echo.
wscript "%~dp0backend\start_silent.vbs"
echo [OK] IntelliAlarm background servers launched successfully!
echo   * MQTT Broker:   port 1883
echo   * FastAPI Server: port 8000
echo.
echo ESP32 Hardware and Mobile App can now connect automatically.
timeout /t 3 >nul
