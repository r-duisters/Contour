/**
 * The app's mark: a rising price line inside four crop marks.
 *
 * The corners frame the line the way a measurement is framed — and four marks
 * at an equal offset are themselves a level set, so the name still means
 * something. They are deliberately a *partial* container: the app frames the
 * mark in a circle twice over (the unlock disc, and Android's adaptive mask,
 * which most launchers render round), and any closed round shape of its own
 * puts a ring inside a ring. Corners never approach the frame's edge, so they
 * survive circle, squircle and square alike.
 *
 * Two colours, not one: the corners carry the brand blue and the line is
 * white, so the frame reads as the container and the data reads as the
 * subject. White also gives the line the strongest contrast available against
 * the near-black ground, which is what keeps it legible at 24px.
 */
const INSET = 118;
const ARM = 60;
const FAR = 512 - INSET;
const FRAME = "#3b82f6";
const LINE = "#fafafa";

const CORNERS = [
  `M${INSET},${INSET + ARM} V${INSET} H${INSET + ARM}`,
  `M${FAR - ARM},${INSET} H${FAR} V${INSET + ARM}`,
  `M${FAR},${FAR - ARM} V${FAR} H${FAR - ARM}`,
  `M${INSET + ARM},${FAR} H${INSET} V${FAR - ARM}`,
];
const PRICE = "M172,302 L228,244 L280,276 L348,190";

export default function ContourMark({ size = 48 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      role="img"
      aria-label="Contour"
      className="shrink-0"
    >
      <g fill="none" stroke={FRAME} strokeWidth="24" strokeLinecap="round" strokeLinejoin="round">
        {CORNERS.map((d) => <path key={d} d={d} />)}
      </g>
      <path
        d={PRICE}
        fill="none"
        stroke={LINE}
        strokeWidth="30"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
