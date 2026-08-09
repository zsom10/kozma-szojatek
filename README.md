# Kozma Szójáték

Magyar szókirakós családi használatra — fiókokkal, 5 asztallal, nézőmóddal és gazdag statisztikákkal.

## Indítás

```bash
cd szorako
npm install
npm run build:engine
npm run dev
```

- Web (Vite): http://localhost:5173
- API / WS: http://localhost:8787

Produkciós build:

```bash
npm run build
npm start
```

Adatbázis: SQLite a `DATA_DIR` alatt (`kozma.db`). Railway-n mountold a Volume-ot `/data`-ra, és állítsd `DATA_DIR=/data`.

## Főbb funkciók

- Regisztráció / belépés (név + jelszó)
- 5 fix lobby asztal, csatlakozás vagy nézés
- Végmód A/B, jolly pontozás és csere
- Fiókom: 25+ stat + meccstörténet
- Ranglista: legjobb pont / PvP / AI
- UI méret, billentyű 1–7, mobil húzás

## Szabályok és verzió

- [RULES.md](./RULES.md)
- [CHANGELOG.md](./CHANGELOG.md)
- Health: `GET /api/health` → `{ version }`
