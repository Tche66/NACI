@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo.
echo ====================================================
echo        LONACI LOTO BONHEUR - MENU PRINCIPAL
echo        Bot v5 - IA + Auto-apprentissage
echo        Base: 15000+ tirages / 5 ans de donnees
echo ====================================================
echo.
echo   1. Mise a jour des resultats
echo   2. Chargement complet (scrape historique)
echo   3. Predictions du jour - Excel
echo   4. Paires du jour - Excel
echo   5. Analyse complete - Excel
echo.
echo   6. DASHBOARD WEB - RECOMMANDE
echo   7. MAJ + Dashboard - tout en 1
echo   8. MAJ + Predictions + Paires - Excel
echo.
echo   9. Backtest apprentissage (walk-forward)
echo   A. Backtest sequentiel 6 mois
echo   B. Entrainer le reseau de neurones
echo   C. Backtest comparaison profondeurs (6m a 5 ans)
echo.
echo   0. Quitter
echo.
echo ====================================================
echo.
set /p choix="Ton choix [0-9/A/B/C]: "

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
if /i "%choix%"=="A" goto backtestseq
if /i "%choix%"=="B" goto trainnn
if /i "%choix%"=="C" goto backtestdepth

echo Choix invalide
goto fin

:update
echo.
echo --- Mise a jour des resultats ---
node update.js
goto fin

:full
echo.
echo --- Chargement complet historique ---
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
echo Lancement du Dashboard (Stats + IA + Auto-apprentissage)...
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
echo --- Backtest walk-forward (apprentissage cumulatif) ---
echo Entraine les poids globaux + par categorie...
echo.
node -e "const{learnAndAdapt}=require('./apprentissage');const s=learnAndAdapt();if(s)console.log('OK');else console.log('Pas assez de donnees');"
goto fin

:backtestseq
echo.
echo --- Backtest sequentiel 6 mois (predire + apprendre + suivant) ---
echo Cela prend environ 5-10 minutes...
echo.
node backtest_sequential.js
goto fin

:trainnn
echo.
echo --- Entrainement du reseau de neurones ---
echo 12 features x 32 neurones, 5 epochs sur 15000+ tirages...
echo.
node neural.js
goto fin

:backtestdepth
echo.
echo --- Comparaison profondeurs (6m a 5 ans) ---
echo Cela prend environ 30-60 minutes...
echo.
node backtest_depth.js
goto fin

:fin
echo.
pause
