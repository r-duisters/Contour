"use client";

// Deterministic PRNG so server and client render identical markup (no
// hydration mismatch) and the composition stays stable across reloads.
function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const HALF = 1200; // one seamless half of the scrolling candle strip
const CANDLES = 48;

type Candle = { x: number; open: number; close: number; high: number; low: number };

function buildCandles(): Candle[] {
  const rand = mulberry32(1337);
  const out: Candle[] = [];
  let price = 200;
  const step = HALF / CANDLES;
  for (let i = 0; i < CANDLES; i++) {
    const drift = (rand() - 0.48) * 40;
    const open = price;
    const close = price + drift;
    const high = Math.max(open, close) + rand() * 18;
    const low = Math.min(open, close) - rand() * 18;
    out.push({ x: i * step + step / 2, open, close, high, low });
    price = close;
  }
  return out;
}

function buildLinePoints(): string {
  const rand = mulberry32(4242);
  const pts: string[] = [];
  let y = 220;
  for (let x = 0; x <= 1440; x += 48) {
    y += (rand() - 0.47) * 55;
    y = Math.min(360, Math.max(60, y));
    pts.push(`${x},${y.toFixed(1)}`);
  }
  return pts.join(" ");
}

const candles = buildCandles();
const linePoints = buildLinePoints();

function CandleStrip({ xOffset }: { xOffset: number }) {
  return (
    <g transform={`translate(${xOffset} 0)`}>
      {candles.map((c, i) => {
        const up = c.close >= c.open;
        const top = Math.min(c.open, c.close);
        const height = Math.max(2, Math.abs(c.close - c.open));
        return (
          <g key={i} stroke={up ? "#22c55e" : "#ef4444"} fill={up ? "#22c55e" : "#ef4444"}>
            <line x1={c.x} y1={400 - c.high} x2={c.x} y2={400 - c.low} strokeWidth="1.5" />
            <rect x={c.x - 7} y={400 - top - height} width="14" height={height} rx="1.5" />
          </g>
        );
      })}
    </g>
  );
}

export default function TradingBackdrop() {
  return (
    <div aria-hidden className="fixed inset-0 overflow-hidden pointer-events-none bg-neutral-950">
      <style>{`
        @keyframes backdrop-drift {
          from { transform: translateX(0); }
          to   { transform: translateX(-${HALF}px); }
        }
        @keyframes backdrop-draw {
          0%   { stroke-dashoffset: 2200; opacity: 0; }
          8%   { opacity: 1; }
          70%  { stroke-dashoffset: 0; opacity: 1; }
          88%  { opacity: 0; }
          100% { stroke-dashoffset: 0; opacity: 0; }
        }
        @keyframes backdrop-pulse {
          0%, 100% { opacity: 0.35; }
          50%      { opacity: 0.7; }
        }
        @media (prefers-reduced-motion: reduce) {
          .backdrop-anim { animation: none !important; }
          .backdrop-line { stroke-dasharray: none !important; opacity: 0.5 !important; }
        }
      `}</style>

      {/* drifting candlestick field along the bottom */}
      <div className="absolute inset-x-0 bottom-0 h-[45vh] opacity-[0.16]">
        <svg
          className="backdrop-anim h-full"
          style={{ width: HALF * 2, animation: "backdrop-drift 70s linear infinite" }}
          viewBox={`0 0 ${HALF * 2} 400`}
          preserveAspectRatio="none"
        >
          <CandleStrip xOffset={0} />
          <CandleStrip xOffset={HALF} />
        </svg>
      </div>

      {/* self-drawing price line across the upper area */}
      <svg
        className="absolute inset-x-0 top-[10vh] w-full h-[40vh]"
        viewBox="0 0 1440 400"
        preserveAspectRatio="none"
      >
        <polyline
          className="backdrop-anim backdrop-line"
          points={linePoints}
          fill="none"
          stroke="#3b82f6"
          strokeWidth="2.5"
          strokeLinejoin="round"
          strokeLinecap="round"
          opacity="0.45"
          style={{
            strokeDasharray: 2200,
            animation: "backdrop-draw 14s ease-in-out infinite",
            filter: "drop-shadow(0 0 6px rgba(59, 130, 246, 0.6))",
          }}
        />
      </svg>

      {/* soft radial glow behind the form area */}
      <div
        className="backdrop-anim absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[36rem] h-[36rem] rounded-full"
        style={{
          background: "radial-gradient(closest-side, rgba(34, 197, 94, 0.09), transparent)",
          animation: "backdrop-pulse 9s ease-in-out infinite",
        }}
      />

      {/* vignette so the form area stays readable */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_30%,rgba(10,10,10,0.75)_100%)]" />
    </div>
  );
}
