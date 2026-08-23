export function GarbageMeter({ amount, height = 600 }: { amount: number; height?: number }) {
  const pct = Math.min(Math.max(amount, 0) / 20, 1) * 100
  return (
    <div className="relative w-2 shrink-0 border border-neutral-800 bg-black" style={{ height }}>
      <div className="absolute bottom-0 left-0 right-0 bg-[#a03030]" style={{ height: `${pct}%` }} />
    </div>
  )
}
