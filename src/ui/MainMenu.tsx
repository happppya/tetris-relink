import { MenuList } from './MenuList'
import { useZen, zenLevelInfo } from '../state/zen'
import { useStats, type BlitzDuration } from '../state/stats'
import { formatTime } from './format'

interface Props {
  onMode: (mode: 'sprint' | 'blitz' | 'versus', blitzDuration?: 60 | 180 | 300) => void
  onZen: () => void
  onSettings: () => void
  onStats: () => void
  onMultiplayer: () => void
}

export function MainMenu({ onMode, onZen, onSettings, onStats, onMultiplayer }: Props) {
  const xp = useZen((s) => s.xp)
  const level = zenLevelInfo(xp).level
  const sprintBest = useStats((s) => s.sprintBestMs)
  const blitzBest = useStats((s) => s.blitzBestScore)

  const blitzHint = (dur: BlitzDuration): string =>
    blitzBest[dur] === null ? 'score' : `best ${blitzBest[dur]!.toLocaleString()}`

  return (
    <main className="flex min-h-screen items-center justify-center gap-16">
      <MenuList
        title="TETRIS RELINKED"
        items={[
          {
            label: '40 LINES',
            hint: sprintBest === null ? 'sprint' : `best ${formatTime(sprintBest)}`,
            onSelect: () => onMode('sprint'),
          },
          { label: 'BLITZ 1:00', hint: blitzHint(60), onSelect: () => onMode('blitz', 60) },
          { label: 'BLITZ 3:00', hint: blitzHint(180), onSelect: () => onMode('blitz', 180) },
          { label: 'BLITZ 5:00', hint: blitzHint(300), onSelect: () => onMode('blitz', 300) },
          { label: 'VERSUS AI', hint: 'battle', onSelect: () => onMode('versus') },
          { label: 'MULTIPLAYER', hint: 'lobbies', onSelect: onMultiplayer },
          { label: `ZEN [LV ${level}]`, hint: 'endless', onSelect: onZen },
          { label: 'SETTINGS', onSelect: onSettings },
          { label: 'STATS', onSelect: onStats },
        ]}
      />
      <aside className="max-w-xs text-sm leading-relaxed text-neutral-400">
        <p className="mb-3">
          Tetris relinked is a simple online multiplayer tetris website inspired by the modern features of
          TETR.IO but made open-source.
        </p>
        <p className="mb-3">
          Make sure to star the repository if you enjoyed playing:{' '}
          <a
            href="https://github.com/happppya/tetris-relink"
            target="_blank"
            rel="noreferrer"
            className="text-neutral-200 underline hover:text-white"
          >
            github.com/happppya/tetris-relink
          </a>
        </p>
        <p>PRs and suggestions are welcome.</p>
      </aside>
    </main>
  )
}
