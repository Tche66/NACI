@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo.
echo ====================================================
echo        LONACI LOTO BONHEUR - MENU PRINCIPAL
echo        Bot v4 - Auto-apprentissage (5429 tirages)
echo ====================================================
echo.
echo   1. Mise a jour des resultats
echo   2. Chargement complet 24 mois
echo   3. Predictions du jour - Excel
echo   4. Paires du jour - Excel
echo   5. Analyse complete - Excel
echo.
echo   6. DASHBOARD WEB - RECOMMANDE
echo   7. MAJ + Dashboard - tout en 1
echo   8. MAJ + Predictions + Paires - Excel
echo   9. Backtest apprentissage (5 mois)
echo.
echo   0. Quitter
echo.
echo ====================================================
echo.
set /p choix="Ton choix [0-9]: "

if "%choix%"=="0" exit /b 0
if "%choix%"=="1" goto update
if "%choix%"=="2" goto full
if "%choix%"=="3" goto predict
if "%choix%"=="4" goto paires
if "%choix%"=="5" goto analyse
if "%choix%"=="6" goto dashboard
if "%choix%"=="7" goto majdashboard
if "%choix%"=="8" goto toutexcel
if "%choix%"=="9" goto backtest

echo Choix invalide
goto fin

:update
echo.
echo --- Mise a jour des resultats ---
node update.js
goto fin

:full
echo.
echo --- Chargement complet 24 mois ---
node update.js --full
goto fin

:predict
echo.
echo --- Predictions du jour ---
node predict.js
goto fin

:paires
echo.
echo --- Paires du jour ---
node paires.js
goto fin

:analyse
echo.
echo --- Analyse complete ---
node analyse.js
goto fin

:dashboard
echo.
echo Lancement du Dashboard...
echo Ouvre http://localhost:3000
echo.
start http://localhost:3000
node server.js
goto fin

:majdashboard
echo.
echo --- Mise a jour ---
node update.js
echo.
echo --- Lancement du Dashboard ---
start http://localhost:3000
node server.js
goto fin

:toutexcel
echo.
echo --- MAJ + Predictions + Paires ---
node update.js
echo.
node predict.js
echo.
node paires.js
goto fin

:backtest
echo.
echo --- Backtest 5 mois avec apprentissage ---
echo Cela prend environ 15 secondes...
echo.
node backtest_5mois_learn.js
goto fin

:fin
echo.
pause
