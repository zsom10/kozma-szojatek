import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { APP_VERSION, tokenizeWord, tilesToWord } from "@szorako/engine";
import type { BotDifficulty, EndMode, GameState } from "@szorako/engine";
import bcrypt from "bcryptjs";
import { nanoid } from "nanoid";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function dataDir(): string {
  if (process.env.DATA_DIR) return path.resolve(process.env.DATA_DIR);
  return path.resolve(__dirname, "../../../data");
}

let db: DatabaseSync;

export function getDb(): DatabaseSync {
  if (!db) {
    const dir = dataDir();
    fs.mkdirSync(dir, { recursive: true });
    db = new DatabaseSync(path.join(dir, "kozma.db"));
    db.exec("PRAGMA journal_mode = WAL;");
    migrate(db);
  }
  return db;
}

function migrate(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      ui_scale TEXT NOT NULL DEFAULT 'normal',
      created_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS user_words (
      word TEXT PRIMARY KEY,
      added_by TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS games (
      id TEXT PRIMARY KEY,
      table_id INTEGER,
      end_mode TEXT NOT NULL,
      status TEXT NOT NULL,
      vs_ai INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      finished_at INTEGER,
      state_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS game_players (
      game_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      is_bot INTEGER NOT NULL,
      score INTEGER NOT NULL,
      won INTEGER NOT NULL,
      PRIMARY KEY(game_id, user_id),
      FOREIGN KEY(game_id) REFERENCES games(id)
    );
    CREATE TABLE IF NOT EXISTS moves (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id TEXT NOT NULL,
      user_id TEXT,
      kind TEXT NOT NULL,
      score INTEGER NOT NULL DEFAULT 0,
      words TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS user_stats (
      user_id TEXT PRIMARY KEY,
      games INTEGER NOT NULL DEFAULT 0,
      wins INTEGER NOT NULL DEFAULT 0,
      losses INTEGER NOT NULL DEFAULT 0,
      draws INTEGER NOT NULL DEFAULT 0,
      pvp_wins INTEGER NOT NULL DEFAULT 0,
      pvp_losses INTEGER NOT NULL DEFAULT 0,
      ai_wins INTEGER NOT NULL DEFAULT 0,
      ai_losses INTEGER NOT NULL DEFAULT 0,
      total_score INTEGER NOT NULL DEFAULT 0,
      best_score INTEGER NOT NULL DEFAULT 0,
      worst_score INTEGER NOT NULL DEFAULT 0,
      bingos INTEGER NOT NULL DEFAULT 0,
      passes INTEGER NOT NULL DEFAULT 0,
      timeouts INTEGER NOT NULL DEFAULT 0,
      blank_uses INTEGER NOT NULL DEFAULT 0,
      words_added INTEGER NOT NULL DEFAULT 0,
      play_ms INTEGER NOT NULL DEFAULT 0,
      longest_word TEXT,
      best_move_score INTEGER NOT NULL DEFAULT 0,
      win_streak INTEGER NOT NULL DEFAULT 0,
      best_win_streak INTEGER NOT NULL DEFAULT 0,
      favorite_opponent TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );
  `);
  database.prepare(
    "INSERT OR REPLACE INTO app_meta(key, value) VALUES('app_version', ?)"
  ).run(APP_VERSION);
  migrateGamePlayersPk(database);
  migrateAdminColumn(database);
  migrateBestMoveColumns(database);
}

function migrateBestMoveColumns(database: DatabaseSync): void {
  const cols = database.prepare("PRAGMA table_info(user_stats)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "best_move_words")) {
    database.exec("ALTER TABLE user_stats ADD COLUMN best_move_words TEXT");
  }
  if (!cols.some((c) => c.name === "best_move_at")) {
    database.exec("ALTER TABLE user_stats ADD COLUMN best_move_at INTEGER");
  }
}

function migrateAdminColumn(database: DatabaseSync): void {
  const cols = database.prepare("PRAGMA table_info(users)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "is_admin")) {
    database.exec("ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0");
  }
  const raw = process.env.ADMIN_NAMES ?? "zsom10";
  for (const name of raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)) {
    database
      .prepare("UPDATE users SET is_admin = 1 WHERE name = ? COLLATE NOCASE")
      .run(name);
  }
}

function migrateGamePlayersPk(database: DatabaseSync): void {
  const row = database
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='game_players'")
    .get() as { sql: string } | undefined;
  if (!row?.sql?.includes("PRIMARY KEY(game_id, name)")) return;
  database.exec(`
    CREATE TABLE game_players_new (
      game_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      is_bot INTEGER NOT NULL,
      score INTEGER NOT NULL,
      won INTEGER NOT NULL,
      PRIMARY KEY(game_id, user_id),
      FOREIGN KEY(game_id) REFERENCES games(id)
    );
    INSERT INTO game_players_new(game_id, user_id, name, is_bot, score, won)
    SELECT game_id,
           COALESCE(user_id, 'legacy-' || game_id || '-' || rowid),
           name, is_bot, score, won
    FROM game_players;
    DROP TABLE game_players;
    ALTER TABLE game_players_new RENAME TO game_players;
  `);
}

export type UserRow = {
  id: string;
  name: string;
  password_hash: string;
  ui_scale: string;
  created_at: number;
  last_seen_at: number;
  is_admin?: number;
};

export function registerUser(name: string, password: string): UserRow {
  const database = getDb();
  const id = nanoid(12);
  const hash = bcrypt.hashSync(password, 10);
  const t = Date.now();
  try {
    database
      .prepare(
        "INSERT INTO users(id, name, password_hash, created_at, last_seen_at) VALUES(?,?,?,?,?)"
      )
      .run(id, name.trim(), hash, t, t);
  } catch {
    throw new Error("Ez a név már foglalt.");
  }
  database
    .prepare("INSERT INTO user_stats(user_id) VALUES(?)")
    .run(id);
  return getUserById(id)!;
}

export function loginUser(name: string, password: string): { user: UserRow; token: string } {
  const database = getDb();
  const user = database
    .prepare("SELECT * FROM users WHERE name = ? COLLATE NOCASE")
    .get(name.trim()) as UserRow | undefined;
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    throw new Error("Hibás név vagy jelszó.");
  }
  const token = nanoid(32);
  database
    .prepare("INSERT INTO sessions(token, user_id, created_at) VALUES(?,?,?)")
    .run(token, user.id, Date.now());
  database
    .prepare("UPDATE users SET last_seen_at = ? WHERE id = ?")
    .run(Date.now(), user.id);
  return { user, token };
}

export function userFromToken(token: string | undefined | null): UserRow | null {
  if (!token) return null;
  const database = getDb();
  const row = database
    .prepare(
      `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?`
    )
    .get(token) as UserRow | undefined;
  return row ?? null;
}

export function getUserById(id: string): UserRow | null {
  return (
    (getDb().prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined) ??
    null
  );
}

export function setUiScale(userId: string, scale: string): void {
  getDb().prepare("UPDATE users SET ui_scale = ? WHERE id = ?").run(scale, userId);
}

export function getUserWords(): string[] {
  return (
    getDb().prepare("SELECT word FROM user_words").all() as { word: string }[]
  ).map((r) => r.word);
}

export function addUserWords(words: string[], userId?: string): string[] {
  const database = getDb();
  const added: string[] = [];
  const insert = database.prepare(
    "INSERT OR IGNORE INTO user_words(word, added_by, created_at) VALUES(?,?,?)"
  );
  for (const w of words) {
    const tiles = tokenizeWord(String(w));
    if (!tiles || tiles.length < 2) continue;
    const key = tilesToWord(tiles);
    const info = insert.run(key, userId ?? null, Date.now());
    if (Number(info.changes) > 0) {
      added.push(key);
      if (userId) {
        database
          .prepare("UPDATE user_stats SET words_added = words_added + 1 WHERE user_id = ?")
          .run(userId);
      }
    } else {
      added.push(key);
    }
  }
  return [...new Set(added)];
}

export function saveGameState(game: GameState, vsAi: boolean): void {
  const database = getDb();
  database
    .prepare(
      `INSERT INTO games(id, table_id, end_mode, status, vs_ai, created_at, finished_at, state_json)
       VALUES(?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
         status=excluded.status,
         finished_at=excluded.finished_at,
         state_json=excluded.state_json`
    )
    .run(
      game.id,
      game.tableId ?? null,
      game.endMode,
      game.status,
      vsAi ? 1 : 0,
      game.createdAt,
      game.status === "finished" ? Date.now() : null,
      JSON.stringify(game)
    );
}

export function loadGameState(id: string): GameState | null {
  const row = getDb()
    .prepare("SELECT state_json FROM games WHERE id = ?")
    .get(id) as { state_json: string } | undefined;
  if (!row) return null;
  return JSON.parse(row.state_json) as GameState;
}

export type FinishedPayload = {
  game: GameState;
  vsAi: boolean;
  bingosByUser?: Record<string, number>;
  passesByUser?: Record<string, number>;
  timeoutsByUser?: Record<string, number>;
  blankUsesByUser?: Record<string, number>;
  bestMoveByUser?: Record<string, number>;
  longestWordByUser?: Record<string, string>;
};

export function recordFinishedGame(payload: FinishedPayload): void {
  const { game, vsAi } = payload;
  saveGameState(game, vsAi);
  const database = getDb();
  const del = database.prepare("DELETE FROM game_players WHERE game_id = ?");
  del.run(game.id);
  const insert = database.prepare(
    `INSERT INTO game_players(game_id, user_id, name, is_bot, score, won)
     VALUES(?,?,?,?,?,?)`
  );
  const max = Math.max(...game.players.map((p) => p.score));
  for (const p of game.players) {
    insert.run(
      game.id,
      p.id,
      p.name,
      p.isBot ? 1 : 0,
      p.score,
      p.score === max ? 1 : 0
    );
  }

  for (const p of game.players) {
    if (p.isBot) continue;
    const won = p.score === max && game.winnerIds.includes(p.id);
    const draw = game.winnerIds.length > 1 && game.winnerIds.includes(p.id);
    const lost = !won && !draw;
    const duration = Math.max(0, Date.now() - game.createdAt);
    database
      .prepare(
        `UPDATE user_stats SET
          games = games + 1,
          wins = wins + ?,
          losses = losses + ?,
          draws = draws + ?,
          pvp_wins = pvp_wins + ?,
          pvp_losses = pvp_losses + ?,
          ai_wins = ai_wins + ?,
          ai_losses = ai_losses + ?,
          total_score = total_score + ?,
          best_score = CASE WHEN ? > best_score THEN ? ELSE best_score END,
          worst_score = CASE WHEN worst_score = 0 OR ? < worst_score THEN ? ELSE worst_score END,
          play_ms = play_ms + ?,
          win_streak = CASE WHEN ? = 1 THEN win_streak + 1 ELSE 0 END,
          best_win_streak = CASE WHEN ? = 1 AND win_streak + 1 > best_win_streak THEN win_streak + 1 ELSE best_win_streak END,
          bingos = bingos + ?,
          passes = passes + ?,
          timeouts = timeouts + ?,
          blank_uses = blank_uses + ?,
          best_move_score = CASE WHEN ? > best_move_score THEN ? ELSE best_move_score END,
          longest_word = CASE
            WHEN longest_word IS NULL OR length(?) > length(COALESCE(longest_word,'')) THEN ?
            ELSE longest_word END
        WHERE user_id = ?`
      )
      .run(
        won && !draw ? 1 : 0,
        lost ? 1 : 0,
        draw ? 1 : 0,
        !vsAi && won && !draw ? 1 : 0,
        !vsAi && lost ? 1 : 0,
        vsAi && won && !draw ? 1 : 0,
        vsAi && lost ? 1 : 0,
        p.score,
        p.score,
        p.score,
        p.score,
        p.score,
        duration,
        won && !draw ? 1 : 0,
        won && !draw ? 1 : 0,
        payload.bingosByUser?.[p.id] ?? 0,
        payload.passesByUser?.[p.id] ?? 0,
        payload.timeoutsByUser?.[p.id] ?? 0,
        payload.blankUsesByUser?.[p.id] ?? 0,
        payload.bestMoveByUser?.[p.id] ?? 0,
        payload.bestMoveByUser?.[p.id] ?? 0,
        payload.longestWordByUser?.[p.id] ?? "",
        payload.longestWordByUser?.[p.id] ?? "",
        p.id
      );
  }
}

export function recordBestMove(
  userId: string,
  score: number,
  words: string[]
): void {
  if (!userId || userId.startsWith("bot-") || score <= 0) return;
  const database = getDb();
  const row = database
    .prepare("SELECT best_move_score FROM user_stats WHERE user_id = ?")
    .get(userId) as { best_move_score: number } | undefined;
  if (!row) return;
  if (score <= Number(row.best_move_score ?? 0)) return;
  const joined = words.filter(Boolean).join(", ");
  database
    .prepare(
      `UPDATE user_stats SET
         best_move_score = ?,
         best_move_words = ?,
         best_move_at = ?
       WHERE user_id = ?`
    )
    .run(score, joined || null, Date.now(), userId);
}

export function getLeaderboard() {
  const database = getDb();
  const byScore = database
    .prepare(
      `SELECT u.name, s.best_score, s.games, s.wins, s.pvp_wins
       FROM user_stats s JOIN users u ON u.id = s.user_id
       WHERE s.games > 0
       ORDER BY s.best_score DESC, s.wins DESC
       LIMIT 30`
    )
    .all();
  const byPvp = database
    .prepare(
      `SELECT u.name, s.pvp_wins, s.pvp_losses, s.best_score, s.games
       FROM user_stats s JOIN users u ON u.id = s.user_id
       WHERE s.pvp_wins + s.pvp_losses > 0
       ORDER BY s.pvp_wins DESC, s.best_score DESC
       LIMIT 30`
    )
    .all();
  const byBestMove = database
    .prepare(
      `SELECT u.name, s.best_move_score AS score, s.best_move_words AS words,
              datetime(s.best_move_at/1000, 'unixepoch', 'localtime') AS at
       FROM user_stats s JOIN users u ON u.id = s.user_id
       WHERE s.best_move_score > 0
       ORDER BY s.best_move_score DESC, s.best_move_at DESC
       LIMIT 30`
    )
    .all();
  return { byScore, byPvp, byBestMove };
}

export function getUserProfile(userId: string) {
  const database = getDb();
  const user = getUserById(userId);
  if (!user) return null;
  const stats = database
    .prepare("SELECT * FROM user_stats WHERE user_id = ?")
    .get(userId) as Record<string, unknown>;
  const history = database
    .prepare(
      `SELECT g.id, g.vs_ai, g.finished_at, g.end_mode, gp.score, gp.won,
        (SELECT group_concat(gp2.name, ', ') FROM game_players gp2 WHERE gp2.game_id = g.id AND gp2.name != gp.name) AS opponents
       FROM game_players gp
       JOIN games g ON g.id = gp.game_id
       WHERE gp.user_id = ? AND g.status = 'finished'
       ORDER BY g.finished_at DESC
       LIMIT 40`
    )
    .all(userId);

  const games = Number(stats.games ?? 0) || 1;
  const curiosities = [
    { key: "games", label: "Lejátszott meccsek", value: stats.games },
    { key: "wins", label: "Győzelmek", value: stats.wins },
    { key: "losses", label: "Vereségek", value: stats.losses },
    { key: "draws", label: "Döntetlenek", value: stats.draws },
    { key: "winrate", label: "Győzelmi arány %", value: Math.round((Number(stats.wins) / games) * 100) },
    { key: "pvp_wins", label: "PvP győzelmek", value: stats.pvp_wins },
    { key: "pvp_losses", label: "PvP vereségek", value: stats.pvp_losses },
    { key: "ai_wins", label: "Bot elleni győzelmek", value: stats.ai_wins },
    { key: "ai_losses", label: "Bot elleni vereségek", value: stats.ai_losses },
    { key: "best_score", label: "Legjobb meccspont", value: stats.best_score },
    { key: "worst_score", label: "Leggyengébb meccspont", value: stats.worst_score },
    { key: "avg_score", label: "Átlagpont", value: Math.round(Number(stats.total_score) / games) },
    { key: "total_score", label: "Összpont", value: stats.total_score },
    { key: "bingos", label: "Bingók (7 betű)", value: stats.bingos },
    { key: "best_move", label: "Legnagyobb lépéspont", value: stats.best_move_score },
    { key: "longest_word", label: "Leghosszabb szó", value: stats.longest_word ?? "—" },
    { key: "passes", label: "Passzok", value: stats.passes },
    { key: "timeouts", label: "Időtúllépések", value: stats.timeouts },
    { key: "blanks", label: "Jolly használat", value: stats.blank_uses },
    { key: "words_added", label: "Felvett saját szavak", value: stats.words_added },
    { key: "play_hours", label: "Játszott órák", value: Math.round((Number(stats.play_ms) / 3600000) * 10) / 10 },
    { key: "play_min", label: "Játszott percek", value: Math.round(Number(stats.play_ms) / 60000) },
    { key: "avg_game_min", label: "Átlag meccshossz (perc)", value: Math.round(Number(stats.play_ms) / games / 60000) },
    { key: "win_streak", label: "Jelenlegi nyerőszéria", value: stats.win_streak },
    { key: "best_streak", label: "Legjobb nyerőszéria", value: stats.best_win_streak },
    { key: "favorite_opponent", label: "Kedvenc ellenfél", value: stats.favorite_opponent ?? "—" },
    { key: "member_since", label: "Regisztráció", value: new Date(user.created_at).toLocaleDateString("hu-HU") },
  ];

  return { user: { id: user.id, name: user.name, uiScale: user.ui_scale }, stats, curiosities, history };
}

export function appVersion(): string {
  const row = getDb()
    .prepare("SELECT value FROM app_meta WHERE key = 'app_version'")
    .get() as { value: string } | undefined;
  return row?.value ?? APP_VERSION;
}

export function isAdminUser(user: { name: string; is_admin?: number | boolean | null }): boolean {
  if (Number(user.is_admin) === 1 || user.is_admin === true) return true;
  const raw = process.env.ADMIN_NAMES ?? "zsom10";
  const allowed = raw
    .split(",")
    .map((s) => s.trim().toLocaleLowerCase("hu"))
    .filter(Boolean);
  return allowed.includes(user.name.trim().toLocaleLowerCase("hu"));
}

export function isAdminName(name: string): boolean {
  const user = getDb()
    .prepare("SELECT name, is_admin FROM users WHERE name = ? COLLATE NOCASE")
    .get(name.trim()) as { name: string; is_admin?: number } | undefined;
  if (user) return isAdminUser(user);
  const raw = process.env.ADMIN_NAMES ?? "zsom10";
  const allowed = raw
    .split(",")
    .map((s) => s.trim().toLocaleLowerCase("hu"))
    .filter(Boolean);
  return allowed.includes(name.trim().toLocaleLowerCase("hu"));
}

export function adminCreateUser(name: string, password: string, isAdmin = false): UserRow {
  if (name.trim().length < 2) throw new Error("A név legalább 2 karakter.");
  if (password.length < 4) throw new Error("A jelszó legalább 4 karakter.");
  const user = registerUser(name, password);
  if (isAdmin) {
    getDb().prepare("UPDATE users SET is_admin = 1 WHERE id = ?").run(user.id);
  }
  return getUserById(user.id)!;
}

export function adminUpdateUser(
  id: string,
  patch: { name?: string; password?: string; isAdmin?: boolean },
  actorId: string
): UserRow {
  const database = getDb();
  const user = getUserById(id);
  if (!user) throw new Error("Nincs ilyen felhasználó.");
  if (patch.name != null) {
    const name = patch.name.trim();
    if (name.length < 2) throw new Error("A név legalább 2 karakter.");
    try {
      database.prepare("UPDATE users SET name = ? WHERE id = ?").run(name, id);
    } catch {
      throw new Error("Ez a név már foglalt.");
    }
  }
  if (patch.password != null && patch.password.length > 0) {
    if (patch.password.length < 4) throw new Error("A jelszó legalább 4 karakter.");
    database
      .prepare("UPDATE users SET password_hash = ? WHERE id = ?")
      .run(bcrypt.hashSync(patch.password, 10), id);
  }
  if (patch.isAdmin != null) {
    if (id === actorId && !patch.isAdmin) {
      throw new Error("Saját admin jogodat nem veheted el.");
    }
    database
      .prepare("UPDATE users SET is_admin = ? WHERE id = ?")
      .run(patch.isAdmin ? 1 : 0, id);
  }
  return getUserById(id)!;
}

export function adminDeleteUser(id: string, actorId: string): void {
  if (id === actorId) throw new Error("Saját magadat nem törölheted.");
  const database = getDb();
  const user = getUserById(id);
  if (!user) throw new Error("Nincs ilyen felhasználó.");
  database.prepare("DELETE FROM sessions WHERE user_id = ?").run(id);
  database.prepare("DELETE FROM user_stats WHERE user_id = ?").run(id);
  database.prepare("UPDATE user_words SET added_by = NULL WHERE added_by = ?").run(id);
  database.prepare("DELETE FROM users WHERE id = ?").run(id);
}

export function getAdminStats() {
  const database = getDb();
  const count = (sql: string) =>
    Number((database.prepare(sql).get() as { n: number }).n ?? 0);

  const overview = {
    users: count("SELECT COUNT(*) AS n FROM users"),
    games: count("SELECT COUNT(*) AS n FROM games"),
    finishedGames: count("SELECT COUNT(*) AS n FROM games WHERE status = 'finished'"),
    playingGames: count("SELECT COUNT(*) AS n FROM games WHERE status = 'playing'"),
    userWords: count("SELECT COUNT(*) AS n FROM user_words"),
    sessions: count("SELECT COUNT(*) AS n FROM sessions"),
    pvpGames: count("SELECT COUNT(*) AS n FROM games WHERE vs_ai = 0"),
    aiGames: count("SELECT COUNT(*) AS n FROM games WHERE vs_ai = 1"),
  };

  const users = database
    .prepare(
      `SELECT u.id, u.name, COALESCE(u.is_admin, 0) AS is_admin,
              datetime(u.created_at/1000, 'unixepoch', 'localtime') AS created,
              datetime(u.last_seen_at/1000, 'unixepoch', 'localtime') AS last_seen,
              COALESCE(s.games, 0) AS games,
              COALESCE(s.wins, 0) AS wins,
              COALESCE(s.best_score, 0) AS best_score,
              COALESCE(s.words_added, 0) AS words_added
       FROM users u
       LEFT JOIN user_stats s ON s.user_id = u.id
       ORDER BY u.last_seen_at DESC`
    )
    .all();

  const recentGames = database
    .prepare(
      `SELECT g.id, g.status, g.end_mode, g.vs_ai,
              datetime(g.created_at/1000, 'unixepoch', 'localtime') AS created,
              datetime(g.finished_at/1000, 'unixepoch', 'localtime') AS finished,
              (SELECT group_concat(gp.name || ' (' || gp.score || ')', ' · ')
               FROM game_players gp WHERE gp.game_id = g.id) AS players
       FROM games g
       ORDER BY g.created_at DESC
       LIMIT 25`
    )
    .all();

  const words = database
    .prepare(
      `SELECT w.word,
              COALESCE(u.name, '—') AS added_by,
              datetime(w.created_at/1000, 'unixepoch', 'localtime') AS created
       FROM user_words w
       LEFT JOIN users u ON u.id = w.added_by
       ORDER BY w.created_at DESC
       LIMIT 80`
    )
    .all();

  const topPlayers = database
    .prepare(
      `SELECT u.name, s.games, s.wins, s.best_score, s.pvp_wins, s.ai_wins, s.total_score
       FROM user_stats s JOIN users u ON u.id = s.user_id
       WHERE s.games > 0
       ORDER BY s.wins DESC, s.best_score DESC
       LIMIT 15`
    )
    .all();

  const wordsByUser = database
    .prepare(
      `SELECT COALESCE(u.name, 'ismeretlen') AS name, COUNT(*) AS n
       FROM user_words w
       LEFT JOIN users u ON u.id = w.added_by
       GROUP BY COALESCE(u.name, 'ismeretlen')
       ORDER BY n DESC`
    )
    .all();

  return { overview, users, recentGames, words, topPlayers, wordsByUser };
}
