# LONACI Loto Bonheur - Scraper & Dashboard

## Projet
Systeme d'analyse statistique et de prediction pour le Loto Bonheur (LONACI, Cote d'Ivoire).
Scrape les resultats depuis lotobonheur.ci, analyse 24 mois de donnees (6500+ tirages), et genere des predictions par grilles de couverture.

## Stack
- **Runtime**: Node.js v24 (Windows)
- **Dependances**: express, exceljs
- **Base de donnees**: fichier JSON local (lonaci_db.json)
- **API source**: `https://lotobonheur.ci/api/results?monthYear=<mois+annee>`

## Structure des fichiers

```
lonaci-scraper/
  server.js          -- Serveur Express (dashboard web localhost:3000)
  db.js              -- Module base de donnees JSON
  horaires.js        -- Horaires officiels de chaque tirage par jour
  couverture.js      -- Systeme de grilles de couverture (8 strategies)
  update.js          -- Script MAJ des resultats (cli)
  predict.js         -- Generateur predictions Excel (cli)
  paires.js          -- Generateur paires du jour Excel (cli)
  analyse.js         -- Analyse statistique complete Excel (cli)
  scraper.js         -- Scraper brut 24 mois vers Excel
  loto.bat           -- Menu principal Windows
  public/
    index.html       -- Dashboard web (SPA, dark theme)
  lonaci_db.json     -- Base de donnees locale
  historique_predictions.json -- Historique predictions vs resultats
```

## API LONACI
- Endpoint: `https://lotobonheur.ci/api/results?monthYear=octobre+2026`
- Format: JSON avec `drawsResultsWeekly[].drawResultsDaily[].drawResults.{nightDraws,standardDraws}`
- Chaque tirage: `drawName`, `winningNumbers` ("44 - 48 - 31 - 64 - 66"), `machineNumbers`
- 5 numeros gagnants + 5 numeros machine par tirage (1 a 90)
- Numeros machine absents pour les tirages speciaux (". - . - . - . - .")

## Horaires des tirages
- Lundi: Reveil(09:55), Etoile(12:55), Akwaba(15:55), Monday Special(18:30)
- Mardi: La Matinale(09:55), Emergence(12:55), Sika(15:55), Lucky Tuesday(18:30)
- Mercredi: Premiere Heure(09:55), Fortune(12:55), Baraka(15:55), Midweek(18:30)
- Jeudi: Kado(09:55), Privilege(12:55), Monni(15:55), Fortune Thursday(18:30)
- Vendredi: Cash(09:55), Solution(12:55), Wari(15:55), Friday Bonanza(18:30)
- Samedi: Soutra(09:55), Diamant(12:55), Moaye(15:55), National(18:30)
- Dimanche: Benediction(09:55), Prestige(12:55), Awale(15:55), Espoir(18:30)
- Tous les jours: Afterwork(17:55), Digital Reveil 7h(06:58), Digital Reveil 8h(07:58), Digital 21h(20:58), Digital 22h(21:58), Digital 23h(22:58)
- Weekend: Special Weekend 1h(01:00), Special Weekend 3h(03:00)

## Systeme de prediction - 8 grilles de couverture
1. **CONSENSUS** (90%) - Numeros presents dans 3+ autres grilles
2. **TOP SCORE** (85%) - Meilleurs scores combines (freq + recent + retard + markov + binaire)
3. **COUVERTURE DIZAINES** (75%) - 1 numero par dizaine chaude
4. **TERMINAISONS CHAUDES** (70%) - 1 numero par terminaison frequente
5. **VOISINS DU TOP** (70%) - Numeros a +/-2 des meilleurs (couvre les proches)
6. **PAIRES FORTES** (65%) - 2 paires les plus frequentes + complement
7. **EQUILIBRE PARFAIT** (75%) - 2 pairs + 3 impairs, somme ~225
8. **CHAINE MARKOV** (60%) - Successeurs probables du dernier tirage

## Auto-update
- Le serveur verifie automatiquement les nouveaux resultats aux heures: 07:05, 08:05, 10:05, 13:05, 16:05, 18:05, 18:40, 21:05, 22:05, 23:05
- Compare automatiquement predictions vs resultats
- Systeme d'apprentissage: ajuste les poids des 7 criteres de scoring selon les performances passees

## Dashboard web (localhost:3000)
Onglets: Predictions, Paires, Grilles Couverture, Semaine, Analyse & Apprentissage, Frequences, Distribution, Resultats

## Usage quotidien
1. `loto.bat` -> choix 7 (MAJ + Dashboard)
2. Ouvrir http://localhost:3000
3. Onglet "Grilles Couverture" pour les predictions multi-strategies
4. Cliquer "Sauvegarder les predictions" le matin
5. Le systeme compare et apprend automatiquement

## Statistiques cles (24 mois)
- Somme moyenne: ~227 (zone probable: 170-280)
- Distribution dominante: 2 pairs + 3 impairs
- Biais Chi2 confirme: la distribution n'est pas uniforme
- Les numeros 9 et 33 sont stables dans le top sur 12 et 24 mois

## Notes techniques
- Node.js sur Windows: utiliser `"C:/Program Files/nodejs/node.exe"` en chemin complet dans les scripts bash
- Le fichier loto.bat ne doit PAS contenir de caracteres speciaux Unicode (pas de accents ni de bordures)
- Les noms de feuilles Excel ne peuvent pas contenir / : ? * [ ]
- Attention aux backticks dans le HTML inline JS - verifier qu'ils sont toujours en nombre pair
