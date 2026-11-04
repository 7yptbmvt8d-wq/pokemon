# Mon classeur — cartes Pokémon

Application web installable (PWA) de gestion d'une collection de cartes Pokémon **françaises**. HTML / CSS / JS sans framework ni étape de build, hébergée sur GitHub Pages.

## Fonctions

- **Ajout souple** : `025/165`, `MEW 025`, `151 25`, `svi 1` ou nom de la carte. Extension déduite du code (MEW, SVI, PAL…) ou du total imprimé (/165) ; sinon liste des correspondances avec illustration.
- **Scan** : photo → OCR Tesseract.js (chargé à la demande) sur le bas de la carte, tolérant aux confusions O/0, I/1, S/5, B/8. La photo peut servir d'illustration.
- **Fiche carte** : quantité, variante (Normale / Reverse / Holo / 1re édition), état, langue, prix d'achat, date, provenance, prix manuel, notes, photo, lien Cardmarket. Doublons identiques fusionnés.
- **Valeur** : prix Cardmarket « tendance » de la variante (reverse → prix reverse), prix manuel prioritaire. Courbe de la collection (1M / 3M / 6M / 1A / Tout) et de chaque carte (prix d'achat en pointillé).
- **Investissement** : achats scellés (booster, display, ETB, coffret, lot), provenance par carte, rentabilité par achat.
- **Complétion** : par extension (numéros officiels) et master set (secrètes + reverses), classeur 3×3, coût pour compléter.
- **Recherchées** (wishlist par priorité), **Profil** (statistiques, export / import JSON avec photos, export CSV pour Excel, devise).
- Hors ligne après la première ouverture. La collection reste **sur l'appareil** (localStorage + IndexedDB).

## Données

`scripts/build-data.mjs` interroge chaque nuit l'API [TCGdex](https://tcgdex.dev) en français et produit `public/data/cards.json` (index compact) et `public/data/prices.json` (prix Cardmarket €). Un instantané hebdomadaire des prix est versionné dans `public/data/history/` pour les graphiques.

## Mise en ligne

1. Dépôt → *Settings* → *Pages* → *Source* : **GitHub Actions**.
2. Le workflow « Prix & déploiement » (push sur `main`, chaque nuit, ou manuel) construit les données et publie `public/`.
3. iPhone : ouvrir l'adresse dans Safari → *Partager* → *Sur l'écran d'accueil*.

## En local

```bash
npm start      # données + serveur http://localhost:8080
npm test       # tests Playwright 440×956 (serveur lancé)
```
