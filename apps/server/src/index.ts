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
};

const clients = new Map<WebSocket, Client>();

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
    res.json(profile);
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
    const t = applyPass(id, user.id);
    maybeBot(t, lexicon);
    res.json(publicTableState(t, user.id));
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

app.post("/api/words", (req, res) => {
  try {
    const user = requireUser(req);
    const words = Array.isArray(req.body?.words) ? req.body.words.map(String) : [];
    const added = addUserWords(words, user.id);
    for (const w of added) lexicon.addWord(w);
    res.json({ added });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
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
  };
  clients.set(ws, client);

  ws.send(JSON.stringify({ type: "hello", user: { id: user.id, name: user.name }, version: APP_VERSION }));

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

  ws.on("close", () => {
    if (client.tableId != null) {
      const t = getTable(client.tableId);
      t?.spectators.delete(client.userId);
    }
    clients.delete(ws);
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
    client.ws.send(JSON.stringify({ type: "state", ...publicTableState(t, client.userId) }));
    return;
  }
  if (type === "resume") {
    const id = Number(msg.tableId);
    const t = resumeTable(id, client.userId);
    client.tableId = id;
    client.spectating = false;
    client.ws.send(JSON.stringify({ type: "state", ...publicTableState(t, client.userId) }));
    return;
  }
  if (type === "spectate") {
    const id = Number(msg.tableId);
    const t = spectateTable(id, client.userId);
    client.tableId = id;
    client.spectating = true;
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
    const t = applyPass(id, client.userId);
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
