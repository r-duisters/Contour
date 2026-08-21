/** The app's mark: a nabla, the delta symbol inverted. */
export default function NablaMark({ size = 48 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      role="img"
      aria-label="Nabla"
      className="shrink-0"
    >
      <polygon
        points="112,146 400,146 256,392"
        fill="none"
        stroke="#3b82f6"
        strokeWidth="34"
        strokeLinejoin="round"
      />
    </svg>
  );
}
