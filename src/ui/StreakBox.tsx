export function StreakBox({ value }: { value: number }) {
  if (value <= 0) return null
  const t = Math.min(value / 200, 1)
  const color = `hsl(${Math.round(48 - 48 * t)} ${Math.round(35 + 65 * t)}% ${Math.round(58 + 4 * t)}%)`
  return (
    <div className="mt-3">
      <h2 className="mb-1 font-mono text-xs tracking-widest text-neutral-500">STREAK</h2>
      <div className="flex justify-start">
        <div
          className="flex items-center justify-center border font-mono font-bold leading-none"
          style={{
            color,
            borderColor: color,
            borderWidth: 1 + Math.round(2 * t),
            minWidth: Math.round(40 + 32 * t),
            padding: `${Math.round(6 + 6 * t)}px ${Math.round(10 + 12 * t)}px`,
            fontSize: Math.round(16 + 26 * t),
          }}
        >
          {value}
        </div>
      </div>
    </div>
  )
}
