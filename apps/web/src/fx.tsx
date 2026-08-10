import { useEffect, useRef, useState } from "react";

type TurnBannerProps = {
  show: boolean;
  epoch: string;
  name?: string;
  awayFromTable?: boolean;
  onReturnToGame?: () => void;
};

export function TurnBanner({
  show,
  epoch,
  name,
  awayFromTable = false,
  onReturnToGame,
}: TurnBannerProps) {
  const [visible, setVisible] = useState(false);
  const [key, setKey] = useState(0);
  const prevShow = useRef(false);
  const prevEpoch = useRef("");
  const prevAway = useRef(false);

  useEffect(() => {
    const rising = show && (!prevShow.current || (epoch && epoch !== prevEpoch.current));
    const leftAway = prevAway.current && !awayFromTable;
    prevShow.current = show;
    prevAway.current = awayFromTable;
    if (epoch) prevEpoch.current = epoch;

    if (!show) {
      setVisible(false);
      return;
    }
    if (awayFromTable) {
      setVisible(true);
      if (rising) setKey((k) => k + 1);
      return;
    }
    if (leftAway) {
      setVisible(false);
      return;
    }
    if (!rising) return;
    setKey((k) => k + 1);
    setVisible(true);
    const hide = window.setTimeout(() => setVisible(false), 2200);
    return () => window.clearTimeout(hide);
  }, [show, epoch, awayFromTable]);

  if (!visible) return null;

  return (
    <div
      className={`fx-turn ${awayFromTable && onReturnToGame ? "has-action" : ""}`}
      key={key}
      role="status"
      aria-live="polite"
    >
      <div className="fx-turn-card">
        <strong>Te jössz{name ? `, ${name}` : ""}!</strong>
        {awayFromTable && onReturnToGame && (
          <button
            type="button"
            className="fx-turn-btn"
            onClick={() => {
              setVisible(false);
              onReturnToGame();
            }}
          >
            Vissza a játékba
          </button>
        )}
      </div>
    </div>
  );
}

type VoteBannerProps = {
  show: boolean;
  challengeId: string;
  proposerName: string;
  words: string[];
  isProposer: boolean;
  canVote: boolean;
  onAccept: () => void;
  onReject: () => void;
};

export function VoteBanner({
  show,
  challengeId,
  proposerName,
  words,
  isProposer,
  canVote,
  onAccept,
  onReject,
}: VoteBannerProps) {
  const [key, setKey] = useState(0);
  const prevId = useRef("");

  useEffect(() => {
    if (!show) return;
    if (challengeId && challengeId !== prevId.current) {
      prevId.current = challengeId;
      setKey((k) => k + 1);
    }
  }, [show, challengeId]);

  if (!show) return null;

  return (
    <div className="fx-turn has-action vote-overlay" key={key} role="dialog" aria-live="polite">
      <div className="fx-turn-card vote-card">
        <p className="vote-kicker">Szószavazás</p>
        <strong>
          {proposerName} javasolja: {words.join(", ")}
        </strong>
        {isProposer ? (
          <p className="meta">Várjuk a többiek szavazatát…</p>
        ) : canVote ? (
          <div className="actions vote-actions">
            <button type="button" onClick={onAccept}>
              Elfogadom
            </button>
            <button type="button" className="secondary" onClick={onReject}>
              Elutasítom
            </button>
          </div>
        ) : (
          <p className="meta">Már szavaztál, várunk a többiekre…</p>
        )}
      </div>
    </div>
  );
}

type DrawRevealProps = {
  show: boolean;
  draws: { name: string; letter: string }[];
  order: string[];
};

export function DrawRevealOverlay({ show, draws, order }: DrawRevealProps) {
  if (!show || draws.length === 0) return null;
  return (
    <div className="fx-turn has-action draw-overlay" role="status" aria-live="polite">
      <div className="fx-turn-card draw-card">
        <p className="vote-kicker">Sorrend sorsolás</p>
        <div className="draw-list">
          {draws.map((d, i) => (
            <div className="draw-row" key={`${d.name}-${d.letter}`} style={{ animationDelay: `${i * 0.18}s` }}>
              <span>{d.name}</span>
              <strong className="draw-letter">{d.letter}</strong>
            </div>
          ))}
        </div>
        <p className="meta">Kezd: {order[0] ?? "—"} (ABC sorrend)</p>
      </div>
    </div>
  );
}

type ConfettiProps = {
  active: boolean;
  celebrate: boolean;
};

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  w: number;
  h: number;
  rot: number;
  vr: number;
  color: string;
  life: number;
};

const COLORS_WIN = ["#1f5c45", "#c4a574", "#d4a84b", "#c9786a", "#f0e2c0", "#6a9fb5"];
const COLORS_SOFT = ["#1f5c45", "#c4a574", "#d4a84b", "#f0e2c0"];

export function ConfettiBurst({ active, celebrate }: ConfettiProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const prev = useRef(false);

  useEffect(() => {
    if (!active || prev.current) {
      prev.current = active;
      return;
    }
    prev.current = active;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const resize = () => {
      canvas.width = Math.floor(window.innerWidth * dpr);
      canvas.height = Math.floor(window.innerHeight * dpr);
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();

    const colors = celebrate ? COLORS_WIN : COLORS_SOFT;
    const count = celebrate ? 120 : 70;
    const parts: Particle[] = [];
    for (let i = 0; i < count; i++) {
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * 1.2;
      const speed = 6 + Math.random() * 10;
      parts.push({
        x: window.innerWidth * (0.2 + Math.random() * 0.6),
        y: window.innerHeight * 0.55 + Math.random() * 40,
        vx: Math.cos(angle) * speed * (0.4 + Math.random()),
        vy: Math.sin(angle) * speed - 4,
        w: 6 + Math.random() * 8,
        h: 8 + Math.random() * 12,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.35,
        color: colors[Math.floor(Math.random() * colors.length)],
        life: 1,
      });
    }

    let raf = 0;
    const started = performance.now();
    const tick = (t: number) => {
      const elapsed = t - started;
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      for (const p of parts) {
        p.vy += 0.18;
        p.vx *= 0.995;
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vr;
        p.life = Math.max(0, 1 - elapsed / 3800);
        if (p.life <= 0) continue;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.globalAlpha = p.life;
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      }
      if (elapsed < 4000) raf = requestAnimationFrame(tick);
      else ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    };
    raf = requestAnimationFrame(tick);
    window.addEventListener("resize", resize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    };
  }, [active, celebrate]);

  useEffect(() => {
    if (!active) prev.current = false;
  }, [active]);

  if (!active) return null;
  return <canvas className="fx-confetti" ref={canvasRef} aria-hidden />;
}
