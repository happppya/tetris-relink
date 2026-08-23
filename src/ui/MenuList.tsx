interface MenuItem {
  label: string
  onSelect: () => void
  hint?: string
}

export function MenuList({ title, items }: { title: string; items: MenuItem[] }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <h1 className="mb-6 text-xl tracking-[0.3em] text-neutral-200">{title}</h1>
      {items.map((item) => (
        <button
          key={item.label}
          onClick={item.onSelect}
          className="w-72 border border-neutral-700 px-4 py-2 text-left font-mono text-sm text-neutral-300 hover:border-neutral-400 hover:bg-neutral-900"
        >
          {item.label}
          {item.hint && <span className="float-right text-xs text-neutral-500">{item.hint}</span>}
        </button>
      ))}
    </div>
  )
}
