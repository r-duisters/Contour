"use client";

/**
 * The entrance backdrop: a soft blue glow behind the mark, a faint rising
 * price line, and a vignette that keeps the form readable.
 *
 * Direction A removed the candlestick field and the self-drawing line. The
 * mark is now white-on-blue, and the green/red candle strip was carrying the
 * colour the brand moved to the tile — so what is left is quiet blue art on
 * the one screen with no data to show.
 */
const LINE =
  "0,224 96,214 192,239 288,241 384,252 480,242 576,230 672,227 768,220 864,226 960,240 1056,256 1152,264 1248,234 1344,216 1440,228";

export default function TradingBackdrop() {
  return (
    <div aria-hidden className="fixed inset-0 overflow-hidden pointer-events-none bg-neutral-950">
      {/* soft blue glow behind the mark */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 75% at 50% 28%, rgba(59, 130, 246, 0.10), rgba(59, 130, 246, 0) 58%)",
        }}
      />

      {/* a faint rising price line across the upper area */}
      <svg
        className="absolute inset-x-0 top-[12%] h-[40%] w-full"
        viewBox="0 0 1440 400"
        preserveAspectRatio="none"
      >
        <polyline
          points={LINE}
          fill="none"
          stroke="#3b82f6"
          strokeWidth="2.5"
          strokeLinejoin="round"
          strokeLinecap="round"
          opacity="0.18"
        />
      </svg>

      {/* vignette so the form area stays readable */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_30%,rgba(10,10,10,0.75)_100%)]" />
    </div>
  );
}
