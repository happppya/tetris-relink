import { useStats, type BlitzDuration } from '../state/stats'
import { formatTime } from './format'

export function StatsScreen({ onBack }: { onBack: () => void }) {
  const stats = useStats()
  const blitzRows: [string, BlitzDuration][] = [
    ['Blitz 1:00 best score', 60],
    ['Blitz 3:00 best score', 180],
    ['Blitz 5:00 best score', 300],
  ]
  return (
    <main className="flex min-h-screen items-center justify-center">
      <div className="w-96">
        <h1 className="mb-6 text-center font-mono text-xl tracking-[0.3em] text-neutral-200">STATS</h1>
        <div className="mb-4 border border-neutral-700 p-4 font-mono text-sm">
          <div className="flex justify-between py-1">
            <span className="text-neutral-400">40 lines best time</span>
            <span className="text-neutral-100">{stats.sprintBestMs === null ? '--:--.--' : formatTime(stats.sprintBestMs)}</span>
          </div>
          {blitzRows.map(([label, dur]) => (
            <div key={dur} className="flex justify-between py-1">
              <span className="text-neutral-400">{label}</span>
              <span className="text-neutral-100">{stats.blitzBestScore[dur] === null ? '------' : stats.blitzBestScore[dur]!.toLocaleString()}</span>
            </div>
          ))}
          <div className="mt-2 flex justify-between border-t border-neutral-800 pt-2">
            <span className="text-neutral-400">Games played</span>
            <span className="text-neutral-100">{stats.gamesPlayed}</span>
          </div>
        </div>
        <button
          onClick={onBack}
          className="w-full border border-neutral-700 px-4 py-2 font-mono text-sm text-neutral-300 hover:border-neutral-400 hover:bg-neutral-900"
        >
          BACK
        </button>
      </div>
    </main>
  )
}
