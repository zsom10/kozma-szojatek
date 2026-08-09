import { useEffect, useRef, useState } from "react";

type TurnBannerProps = {
  show: boolean;
  name?: string;
};

export function TurnBanner({ show, name }: TurnBannerProps) {
  const [visible, setVisible] = useState(false);
  const [key, setKey] = useState(0);
  const prev = useRef(false);

  useEffect(() => {
    if (show && !prev.current) {
      setKey((k) => k + 1);
      setVisible(true);
      const hide = window.setTimeout(() => setVisible(false), 2400);
      prev.current = show;
      return () => window.clearTimeout(hide);
    }
    prev.current = show;
  }, [show]);

  if (!visible) return null;

  return (
    <div className="fx-turn" key={key} role="status" aria-live="polite">
      <div className="fx-turn-card">
        <strong>Te jössz{name ? `, ${name}` : ""}!</strong>
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
