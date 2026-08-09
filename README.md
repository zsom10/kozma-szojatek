# Kozma Szójáték

Magyar szókirakós családi használatra — fiókokkal, 5 asztallal, nézőmóddal és gazdag statisztikákkal.

## Indítás (helyben)

```bash
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

## Deploy (Railway)

1. Kösd a GitHub repót a Railway-hez (New Project → Deploy from GitHub).
2. Volume: mount path `/data`.
3. Variables: `DATA_DIR=/data` (a Dockerfileban is ez az alap).
4. Deploy után a publikus URL-en web + API + WebSocket együtt fut.

Adatbázis: SQLite a `DATA_DIR` alatt (`kozma.db`).

## Főbb funkciók

- Regisztráció / belépés (név + jelszó)
- 5 fix lobby asztal, csatlakozás vagy nézés
- Végmód A/B, jolly pontozás és csere
- Fiókom: 25+ stat + meccstörténet
- Ranglista: legjobb pont / PvP / AI
- UI méret, billentyű 1–7, mobil húzás
- Botok random magyar névvel; te jössz / végjáték animáció

## Szabályok és verzió

- [RULES.md](./RULES.md)
- [CHANGELOG.md](./CHANGELOG.md)
- Health: `GET /api/health` → `{ version }`
