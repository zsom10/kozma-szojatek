# Changelog

## 1.0.0 – professzionális családi verzió

- SQLite perzisztencia (`DATA_DIR/kozma.db`), fiókok név+jelszóval, session token
- Háziszabály-pontozás: betűszorzó → szószorzó (többszörözve), jolly = helyettesített betű pontja, tartó-jolly −10
- Jolly-csere a tábláról; végmód A (klasszikus) és B (folytatás, alap)
- 5 fix lobby asztal, csatlakozás és nézőmód, hoszt: végmód / idő / bot
- Tábla és zseton kinézet, UI méret (Normál / Nagy / Extra nagy), 1–7 billentyű, mobil húzás
- Fiókom: 25+ statisztika + meccstörténet; ranglista fülek (pont / PvP / AI)
- `APP_VERSION` a UI láblécén és `/api/health`-ben
- Botok: csak tőszavak, min. 3 betű; ragozott és 2 betűs alakok tiltva
