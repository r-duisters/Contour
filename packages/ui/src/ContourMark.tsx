/**
 * The app's mark: a white level curve with a white rise inside it, meant to
 * sit on the brand-blue tile (`#2563eb`).
 *
 * The ring is a closed level curve — what the name "Contour" means — and the
 * line is the price rising inside it. Both are white because the blue has moved
 * from the line to the tile: the colour now carries the identity, and the mark
 * itself is one clean white shape (Direction A, #49).
 *
 * The mark breathes (`.breath` in `globals.css`), matching the fingerprint
 * lock. The animation is on a wrapper div rather than the SVG: an HTML
 * transform composites on the GPU, where scaling the SVG circle directly is
 * drawn on the CPU each frame and reads as jank.
 *
 * This component is the bare mark. The blue tile or disc that carries it is
 * added by each consumer (top bar, login, lock), never here.
 */
export default function ContourMark({ size = 48 }: { size?: number }) {
  return (
    <div className="breath shrink-0" style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 512 512"
        role="img"
        aria-label="Contour"
        className="block"
      >
        <circle cx="256" cy="256" r="160" fill="none" stroke="#ffffff" strokeWidth="12" />
        <path d="M172,302 L228,244 L280,276 L348,190" fill="none" stroke="#ffffff" strokeWidth="30" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}
