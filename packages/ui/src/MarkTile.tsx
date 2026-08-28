import ContourMark from "./ContourMark";

/**
 * The mark on its blue ground — the app's identity as one object.
 *
 * `BRAND.md` puts the colour in the container rather than the line, so every
 * entrance surface draws the same thing: a blue tile or disc with the white
 * mark centred in it. That had been re-typed at six call sites, each free to
 * drift on the shade, the radius or the mark's share of the tile.
 *
 * `round` picks the shape: a disc for the lock, the splash and setup, a
 * squircle for the launcher-like tiles on login and the web's setup. The mark
 * is 86% of the tile, which is `ContourMark`'s own 70% viewBox fill at this
 * size.
 *
 * `glow` and `ring` are what the entrance surfaces add. The glow is the lock
 * screen's blue bloom; the ring turns while the app is busy with something a
 * person started and is waiting on. They compose: the import step shows both,
 * so the screen a person waits at is the screen they were already looking at,
 * with one thing added rather than a different layout swapped in.
 */
export default function MarkTile({
  size = 48,
  round = "full",
  breathing = false,
  glow = false,
  ring = false,
}: {
  size?: number;
  round?: "full" | "squircle" | "tile";
  breathing?: boolean;
  glow?: boolean;
  ring?: boolean;
}) {
  const radius = round === "full" ? "9999px" : round === "squircle" ? "22%" : "5px";
  const box = size + 24;
  const r = (box - 6) / 2;
  const circumference = 2 * Math.PI * r;

  const tile = (
    <span
      className="bg-blue-600 flex items-center justify-center shrink-0"
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        boxShadow: glow ? "0 0 60px rgba(37,99,235,0.45)" : undefined,
      }}
    >
      <ContourMark size={Math.round(size * 0.86)} breathing={breathing} />
    </span>
  );

  if (!ring) return tile;

  return (
    <span className="relative flex items-center justify-center" style={{ width: box, height: box }}>
      <svg
        width={box}
        height={box}
        viewBox={`0 0 ${box} ${box}`}
        className="absolute inset-0 turning"
        aria-hidden
      >
        <circle
          cx={box / 2}
          cy={box / 2}
          r={r}
          fill="none"
          stroke="currentColor"
          className="text-blue-500"
          strokeWidth={3}
          strokeLinecap="round"
          /* A quarter drawn, three quarters gap: enough arc to read as
             motion, little enough to read as incomplete. */
          strokeDasharray={`${circumference / 4} ${circumference}`}
        />
      </svg>
      {tile}
    </span>
  );
}
