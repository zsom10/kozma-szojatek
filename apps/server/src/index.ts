import express from "express";
import cors from "cors";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";
import {
  getDefaultLexicon,
  MoveError,
  APP_VERSION,
  type Lexicon,
  type Placement,
  type BotDifficulty,
  type EndMode,
} from "@szorako/engine";
import {
  getDb,
  registerUser,
  loginUser,
  userFromToken,
  setUiScale,
  getUserWords,
  addUserWords,
  getLeaderboard,
  getUserProfile,
  appVersion,
  isAdminName,
  getAdminStats,
} from "./db.js";
import {
  initTables,
  listTables,
  getTable,
  joinTable,
  resumeTable,
  leaveTable,
  spectateTable,
  configureTable,
  addBotToTable,
  removeBotFromTable,
  startTable,
  applyPlace,
  applyPass,
  applyResign,
  applySwap,
  proposeChallenge,
  voteChallenge,
  cancelChallenge,
  addChatMessage,
  countHumans,
  tickTimeouts,
  maybeBot,
  publicTableState,
  onTableChange,
} from "./tables.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 8787);

getDb();
initTables();
const lexicon: Lexicon = getDefaultLexicon(getUserWords());

type Client = {
  ws: WebSocket;
  userId: string;
  name: string;
  tableId: number | null;
  spectating: boolean;
  available: boolean;
};

const clients = new Map<WebSocket, Client>();

type Invite = {
  fromId: string;
  fromName: string;
  tableId: number;
  at: number;
};

const invites = new Map<string, Invite>();

function broadcastPresence(): void {
  const online = [...clients.values()]
    .filter((c) => c.ws.readyState === WebSocket.OPEN)
    .reduce<
      { userId: string; name: string; available: boolean; tableId: number | null }[]
    >((acc, c) => {
      if (acc.some((x) => x.userId === c.userId)) return acc;
      acc.push({
        userId: c.userId,
        name: c.name,
        available: c.available && c.tableId == null,
        tableId: c.tableId,
      });
      return acc;
    }, []);
  const payload = JSON.stringify({ type: "presence", people: online });
  for (const [ws, client] of clients) {
    if (ws.readyState !== WebSocket.OPEN) continue;
    if (client.tableId != null) continue;
    ws.send(payload);
  }
}

function sendToUser(userId: string, msg: unknown): void {
  const raw = JSON.stringify(msg);
  for (const [ws, client] of clients) {
    if (client.userId === userId && ws.readyState === WebSocket.OPEN) {
      ws.send(raw);
    }
  }
}

function tokenFromReq(req: express.Request): string | null {
  const h = req.headers.authorization;
  if (h?.startsWith("Bearer ")) return h.slice(7);
  const q = req.query.token;
  if (typeof q === "string") return q;
  return null;
}

function requireUser(req: express.Request): NonNullable<ReturnType<typeof userFromToken>> {
  const user = userFromToken(tokenFromReq(req));
  if (!user) throw new Error("Bejelentkezés szükséges.");
  return user;
}

function broadcastTable(tableId: number): void {
  const t = getTable(tableId);
  if (!t) return;
  for (const [ws, client] of clients) {
    if (client.tableId !== tableId || ws.readyState !== WebSocket.OPEN) continue;
    ws.send(
      JSON.stringify({
        type: "state",
        ...publicTableState(t, client.userId, client.spectating),
      })
    );
  }
}

onTableChange((t) => broadcastTable(t.id));

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, version: appVersion(), app: "Kozma Szójáték" });
});

app.post("/api/auth/register", (req, res) => {
  try {
    const name = String(req.body?.name ?? "");
    const password = String(req.body?.password ?? "");
    if (name.trim().length < 2) throw new Error("A név legalább 2 karakter.");
    if (password.length < 4) throw new Error("A jelszó legalább 4 karakter.");
    const user = registerUser(name, password);
    const { token } = loginUser(name, password);
    res.json({
      token,
      user: { id: user.id, name: user.name, uiScale: user.ui_scale },
      version: APP_VERSION,
    });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

app.post("/api/auth/login", (req, res) => {
  try {
    const { user, token } = loginUser(
      String(req.body?.name ?? ""),
      String(req.body?.password ?? "")
    );
    res.json({
      token,
      user: { id: user.id, name: user.name, uiScale: user.ui_scale },
      version: APP_VERSION,
    });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

app.get("/api/me", (req, res) => {
  try {
    const user = requireUser(req);
    const profile = getUserProfile(user.id);
    res.json({
      ...profile,
      isAdmin: isAdminName(user.name),
    });
  } catch (e) {
    res.status(401).json({ error: (e as Error).message });
  }
});

app.get("/api/admin/stats", (req, res) => {
  try {
    const user = requireUser(req);
    if (!isAdminName(user.name)) {
      res.status(403).json({ error: "Nincs admin jog." });
      return;
    }
    res.json(getAdminStats());
  } catch (e) {
    res.status(401).json({ error: (e as Error).message });
  }
});

app.post("/api/me/ui-scale", (req, res) => {
  try {
    const user = requireUser(req);
    const scale = String(req.body?.scale ?? "normal");
    if (!["normal", "large", "xlarge", "xxlarge"].includes(scale)) {
      throw new Error("Érvénytelen méret.");
    }
    setUiScale(user.id, scale);
    res.json({ ok: true, scale });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

app.get("/api/tables", (_req, res) => {
  res.json({ tables: listTables(), version: APP_VERSION });
});

app.post("/api/tables/:id/join", (req, res) => {
  try {
    const user = requireUser(req);
    const id = Number(req.params.id);
    const t = joinTable(id, { id: user.id, name: user.name });
    res.json(publicTableState(t, user.id));
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

app.post("/api/tables/:id/resume", (req, res) => {
  try {
    const user = requireUser(req);
    const id = Number(req.params.id);
    const t = resumeTable(id, user.id);
    res.json(publicTableState(t, user.id, false));
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

app.get("/api/tables/:id", (req, res) => {
  try {
    const user = requireUser(req);
    const t = getTable(Number(req.params.id));
    if (!t) throw new Error("Nincs ilyen asztal.");
    const seated = t.seats.some((s) => s.userId === user.id);
    res.json(publicTableState(t, user.id, !seated && t.spectators.has(user.id)));
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

app.post("/api/tables/:id/place", (req, res) => {
  try {
    const user = requireUser(req);
    const id = Number(req.params.id);
    const placements = req.body?.placements as Placement[];
    const t = applyPlace(id, user.id, placements, lexicon);
    maybeBot(t, lexicon);
    res.json(publicTableState(t, user.id));
  } catch (e) {
    const err = e as Error & { invalidWords?: string[] };
    res.status(400).json({
      error: err.message,
      invalidWords: err instanceof MoveError ? err.invalidWords : undefined,
    });
  }
});

app.post("/api/tables/:id/pass", (req, res) => {
  try {
    const user = requireUser(req);
    const id = Number(req.params.id);
    const exchangeAll = !!req.body?.exchangeAll;
    const t = applyPass(id, user.id, { exchangeAll });
    maybeBot(t, lexicon);
    res.json(publicTableState(t, user.id));
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

app.post("/api/tables/:id/swap-blank", (req, res) => {
  try {
    const user = requireUser(req);
    const id = Number(req.params.id);
    const row = Number(req.body?.row);
    const col = Number(req.body?.col);
    const t = applySwap(id, user.id, row, col);
    broadcastTable(id);
    maybeBot(t, lexicon);
    res.json(publicTableState(t, user.id));
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

app.post("/api/tables/:id/challenge", (req, res) => {
  try {
    const user = requireUser(req);
    const id = Number(req.params.id);
    const placements = req.body?.placements as Placement[];
    const words = Array.isArray(req.body?.words) ? req.body.words.map(String) : [];
    const t = proposeChallenge(id, user.id, placements, words);
    broadcastTable(id);
    res.json(publicTableState(t, user.id));
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

app.post("/api/tables/:id/challenge/vote", (req, res) => {
  try {
    const user = requireUser(req);
    const id = Number(req.params.id);
    const accept = !!req.body?.accept;
    const t = voteChallenge(id, user.id, accept, lexicon);
    broadcastTable(id);
    maybeBot(t, lexicon);
    res.json(publicTableState(t, user.id));
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

app.post("/api/tables/:id/challenge/cancel", (req, res) => {
  try {
    const user = requireUser(req);
    const id = Number(req.params.id);
    const t = cancelChallenge(id, user.id);
    broadcastTable(id);
    res.json(publicTableState(t, user.id));
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

app.post("/api/tables/:id/chat", (req, res) => {
  try {
    const user = requireUser(req);
    const id = Number(req.params.id);
    const t = addChatMessage(id, user.id, user.name, String(req.body?.text ?? ""));
    broadcastTable(id);
    res.json(publicTableState(t, user.id));
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

app.post("/api/words", (req, res) => {
  try {
    const user = requireUser(req);
    const words = Array.isArray(req.body?.words) ? req.body.words.map(String) : [];
    const tableId = req.body?.tableId != null ? Number(req.body.tableId) : null;
    if (tableId) {
      const t = getTable(tableId);
      if (t?.game && countHumans(t.game) > 1) {
        throw new Error("Több játékosnál a többieknek el kell fogadniuk a szót.");
      }
    }
    const added = addUserWords(words, user.id);
    for (const w of added) lexicon.addWord(w);
    res.json({ added });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

app.post("/api/tables/:id/resign", (req, res) => {
  try {
    const user = requireUser(req);
    const id = Number(req.params.id);
    const t = applyResign(id, user.id);
    maybeBot(t, lexicon);
    res.json(publicTableState(t, user.id));
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

app.post("/api/tables/:id/leave", (req, res) => {
  try {
    const user = requireUser(req);
    leaveTable(Number(req.params.id), user.id);
    res.json({ ok: true, tables: listTables() });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

app.post("/api/tables/:id/spectate", (req, res) => {
  try {
    const user = requireUser(req);
    const t = spectateTable(Number(req.params.id), user.id);
    res.json(publicTableState(t, user.id, true));
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

app.post("/api/tables/:id/config", (req, res) => {
  try {
    const user = requireUser(req);
    const t = configureTable(Number(req.params.id), user.id, {
      endMode: req.body?.endMode as EndMode | undefined,
      turnSeconds: req.body?.turnSeconds
        ? Number(req.body.turnSeconds)
        : undefined,
    });
    broadcastTable(t.id);
    res.json(publicTableState(t, user.id));
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

app.post("/api/tables/:id/bot", (req, res) => {
  try {
    const user = requireUser(req);
    const difficulty = (req.body?.difficulty ?? "medium") as BotDifficulty;
    const t = addBotToTable(Number(req.params.id), user.id, difficulty);
    broadcastTable(t.id);
    res.json(publicTableState(t, user.id));
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

app.post("/api/tables/:id/bot/remove", (req, res) => {
  try {
    const user = requireUser(req);
    const botUserId = String(req.body?.botUserId ?? "");
    const t = removeBotFromTable(Number(req.params.id), user.id, botUserId);
    broadcastTable(t.id);
    res.json(publicTableState(t, user.id));
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

app.post("/api/tables/:id/start", (req, res) => {
  try {
    const user = requireUser(req);
    const t = startTable(Number(req.params.id), user.id);
    broadcastTable(t.id);
    maybeBot(t, lexicon);
    res.json(publicTableState(t, user.id));
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

app.get("/api/leaderboard", (_req, res) => {
  res.json(getLeaderboard());
});

const webDist = path.resolve(__dirname, "../../web/dist");
app.use(express.static(webDist));
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api") || req.path.startsWith("/ws")) return next();
  res.sendFile(path.join(webDist, "index.html"), (err) => {
    if (err) next();
  });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws, req) => {
  const url = new URL(req.url ?? "", `http://${req.headers.host}`);
  const token = url.searchParams.get("token");
  const user = userFromToken(token);
  if (!user) {
    ws.close(4401, "auth");
    return;
  }
  const client: Client = {
    ws,
    userId: user.id,
    name: user.name,
    tableId: null,
    spectating: false,
    available: true,
  };
  clients.set(ws, client);

  ws.send(JSON.stringify({ type: "hello", user: { id: user.id, name: user.name }, version: APP_VERSION }));
  broadcastPresence();
  const inv = invites.get(user.id);
  if (inv) {
    ws.send(JSON.stringify({ type: "invite", invite: inv }));
  }

  ws.on("close", () => {
    if (client.tableId != null) {
      const t = getTable(client.tableId);
      t?.spectators.delete(client.userId);
    }
    clients.delete(ws);
    broadcastPresence();
  });

  ws.on("message", (raw) => {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    try {
      handleWs(client, msg);
    } catch (e) {
      const err = e as Error & { invalidWords?: string[] };
      ws.send(
        JSON.stringify({
          type: "error",
          error: err.message,
          invalidWords: err instanceof MoveError ? err.invalidWords : undefined,
        })
      );
    }
  });
});

function handleWs(client: Client, msg: Record<string, unknown>): void {
  const type = String(msg.type ?? "");
  if (type === "list") {
    client.ws.send(JSON.stringify({ type: "tables", tables: listTables() }));
    return;
  }
  if (type === "join") {
    const id = Number(msg.tableId);
    let t;
    try {
      t = joinTable(id, { id: client.userId, name: client.name });
    } catch {
      t = resumeTable(id, client.userId);
    }
    client.tableId = id;
    client.spectating = false;
    broadcastTable(id);
    broadcastPresence();
    client.ws.send(JSON.stringify({ type: "state", ...publicTableState(t, client.userId) }));
    return;
  }
  if (type === "resume") {
    const id = Number(msg.tableId);
    const t = resumeTable(id, client.userId);
    client.tableId = id;
    client.spectating = false;
    broadcastPresence();
    client.ws.send(JSON.stringify({ type: "state", ...publicTableState(t, client.userId) }));
    return;
  }
  if (type === "spectate") {
    const id = Number(msg.tableId);
    const t = spectateTable(id, client.userId);
    client.tableId = id;
    client.spectating = true;
    broadcastPresence();
    client.ws.send(
      JSON.stringify({ type: "state", ...publicTableState(t, client.userId, true) })
    );
    return;
  }
  if (type === "leave") {
    if (client.tableId != null) {
      leaveTable(client.tableId, client.userId);
      broadcastTable(client.tableId);
      client.tableId = null;
      client.spectating = false;
    }
    broadcastPresence();
    client.ws.send(JSON.stringify({ type: "tables", tables: listTables() }));
    return;
  }
  if (type === "config") {
    const id = Number(msg.tableId);
    const t = configureTable(id, client.userId, {
      endMode: msg.endMode as EndMode | undefined,
      turnSeconds: msg.turnSeconds ? Number(msg.turnSeconds) : undefined,
    });
    broadcastTable(id);
    client.ws.send(JSON.stringify({ type: "state", ...publicTableState(t, client.userId) }));
    return;
  }
  if (type === "addBot") {
    const id = Number(msg.tableId);
    const t = addBotToTable(
      id,
      client.userId,
      (msg.difficulty as BotDifficulty) ?? "medium"
    );
    broadcastTable(id);
    client.ws.send(JSON.stringify({ type: "state", ...publicTableState(t, client.userId) }));
    return;
  }
  if (type === "removeBot") {
    const id = Number(msg.tableId);
    const t = removeBotFromTable(id, client.userId, String(msg.botUserId ?? ""));
    broadcastTable(id);
    client.ws.send(JSON.stringify({ type: "state", ...publicTableState(t, client.userId) }));
    return;
  }
  if (type === "start") {
    const id = Number(msg.tableId);
    const t = startTable(id, client.userId);
    broadcastTable(id);
    maybeBot(t, lexicon);
    return;
  }
  if (type === "place") {
    if (client.spectating) throw new Error("Nézőként nem léphetsz.");
    const id = Number(msg.tableId ?? client.tableId);
    const placements = msg.placements as Placement[];
    const t = applyPlace(id, client.userId, placements, lexicon);
    broadcastTable(id);
    maybeBot(t, lexicon);
    return;
  }
  if (type === "pass") {
    if (client.spectating) throw new Error("Nézőként nem léphetsz.");
    const id = Number(msg.tableId ?? client.tableId);
    const t = applyPass(id, client.userId, { exchangeAll: !!msg.exchangeAll });
    broadcastTable(id);
    maybeBot(t, lexicon);
    return;
  }
  if (type === "resign") {
    if (client.spectating) throw new Error("Nézőként nem léphetsz.");
    const id = Number(msg.tableId ?? client.tableId);
    const t = applyResign(id, client.userId);
    broadcastTable(id);
    maybeBot(t, lexicon);
    return;
  }
  if (type === "swapBlank") {
    if (client.spectating) throw new Error("Nézőként nem léphetsz.");
    const id = Number(msg.tableId ?? client.tableId);
    const t = applySwap(id, client.userId, Number(msg.row), Number(msg.col));
    broadcastTable(id);
    maybeBot(t, lexicon);
    return;
  }
  if (type === "chat") {
    const id = Number(msg.tableId ?? client.tableId);
    addChatMessage(id, client.userId, client.name, String(msg.text ?? ""));
    broadcastTable(id);
    return;
  }
  if (type === "setAvailable") {
    client.available = !!msg.available;
    broadcastPresence();
    return;
  }
  if (type === "invite") {
    const toUserId = String(msg.toUserId ?? "");
    const tableId = Number(msg.tableId);
    if (!toUserId || !tableId) throw new Error("Hiányzó meghívó adat.");
    const t = getTable(tableId);
    if (!t) throw new Error("Nincs ilyen asztal.");
    if (t.hostUserId !== client.userId && !t.seats.some((s) => s.userId === client.userId)) {
      throw new Error("Csak asztalnál ülő hívhat.");
    }
    if (t.status === "playing") throw new Error("Már zajlik a meccs.");
    const invite = {
      fromId: client.userId,
      fromName: client.name,
      tableId,
      at: Date.now(),
    };
    invites.set(toUserId, invite);
    sendToUser(toUserId, { type: "invite", invite });
    return;
  }
  if (type === "inviteDismiss") {
    invites.delete(client.userId);
    return;
  }
}

setInterval(() => {
  const changed = tickTimeouts(lexicon);
  for (const id of changed) {
    const t = getTable(id);
    if (t) {
      broadcastTable(id);
      maybeBot(t, lexicon);
    }
  }
}, 1000);

setInterval(() => {
  for (const [ws, client] of clients) {
    if (client.tableId == null && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "tables", tables: listTables() }));
    }
  }
}, 3000);

server.listen(PORT, () => {
  console.log(`Kozma Szójáték ${APP_VERSION} :${PORT}`);
});

process.on("uncaughtException", (err) => {
  console.error("uncaughtException (szerver él tovább):", err);
});

process.on("unhandledRejection", (err) => {
  console.error("unhandledRejection:", err);
});
