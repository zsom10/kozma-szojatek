import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  BotDifficulty,
  EndMode,
  PublicGameState,
} from "@szorako/engine/browser";
import { DIGRAPHS } from "@szorako/engine/browser";
import {
  currentPlayer,
  draftsToPlacements,
  formatTime,
  premiumClass,
  premiumLabel,
  premiums,
  tilePoints,
  type DraftTile,
} from "./gameUi";
import { ConfettiBurst, TurnBanner } from "./fx";

type Screen = "auth" | "lobby" | "table" | "account" | "leaderboard" | "settings";
type UiScale = "normal" | "large" | "xlarge" | "xxlarge";
const BOARD_SCALE_KEY = "kozma.boardScale";
const SCALE_STEPS: { id: UiScale; label: string }[] = [
  { id: "normal", label: "Kicsi" },
  { id: "large", label: "Közepes" },
  { id: "xlarge", label: "Nagy" },
  { id: "xxlarge", label: "Hatalmas" },
];

type AuthUser = { id: string; name: string; uiScale: UiScale };

type TableSummary = {
  id: number;
  status: string;
  endMode: EndMode;
  turnSeconds: number;
  hostUserId: string | null;
  players: { userId: string; name: string; isBot: boolean }[];
  spectatorCount: number;
};

type TableSeat = {
  userId: string;
  name: string;
  isBot: boolean;
  botDifficulty?: BotDifficulty;
};

type Curiosity = { key: string; label: string; value: unknown };
type HistoryRow = {
  id: string;
  vs_ai: number;
  finished_at: number | null;
  end_mode: string;
  score: number;
  won: number;
  opponents: string | null;
};

const SESSION_KEY = "kozma.session";
const SCALE_KEY = "kozma.uiScale";

function wsUrl(token: string): string {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}/ws?token=${encodeURIComponent(token)}`;
}

function apiBase(): string {
  return "";
}

function loadAuth(): { token: string; user: AuthUser } | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.token || !parsed?.user?.id || !parsed?.user?.name) {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
    return parsed;
  } catch {
    localStorage.removeItem(SESSION_KEY);
    return null;
  }
}

function saveAuth(token: string, user: AuthUser) {
  localStorage.setItem(SESSION_KEY, JSON.stringify({ token, user }));
}

function clearAuth() {
  localStorage.removeItem(SESSION_KEY);
}

function blankChoices(): string[] {
  const singles = "AÁBCDEÉFGHIÍJKLMNOÓÖŐPQRSTUÚÜŰVWXYZ".split("");
  return [...singles, ...DIGRAPHS];
}

function endModeLabel(mode: EndMode): string {
  return mode === "A" ? "Klasszikus" : "Folytatásos";
}

function endModeHint(mode: EndMode): string {
  return mode === "A"
    ? "Az első tartókiürítéskor vége a partinak."
    : "Aki kiüríti a tartóját vagy felad, kiesik; a többiek játszanak tovább. A Passz csak kihagyja a kört.";
}

export function App() {
  const [auth, setAuth] = useState(loadAuth);
  const [screen, setScreen] = useState<Screen>(auth ? "lobby" : "auth");
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [nameInput, setNameInput] = useState("");
  const [passInput, setPassInput] = useState("");
  const [ready, setReady] = useState(false);
  const [tables, setTables] = useState<TableSummary[]>([]);
  const [tableMeta, setTableMeta] = useState<{
    id: number;
    status: string;
    endMode: EndMode;
    turnSeconds: number;
    hostUserId: string | null;
    seats: TableSeat[];
    spectatorCount: number;
  } | null>(null);
  const [state, setState] = useState<PublicGameState | null>(null);
  const [spectating, setSpectating] = useState(false);
  const [error, setError] = useState("");
  const [invalidWords, setInvalidWords] = useState<string[]>([]);
  const [difficulty, setDifficulty] = useState<BotDifficulty>("medium");
  const [selectedRack, setSelectedRack] = useState<number | null>(null);
  const [drafts, setDrafts] = useState<DraftTile[]>([]);
  const [blankLetter, setBlankLetter] = useState("A");
  const [now, setNow] = useState(Date.now());
  const [version, setVersion] = useState("1.0.0");
  const [uiScale, setUiScale] = useState<UiScale>(() => {
    const raw = (localStorage.getItem(SCALE_KEY) ||
      localStorage.getItem(BOARD_SCALE_KEY) ||
      auth?.user.uiScale ||
      "large") as UiScale;
    return SCALE_STEPS.some((s) => s.id === raw) ? raw : "large";
  });
  const [lbTab, setLbTab] = useState<"score" | "pvp" | "ai">("score");
  const [leaderboard, setLeaderboard] = useState<{
    byScore: Record<string, unknown>[];
    byPvp: Record<string, unknown>[];
    byAi: Record<string, unknown>[];
  }>({ byScore: [], byPvp: [], byAi: [] });
  const [profile, setProfile] = useState<{
    curiosities: Curiosity[];
    history: HistoryRow[];
  } | null>(null);
  const [dragRack, setDragRack] = useState<number | null>(null);
  const [swapMode, setSwapMode] = useState(false);
  const [busy, setBusy] = useState("");
  const [activeTableId, setActiveTableId] = useState<number | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const token = auth?.token;
  const user = auth?.user;

  useEffect(() => {
    document.documentElement.dataset.scale = uiScale;
    localStorage.setItem(SCALE_KEY, uiScale);
  }, [uiScale]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);

  const api = useCallback(
    async (path: string, init?: RequestInit) => {
      const res = await fetch(`${apiBase()}${path}`, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(init?.headers ?? {}),
        },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err = new Error(data.error || "Hiba") as Error & {
          invalidWords?: string[];
        };
        if (Array.isArray(data.invalidWords)) err.invalidWords = data.invalidWords;
        throw err;
      }
      return data;
    },
    [token]
  );

  const refreshTables = useCallback(async () => {
    try {
      const data = await api("/api/tables");
      setTables(data.tables ?? []);
      if (data.version) setVersion(data.version);
    } catch {
      /* ignore */
    }
  }, [api]);

  const refreshLeaderboard = useCallback(async () => {
    try {
      const data = await api("/api/leaderboard");
      setLeaderboard(data);
    } catch {
      /* ignore */
    }
  }, [api]);

  const refreshProfile = useCallback(async () => {
    if (!token) return;
    try {
      const data = await api("/api/me");
      setProfile({ curiosities: data.curiosities ?? [], history: data.history ?? [] });
      if (data.user?.uiScale) setUiScale(data.user.uiScale);
    } catch {
      /* ignore */
    }
  }, [api, token]);

  async function doAuth() {
    setError("");
    try {
      const path = authMode === "login" ? "/api/auth/login" : "/api/auth/register";
      const data = await api(path, {
        method: "POST",
        body: JSON.stringify({ name: nameInput, password: passInput }),
      });
      const nextUser: AuthUser = {
        id: data.user.id,
        name: data.user.name,
        uiScale: data.user.uiScale || "normal",
      };
      saveAuth(data.token, nextUser);
      setAuth({ token: data.token, user: nextUser });
      setUiScale(nextUser.uiScale);
      setVersion(data.version ?? "1.0.0");
      setScreen("lobby");
      setPassInput("");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function logout() {
    clearAuth();
    setAuth(null);
    setReady(false);
    setScreen("auth");
    setState(null);
    setTableMeta(null);
  }

  useEffect(() => {
    if (!token) return;
    const socket = new WebSocket(wsUrl(token));
    wsRef.current = socket;
    socket.onopen = () => setReady(true);
    socket.onclose = () => {
      setReady(false);
      if (wsRef.current === socket) wsRef.current = null;
    };
    socket.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === "hello") {
        if (msg.version) setVersion(msg.version);
        socket.send(JSON.stringify({ type: "list" }));
        return;
      }
      if (msg.type === "tables") {
        setTables(msg.tables ?? []);
        return;
      }
      if (msg.type === "state") {
        if (msg.table) {
          setTableMeta(msg.table);
          setActiveTableId(msg.table.id);
        }
        const next = msg.game ?? null;
        setState((prev) => {
          if (prev && next && prev.moveCount === next.moveCount) return prev;
          if (!prev || !next || prev.moveCount !== next.moveCount) {
            queueMicrotask(() => {
              setDrafts([]);
              setSelectedRack(null);
              setInvalidWords([]);
            });
          }
          return next;
        });
        setError("");
        if (msg.game?.status === "finished") {
          refreshLeaderboard();
          refreshProfile();
        }
        return;
      }
      if (msg.type === "error") {
        setError(msg.error ?? "Hiba");
        setInvalidWords(Array.isArray(msg.invalidWords) ? msg.invalidWords : []);
      }
    };
    return () => {
      socket.close();
      if (wsRef.current === socket) wsRef.current = null;
    };
  }, [token, refreshLeaderboard, refreshProfile]);

  useEffect(() => {
    if (screen === "lobby") refreshTables();
    if (screen === "leaderboard") refreshLeaderboard();
    if (screen === "account") refreshProfile();
  }, [screen, refreshTables, refreshLeaderboard, refreshProfile]);

  useEffect(() => {
    if (screen !== "table" || activeTableId == null) return;
    if (state?.status !== "playing" && tableMeta?.status !== "playing") return;
    let dead = false;
    const tick = async () => {
      try {
        const data = await api(`/api/tables/${activeTableId}`);
        if (dead || !data.game) return;
        setTableMeta(data.table);
        setState((prev: PublicGameState | null) => {
          if (prev && prev.moveCount === data.game.moveCount) return prev;
          queueMicrotask(() => {
            setDrafts([]);
            setSelectedRack(null);
          });
          return data.game;
        });
      } catch {
        /* ignore */
      }
    };
    const id = setInterval(tick, 1200);
    return () => {
      dead = true;
      clearInterval(id);
    };
  }, [screen, activeTableId, state?.status, tableMeta?.status, api]);

  const me = state?.players.find((p) => p.id === user?.id);
  const myRack = me?.rack ?? [];
  const usedRack = new Set(drafts.map((d) => d.rackIndex));
  const isMyTurn =
    !!state &&
    !spectating &&
    state.status === "playing" &&
    currentPlayer(state)?.id === user?.id &&
    !currentPlayer(state)?.eliminated;

  const iWon =
    !!state &&
    state.status === "finished" &&
    !!user &&
    state.winnerIds.includes(user.id);

  const remainingMs = useMemo(() => {
    if (!state?.turnDeadlineAt) return 0;
    return state.turnDeadlineAt - now;
  }, [state?.turnDeadlineAt, now]);

  function send(payload: Record<string, unknown>) {
    const socket = wsRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      setError("Nincs élő kapcsolat — próbáld újra, vagy frissítsd az oldalt.");
      return;
    }
    socket.send(JSON.stringify(payload));
  }

  function applyTablePayload(
    data: { table?: NonNullable<typeof tableMeta>; game?: PublicGameState | null },
    asSpectator: boolean
  ) {
    if (!data.table) {
      setError("Érvénytelen szerverválasz.");
      return;
    }
    setSpectating(asSpectator);
    setTableMeta(data.table);
    setState(data.game ?? null);
    setActiveTableId(data.table.id);
    setScreen("table");
    setError("");
    setInvalidWords([]);
    setDrafts([]);
    setSelectedRack(null);
  }

  function wsAttach(type: "join" | "spectate" | "resume", tableId: number) {
    const socket = wsRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type, tableId }));
    }
  }

  async function joinTableClick(tableId: number) {
    if (!token) {
      setError("Előbb jelentkezz be.");
      setScreen("auth");
      return;
    }
    setBusy(`join-${tableId}`);
    setError("");
    try {
      const data = await api(`/api/tables/${tableId}/join`, { method: "POST" });
      applyTablePayload(data, false);
      wsAttach("join", tableId);
    } catch (e) {
      setError((e as Error).message || "Csatlakozás sikertelen.");
    } finally {
      setBusy("");
    }
  }

  async function resumeTableClick(tableId: number) {
    if (!token) {
      setError("Előbb jelentkezz be.");
      setScreen("auth");
      return;
    }
    setBusy(`resume-${tableId}`);
    setError("");
    try {
      const data = await api(`/api/tables/${tableId}/resume`, { method: "POST" });
      applyTablePayload(data, false);
      wsAttach("resume", tableId);
    } catch (e) {
      setError((e as Error).message || "Visszatérés sikertelen.");
    } finally {
      setBusy("");
    }
  }

  async function spectateTableClick(tableId: number) {
    if (!token) {
      setError("Előbb jelentkezz be.");
      setScreen("auth");
      return;
    }
    setBusy(`spec-${tableId}`);
    setError("");
    try {
      const data = await api(`/api/tables/${tableId}/spectate`, { method: "POST" });
      applyTablePayload(data, true);
      wsAttach("spectate", tableId);
    } catch (e) {
      setError((e as Error).message || "Nézés sikertelen.");
    } finally {
      setBusy("");
    }
  }

  async function leaveTableClick() {
    if (!tableMeta) return;
    const playing = tableMeta.status === "playing" || state?.status === "playing";
    if (playing) {
      setScreen("lobby");
      setBusy("");
      refreshTables();
      return;
    }
    setBusy("leave");
    try {
      await api(`/api/tables/${tableMeta.id}/leave`, { method: "POST" });
    } catch {
      /* local leave anyway */
    }
    send({ type: "leave" });
    setScreen("lobby");
    setState(null);
    setTableMeta(null);
    setActiveTableId(null);
    setSpectating(false);
    setBusy("");
    refreshTables();
  }

  async function submitPlace() {
    if (!tableMeta || drafts.length === 0) return;
    setError("");
    setInvalidWords([]);
    try {
      const data = await api(`/api/tables/${tableMeta.id}/place`, {
        method: "POST",
        body: JSON.stringify({ placements: draftsToPlacements(drafts) }),
      });
      applyTablePayload(data, false);
      wsAttach("resume", tableMeta.id);
    } catch (e) {
      const err = e as Error & { invalidWords?: string[] };
      setError(err.message);
      if (Array.isArray(err.invalidWords)) setInvalidWords(err.invalidWords);
    }
  }

  async function submitPass() {
    if (!tableMeta) return;
    try {
      const data = await api(`/api/tables/${tableMeta.id}/pass`, { method: "POST" });
      applyTablePayload(data, false);
      wsAttach("resume", tableMeta.id);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function submitResign() {
    if (!tableMeta) return;
    if (!confirm("Feladod a partit? A megmaradt betűid pontja levonódik, és kiestél.")) {
      return;
    }
    try {
      const data = await api(`/api/tables/${tableMeta.id}/resign`, { method: "POST" });
      applyTablePayload(data, false);
      wsAttach("resume", tableMeta.id);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function configTable(patch: { endMode?: EndMode; turnSeconds?: number }) {
    if (!tableMeta) return;
    try {
      const data = await api(`/api/tables/${tableMeta.id}/config`, {
        method: "POST",
        body: JSON.stringify(patch),
      });
      applyTablePayload(data, spectating);
      wsAttach("join", tableMeta.id);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function addBotClick() {
    if (!tableMeta) return;
    setBusy("bot");
    try {
      const data = await api(`/api/tables/${tableMeta.id}/bot`, {
        method: "POST",
        body: JSON.stringify({ difficulty }),
      });
      applyTablePayload(data, false);
      wsAttach("join", tableMeta.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function removeBotClick(botUserId: string) {
    if (!tableMeta) return;
    setBusy(`rm-${botUserId}`);
    try {
      const data = await api(`/api/tables/${tableMeta.id}/bot/remove`, {
        method: "POST",
        body: JSON.stringify({ botUserId }),
      });
      applyTablePayload(data, false);
      wsAttach("resume", tableMeta.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function saveScale(scale: UiScale) {
    setUiScale(scale);
    try {
      await api("/api/me/ui-scale", {
        method: "POST",
        body: JSON.stringify({ scale }),
      });
    } catch {
      /* local ok */
    }
  }

  async function startTableClick() {
    if (!tableMeta) return;
    setBusy("start");
    try {
      const data = await api(`/api/tables/${tableMeta.id}/start`, {
        method: "POST",
      });
      applyTablePayload(data, false);
      wsAttach("resume", tableMeta.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  function placeOnCell(row: number, col: number, rackIndex: number) {
    if (!isMyTurn || !state) return;
    if (state.board[row][col]) return;
    if (drafts.some((d) => d.row === row && d.col === col)) return;
    if (usedRack.has(rackIndex)) return;
    const letterRaw = myRack[rackIndex];
    if (!letterRaw) return;
    const isBlank = letterRaw === "?";
    const letter = isBlank ? blankLetter.toUpperCase() : letterRaw;
    setDrafts((d) => [...d, { rackIndex, letter, isBlank, row, col }]);
    setSelectedRack(null);
    setError("");
    setInvalidWords([]);
  }

  function onCellClick(row: number, col: number) {
    if (!isMyTurn || !state) return;
    if (swapMode) {
      const cell = state.board[row][col];
      if (cell?.isBlank) {
        send({
          type: "swapBlank",
          tableId: tableMeta?.id,
          row,
          col,
        });
        setSwapMode(false);
      }
      return;
    }
    const existing = state.board[row][col];
    if (existing) return;
    const draftHere = drafts.find((d) => d.row === row && d.col === col);
    if (draftHere) {
      setDrafts((d) => d.filter((x) => !(x.row === row && x.col === col)));
      return;
    }
    if (selectedRack == null) return;
    placeOnCell(row, col, selectedRack);
  }

  useEffect(() => {
    if (screen !== "table" || !isMyTurn) return;
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      const used = new Set(drafts.map((d) => d.rackIndex));
      if (e.key >= "1" && e.key <= "7") {
        const idx = Number(e.key) - 1;
        if (idx < myRack.length && !used.has(idx)) {
          setSelectedRack(idx);
        }
        return;
      }
      if (e.key === "Escape") {
        setDrafts([]);
        setSelectedRack(null);
        setSwapMode(false);
        return;
      }
      if (e.key === "Enter" && drafts.length > 0) {
        e.preventDefault();
        void submitPlace();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [screen, isMyTurn, myRack.length, drafts, tableMeta?.id]);

  async function acceptWords() {
    try {
      await api("/api/words", {
        method: "POST",
        body: JSON.stringify({ words: invalidWords }),
      });
      await submitPlace();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (!auth || screen === "auth") {
    return (
      <div className="app shell">
        <header className="hero">
          <h1 className="brand">Kozma Szójáték</h1>
          <p className="tagline">Családi magyar szókirakós — fiókkal, asztalokkal, ranglistával.</p>
        </header>
        <section className="panel auth-panel">
          <div className="tabs">
            <button
              className={authMode === "login" ? "" : "secondary"}
              type="button"
              onClick={() => setAuthMode("login")}
            >
              Belépés
            </button>
            <button
              className={authMode === "register" ? "" : "secondary"}
              type="button"
              onClick={() => setAuthMode("register")}
            >
              Regisztráció
            </button>
          </div>
          <div className="field">
            <label>Név</label>
            <input value={nameInput} onChange={(e) => setNameInput(e.target.value)} autoComplete="username" />
          </div>
          <div className="field">
            <label>Jelszó</label>
            <input
              type="password"
              value={passInput}
              onChange={(e) => setPassInput(e.target.value)}
              autoComplete={authMode === "login" ? "current-password" : "new-password"}
            />
          </div>
          <button type="button" onClick={doAuth}>
            {authMode === "login" ? "Belépés" : "Fiók létrehozása"}
          </button>
          {error && <p className="error">{error}</p>}
        </section>
        <footer className="footer">v{version}</footer>
      </div>
    );
  }

  return (
    <div className="app shell">
      <header className="topbar">
        <div>
          <h1 className="brand brand-sm">Kozma Szójáték</h1>
          <p className="meta">{user?.name}{ready ? "" : " · kapcsolat…"}</p>
        </div>
        <nav className="nav">
          <button className="secondary" type="button" onClick={() => setScreen("lobby")}>
            Asztalok
          </button>
          <button className="secondary" type="button" onClick={() => setScreen("account")}>
            Fiókom
          </button>
          <button className="secondary" type="button" onClick={() => setScreen("leaderboard")}>
            Ranglista
          </button>
          <button className="secondary" type="button" onClick={() => setScreen("settings")}>
            Beállítások
          </button>
          <button className="secondary" type="button" onClick={logout}>
            Kilépés
          </button>
        </nav>
      </header>

      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}

      {screen === "lobby" && (
        <section className="tables-grid">
          {tables.map((t) => (
            <article key={t.id} className={`table-card status-${t.status}`}>
              <h2>Asztal {t.id}</h2>
              <p className="meta">
                {t.status === "empty" && "Üres"}
                {t.status === "lobby" && "Várakozik"}
                {t.status === "playing" && "Zajlik"}
                {t.status === "finished" && "Vége"}
                {" · "}
                {endModeLabel(t.endMode)} · {t.turnSeconds}s
              </p>
              <ul className="seat-list">
                {t.players.length === 0 && <li className="meta">Nincs játékos</li>}
                {t.players.map((p) => (
                  <li key={p.userId}>
                    {p.name}
                  </li>
                ))}
              </ul>
              <div className="actions">
                {t.players.some((p) => p.userId === user?.id) &&
                  (t.status === "playing" || t.status === "lobby") && (
                  <button
                    type="button"
                    disabled={!!busy}
                    onClick={() => resumeTableClick(t.id)}
                  >
                    {busy === `resume-${t.id}` ? "Belépés…" : "Vissza a játékba"}
                  </button>
                )}
                {(t.status === "empty" || t.status === "lobby" || t.status === "finished") &&
                  !t.players.some((p) => p.userId === user?.id) && (
                  <button
                    type="button"
                    disabled={!!busy}
                    onClick={() => joinTableClick(t.id)}
                  >
                    {busy === `join-${t.id}` ? "Csatlakozás…" : "Beülök"}
                  </button>
                )}
                {t.status === "playing" &&
                  !t.players.some((p) => p.userId === user?.id) && (
                  <button
                    className="secondary"
                    type="button"
                    disabled={!!busy}
                    onClick={() => spectateTableClick(t.id)}
                  >
                    {busy === `spec-${t.id}` ? "Belépés…" : `Nézés (${t.spectatorCount})`}
                  </button>
                )}
                {t.status === "finished" && (
                  <button
                    className="secondary"
                    type="button"
                    disabled={!!busy}
                    onClick={() => spectateTableClick(t.id)}
                  >
                    Eredmény
                  </button>
                )}
              </div>
            </article>
          ))}
        </section>
      )}

      {screen === "account" && profile && (
        <div className="split">
          <section className="panel">
            <h2 className="panel-title">Statisztikák</h2>
            <div className="stats-grid">
              {profile.curiosities.map((c) => (
                <div key={c.key} className="stat">
                  <span className="meta">{c.label}</span>
                  <strong>{String(c.value ?? "—")}</strong>
                </div>
              ))}
            </div>
          </section>
          <section className="panel">
            <h2 className="panel-title">Meccstörténet</h2>
            <div className="player-list">
              {profile.history.length === 0 && <p className="meta">Még nincs befejezett meccs.</p>}
              {profile.history.map((h) => (
                <div className="player-row" key={`${h.id}-${h.finished_at}`}>
                  <span>
                    {h.won ? "Győzelem" : "Vereség"} · {h.vs_ai ? "AI" : "PvP"} ·{" "}
                    {h.opponents || "—"}
                  </span>
                  <strong>{h.score} pont</strong>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}

      {screen === "leaderboard" && (
        <section className="panel">
          <div className="tabs">
            <button className={lbTab === "score" ? "" : "secondary"} type="button" onClick={() => setLbTab("score")}>
              Legjobb pont
            </button>
            <button className={lbTab === "pvp" ? "" : "secondary"} type="button" onClick={() => setLbTab("pvp")}>
              PvP győzelem
            </button>
            <button className={lbTab === "ai" ? "" : "secondary"} type="button" onClick={() => setLbTab("ai")}>
              AI győzelem
            </button>
          </div>
          <div className="player-list">
            {(lbTab === "score"
              ? leaderboard.byScore
              : lbTab === "pvp"
                ? leaderboard.byPvp
                : leaderboard.byAi
            ).map((row, i) => (
              <div className="player-row" key={`${String(row.name)}-${i}`}>
                <span>
                  {i + 1}. {String(row.name)}
                </span>
                <strong>
                  {lbTab === "score" && `${row.best_score} pont`}
                  {lbTab === "pvp" && `${row.pvp_wins} győzelem`}
                  {lbTab === "ai" && `${row.ai_wins} győzelem`}
                </strong>
              </div>
            ))}
          </div>
        </section>
      )}

      {screen === "settings" && (
        <section className="panel">
          <h2 className="panel-title">Tábla és betű mérete</h2>
          <div className="actions">
            {SCALE_STEPS.map((s) => (
              <button
                key={s.id}
                type="button"
                className={uiScale === s.id ? "" : "secondary"}
                onClick={() => saveScale(s.id)}
              >
                {s.label}
              </button>
            ))}
          </div>
          <p className="meta">
            Meccs közben is állítható a tábla felett. Alapértelmezett: Közepes.
          </p>
          <p className="meta">
            Asztalon: 1–7 billentyű a tartóhoz, Enter lerakás, Escape törlés. Telefonon húzd a zsetont a mezőre.
          </p>
          <h2 className="panel-title" style={{ marginTop: "1.2rem" }}>
            Jolly visszacseréje
          </h2>
          <p className="meta">
            Ha valaki jollyval (üres zsetonnal) rakott le egy betűt, és nálad megvan az a valódi betű,
            saját körödben kicserélheted: a táblán a valódi betű marad, a jolly visszakerül a tartódba.
          </p>
        </section>
      )}

      {screen === "table" && tableMeta && (
        <div className="game-layout">
          <section className="panel">
            <div className="actions" style={{ marginBottom: "0.8rem" }}>
              <button
                className="secondary"
                type="button"
                disabled={busy === "leave"}
                onClick={() => leaveTableClick()}
              >
                {tableMeta.status === "playing" || state?.status === "playing"
                  ? "Asztalok (játék megy)"
                  : "Vissza az asztalokhoz"}
              </button>
              <span className="meta">
                Asztal {tableMeta.id}
                {spectating ? " · néző" : ""}
                {state?.status === "playing" ? ` · zsák: ${state.bagCount}` : ""}
              </span>
              <div className="scale-inline" title="Tábla mérete">
                {SCALE_STEPS.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className={uiScale === s.id ? "" : "secondary"}
                    onClick={() => saveScale(s.id)}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            {(tableMeta.status === "lobby" || tableMeta.status === "empty" || !state || state.status === "lobby") && (
              <div className="waiting-room">
                <h2 className="panel-title">Asztal {tableMeta.id} – váró</h2>
                <p className="meta">
                  {endModeLabel(tableMeta.endMode)} · {tableMeta.turnSeconds} mp / kör
                </p>
                <p className="meta">{endModeHint(tableMeta.endMode)}</p>
                <ul className="seat-list big-seats">
                  {(tableMeta.seats ?? []).map((s) => (
                    <li key={s.userId} className="seat-row">
                      <span>
                        {s.name}
                        {s.userId === tableMeta.hostUserId ? " · hoszt" : ""}
                        {s.userId === user?.id ? " (te)" : ""}
                      </span>
                      {s.isBot && tableMeta.hostUserId === user?.id && (
                        <button
                          className="secondary seat-remove"
                          type="button"
                          disabled={!!busy}
                          onClick={() => removeBotClick(s.userId)}
                        >
                          {busy === `rm-${s.userId}` ? "…" : "Eltávolít"}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
                {tableMeta.hostUserId === user?.id ? (
                  <div className="lobby-controls">
                    <div className="field">
                      <label>Játékvége szabály</label>
                      <select
                        value={tableMeta.endMode}
                        onChange={(e) =>
                          configTable({ endMode: e.target.value as EndMode })
                        }
                      >
                        <option value="B">Folytatásos (ajánlott)</option>
                        <option value="A">Klasszikus</option>
                      </select>
                    </div>
                    <div className="field">
                      <label>Lépésidő (mp)</label>
                      <input
                        type="number"
                        min={30}
                        max={600}
                        defaultValue={tableMeta.turnSeconds}
                        key={`turn-${tableMeta.id}-${tableMeta.turnSeconds}`}
                        onBlur={(e) =>
                          configTable({ turnSeconds: Number(e.target.value) || 180 })
                        }
                      />
                    </div>
                    <div className="field">
                      <label>Bot nehézség</label>
                      <select
                        value={difficulty}
                        onChange={(e) => setDifficulty(e.target.value as BotDifficulty)}
                      >
                        <option value="easy">Könnyű</option>
                        <option value="medium">Közepes</option>
                        <option value="hard">Nehéz</option>
                      </select>
                    </div>
                    <div className="actions">
                      <button
                        className="secondary"
                        type="button"
                        disabled={!!busy}
                        onClick={() => addBotClick()}
                      >
                        Bot hozzáadása
                      </button>
                      <button
                        type="button"
                        disabled={!!busy}
                        onClick={() => startTableClick()}
                      >
                        {busy === "start" ? "Indítás…" : "Indítás"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="meta">Várunk a hosztra, amíg elindítja a partit.</p>
                )}
              </div>
            )}

            {state && (state.status === "playing" || state.status === "finished") && (
              <>
                <div className="board-wrap" ref={boardRef}>
                  <div className="board felt">
                    {state.board.map((row, r) =>
                      row.map((cell, c) => {
                        const draft = drafts.find((d) => d.row === r && d.col === c);
                        const prem = premiums[r][c];
                        const show = cell ?? (draft
                          ? { letter: draft.letter, isBlank: draft.isBlank }
                          : null);
                        return (
                          <div
                            key={`${r}-${c}`}
                            className={`cell ${premiumClass(prem)}`}
                            onClick={() => onCellClick(r, c)}
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={(e) => {
                              e.preventDefault();
                              if (dragRack == null) return;
                              placeOnCell(r, c, dragRack);
                              setDragRack(null);
                            }}
                          >
                            {show ? (
                              <div className={`tile ${draft ? "draft" : ""} ${show.isBlank ? "blank" : ""}`}>
                                {show.isBlank && <span className="jolly-badge">J</span>}
                                <span className="letter">{show.letter}</span>
                                <span className="pts">
                                  {show.isBlank ? tilePoints(show.letter, true) : tilePoints(show.letter, false)}
                                </span>
                              </div>
                            ) : (
                              <span className="prem">{premiumLabel(prem)}</span>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>

                {state.status === "playing" && !spectating && (
                  <>
                    <div className="rack">
                      {myRack.map((letter, i) => (
                        <button
                          key={`${letter}-${i}`}
                          className={`tile rack-tile ${selectedRack === i ? "selected" : ""} ${letter === "?" ? "blank-rack" : ""}`}
                          disabled={usedRack.has(i) || !isMyTurn}
                          draggable={isMyTurn && !usedRack.has(i)}
                          onDragStart={() => setDragRack(i)}
                          onDragEnd={() => setDragRack(null)}
                          onClick={() => setSelectedRack((cur) => (cur === i ? null : i))}
                          type="button"
                          style={{ opacity: usedRack.has(i) ? 0.25 : 1 }}
                        >
                          <span className="keyhint">{i + 1}</span>
                          {letter === "?" ? (
                            <>
                              <span className="jolly-badge">J</span>
                              <span className="letter">★</span>
                              <span className="pts">0</span>
                            </>
                          ) : (
                            <>
                              <span className="letter">{letter}</span>
                              <span className="pts">{tilePoints(letter, false)}</span>
                            </>
                          )}
                        </button>
                      ))}
                    </div>
                    {selectedRack != null && myRack[selectedRack] === "?" && (
                      <div className="field blank-picker">
                        <label>Jolly betű</label>
                        <select value={blankLetter} onChange={(e) => setBlankLetter(e.target.value)}>
                          {blankChoices().map((ch) => (
                            <option key={ch} value={ch}>
                              {ch}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                    <div className="actions center">
                      <button
                        disabled={!isMyTurn || drafts.length === 0}
                        type="button"
                        onClick={() => void submitPlace()}
                      >
                        Lerakás
                      </button>
                      <button
                        className="secondary"
                        disabled={!isMyTurn}
                        type="button"
                        onClick={() => {
                          setDrafts([]);
                          setInvalidWords([]);
                          setError("");
                        }}
                      >
                        Törlés
                      </button>
                      <button
                        className={swapMode ? "" : "secondary"}
                        disabled={!isMyTurn}
                        type="button"
                        onClick={() => setSwapMode((v) => !v)}
                      >
                        {swapMode ? "Csere: kattints a jollyra" : "Jolly visszacseréje"}
                      </button>
                      <button
                        className="secondary"
                        disabled={!isMyTurn}
                        type="button"
                        onClick={() => void submitPass()}
                      >
                        Passz
                      </button>
                      {state.endMode === "B" && (
                        <button
                          className="secondary"
                          disabled={!isMyTurn}
                          type="button"
                          onClick={() => void submitResign()}
                        >
                          Feladom
                        </button>
                      )}
                    </div>
                    {swapMode && (
                      <p className="meta center help-tip">
                        Ha a táblán van egy jolly (üres zseton), és nálad megvan a valódi betű,
                        kicserélheted: a jolly visszakerül a tartódba, a táblán a valódi betű marad.
                      </p>
                    )}
                    {invalidWords.length > 0 && (
                      <div className="accept-box">
                        <p>
                          A szótár nem ismeri: <strong>{invalidWords.join(", ")}</strong>
                        </p>
                        <button type="button" onClick={acceptWords}>
                          Ez értelmes — felveszem
                        </button>
                      </div>
                    )}
                  </>
                )}

                {state.status === "finished" && (
                  <div className="game-over-modal" role="dialog" aria-modal="true">
                    <div className={`game-over-card ${iWon ? "win" : "done"}`}>
                      <p className="game-over-kicker">
                        {iWon ? "Gratulálunk!" : "Szép játék!"}
                      </p>
                      <h2>Vége a partinak!</h2>
                      <p className="meta">
                        Győztes:{" "}
                        <strong>
                          {state.players
                            .filter((p) => state.winnerIds.includes(p.id))
                            .map((p) => p.name)
                            .join(", ") || "—"}
                        </strong>
                      </p>
                      <div className="player-list" style={{ marginTop: "0.8rem" }}>
                        {[...state.players]
                          .sort((a, b) => b.score - a.score)
                          .map((p) => (
                            <div className="player-row" key={p.id}>
                              <span>
                                {p.name}
                                {p.id === user?.id ? " (te)" : ""}
                              </span>
                              <strong>{p.score} pont</strong>
                            </div>
                          ))}
                      </div>
                      <div className="actions" style={{ marginTop: "1rem", justifyContent: "center" }}>
                        <button type="button" onClick={() => leaveTableClick()}>
                          Asztalokhoz
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </section>

          <aside className="side">
            <section className="panel">
              <div className="meta">Hátralévő idő</div>
              <div className={`timer ${remainingMs < 30000 ? "urgent" : ""}`}>
                {state?.status === "playing"
                  ? formatTime(remainingMs)
                  : tableMeta.status === "lobby"
                    ? "VÁRÓ"
                    : "VÉGE"}
              </div>
              <p className="meta">
                {spectating
                  ? "Néző mód"
                  : isMyTurn
                    ? "Te jössz."
                    : state
                      ? `${currentPlayer(state)?.name ?? "—"} köre`
                      : "Várakozás a kezdésre"}
              </p>
              <p className="meta">{endModeLabel(tableMeta.endMode)}</p>
            </section>
            <section className="panel">
              <div className="player-list">
                {(state?.players ?? (tableMeta.seats ?? []).map((s) => ({
                  id: s.userId,
                  name: s.name,
                  score: 0,
                  isBot: s.isBot,
                  eliminated: false,
                  connected: true,
                  rackCount: 0,
                }))).map((p, i) => (
                  <div
                    key={p.id}
                    className={`player-row ${state && i === state.currentPlayerIndex ? "active" : ""} ${"eliminated" in p && p.eliminated ? "out" : ""}`}
                  >
                    <span>
                      {p.name}
                      {p.id === user?.id ? " (te)" : ""}
                      {"eliminated" in p && p.eliminated ? " ✕" : ""}
                    </span>
                    <strong>{"score" in p ? p.score : 0}</strong>
                  </div>
                ))}
              </div>
            </section>
          </aside>
        </div>
      )}

      <TurnBanner show={isMyTurn} name={user?.name} />
      <ConfettiBurst
        active={!!state && state.status === "finished" && screen === "table"}
        celebrate={iWon}
      />

      <footer className="footer">Kozma Szójáték v{version}</footer>
    </div>
  );
}
