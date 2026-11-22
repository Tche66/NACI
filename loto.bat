@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo.
echo ====================================================
echo        LONACI LOTO BONHEUR - MENU PRINCIPAL
echo        Bot v6 + IA Neural + LSTM
echo        Base: 15800+ tirages / 5 ans de donnees
echo ====================================================
echo.
echo   --- DASHBOARD (RECOMMANDE) ---
echo   1. DASHBOARD WEB (ouvrir le navigateur)
echo   2. MAJ resultats + Dashboard
echo.
echo   --- DONNEES ---
echo   3. Mise a jour des resultats
echo   4. Chargement complet (scrape historique)
echo.
echo   --- EXPORTS EXCEL ---
echo   5. Predictions du jour - Excel
echo   6. Paires du jour - Excel
echo   7. Analyse complete - Excel
echo   8. MAJ + Predictions + Paires - Excel
echo.
echo   --- ENTRAINEMENT IA ---
echo   9. Entrainer le reseau de neurones (NN)
echo   A. Entrainer le modele LSTM
echo   B. Apprentissage Bot (walk-forward)
echo.
echo   --- BACKTEST ---
echo   C. Backtest sequentiel 6 mois
echo   D. Backtest comparaison profondeurs (6m a 5 ans)
echo.
echo   0. Quitter
echo.
echo ====================================================
echo.
set /p choix="Ton choix [0-9/A-D]: "

if "%choix%"=="0" exit /b 0
if "%choix%"=="1" goto dashboard
if "%choix%"=="2" goto majdashboard
if "%choix%"=="3" goto update
if "%choix%"=="4" goto full
if "%choix%"=="5" goto predict
if "%choix%"=="6" goto paires
if "%choix%"=="7" goto analyse
if "%choix%"=="8" goto toutexcel
if "%choix%"=="9" goto trainnn
if /i "%choix%"=="A" goto trainlstm
if /i "%choix%"=="B" goto backtest
if /i "%choix%"=="C" goto backtestseq
if /i "%choix%"=="D" goto backtestdepth

echo Choix invalide
goto fin

:dashboard
echo.
echo Lancement du Dashboard (Bot v6 + NN + LSTM)...
echo.
echo   Le navigateur va s'ouvrir sur http://localhost:3000
echo   Pour arreter: fermer cette fenetre ou Ctrl+C
echo.
start http://localhost:3000
node server.js
goto fin

:majdashboard
echo.
echo --- Mise a jour des resultats ---
node update.js
echo.
echo --- Lancement du Dashboard ---
echo.
echo   Le navigateur va s'ouvrir sur http://localhost:3000
echo   Pour arreter: fermer cette fenetre ou Ctrl+C
echo.
start http://localhost:3000
node server.js
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

:toutexcel
echo.
echo --- MAJ + Predictions + Paires ---
node update.js
echo.
node predict.js
echo.
node paires.js
goto fin

:trainnn
echo.
echo --- Entrainement du reseau de neurones (NN) ---
echo Architecture: 20 features -> 48 -> 24 -> 1
echo Sur 15800+ tirages...
echo.
node neural.js
goto fin

:trainlstm
echo.
echo --- Entrainement du modele LSTM ---
echo Architecture: seq(12)x10 -> LSTM(32) + num(20) -> Dense(32) -> 1
echo Sur 15800+ tirages...
echo.
node lstm.js
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
echo --- Backtest sequentiel 6 mois ---
echo Cela prend environ 5-10 minutes...
echo.
node backtest_sequential.js
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
