import ContourMark from "./ContourMark";

/**
 * The mark on its blue ground — the app's identity as one object.
 *
 * `BRAND.md` puts the colour in the container rather than the line, so every
 * entrance surface draws the same thing: a blue tile or disc with the white
 * mark centred in it. That had been re-typed at six call sites, each free to
 * drift on the shade, the radius or the mark's share of the tile.
 *
 * `round` picks the shape: a disc for the lock and the splash, a squircle for
 * the launcher-like tiles on login and setup. The mark is 86% of the tile,
 * which is `ContourMark`'s own 70% viewBox fill seen at this size.
 */
export default function MarkTile({
  size = 48,
  round = "full",
  breathing = false,
}: {
  size?: number;
  round?: "full" | "squircle" | "tile";
  breathing?: boolean;
}) {
  const radius = round === "full" ? "9999px" : round === "squircle" ? "22%" : "5px";
  return (
    <span
      className="bg-blue-600 flex items-center justify-center shrink-0"
      style={{ width: size, height: size, borderRadius: radius }}
    >
      <ContourMark size={Math.round(size * 0.86)} breathing={breathing} />
    </span>
  );
}
