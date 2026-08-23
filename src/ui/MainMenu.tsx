import { MenuList } from './MenuList'
import { useZen, zenLevelInfo } from '../state/zen'
import { useStats, type BlitzDuration } from '../state/stats'
import { formatTime } from './format'

interface Props {
  onMode: (mode: 'sprint' | 'blitz' | 'versus', blitzDuration?: 60 | 180 | 300) => void
  onZen: () => void
  onSettings: () => void
  onStats: () => void
}

export function MainMenu({ onMode, onZen, onSettings, onStats }: Props) {
  const xp = useZen((s) => s.xp)
  const level = zenLevelInfo(xp).level
  const sprintBest = useStats((s) => s.sprintBestMs)
  const blitzBest = useStats((s) => s.blitzBestScore)

  const blitzHint = (dur: BlitzDuration): string =>
    blitzBest[dur] === null ? 'score' : `best ${blitzBest[dur]!.toLocaleString()}`

  return (
    <main className="flex min-h-screen items-center justify-center">
      <MenuList
        title="TETRIS LIBERATION"
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
          { label: `ZEN [LV ${level}]`, hint: 'endless', onSelect: onZen },
          { label: 'SETTINGS', onSelect: onSettings },
          { label: 'STATS', onSelect: onStats },
        ]}
      />
    </main>
  )
}
