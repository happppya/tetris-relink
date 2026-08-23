import { useState } from 'react'
import { MainMenu } from './ui/MainMenu'
import { SettingsMenu } from './ui/SettingsMenu'
import { StatsScreen } from './ui/StatsScreen'
import { GameScreen } from './ui/GameScreen'
import { VersusScreen } from './ui/VersusScreen'
import { ZenScreen } from './ui/ZenScreen'

type Screen =
  | { name: 'menu' }
  | { name: 'settings' }
  | { name: 'stats' }
  | { name: 'game'; mode: 'sprint' | 'blitz'; blitzDuration?: 60 | 180 | 300 }
  | { name: 'versus' }
  | { name: 'zen' }

export default function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'menu' })

  switch (screen.name) {
    case 'menu':
      return (
        <MainMenu
          onMode={(mode, blitzDuration) =>
            mode === 'versus' ? setScreen({ name: 'versus' }) : setScreen({ name: 'game', mode, blitzDuration })
          }
          onZen={() => setScreen({ name: 'zen' })}
          onSettings={() => setScreen({ name: 'settings' })}
          onStats={() => setScreen({ name: 'stats' })}
        />
      )
    case 'settings':
      return <SettingsMenu onBack={() => setScreen({ name: 'menu' })} />
    case 'stats':
      return <StatsScreen onBack={() => setScreen({ name: 'menu' })} />
    case 'game':
      return (
        <GameScreen
          key={`${screen.mode}-${screen.blitzDuration ?? 0}`}
          mode={screen.mode}
          blitzDuration={screen.blitzDuration}
          onExit={() => setScreen({ name: 'menu' })}
        />
      )
    case 'versus':
      return <VersusScreen onExit={() => setScreen({ name: 'menu' })} />
    case 'zen':
      return <ZenScreen onExit={() => setScreen({ name: 'menu' })} />
  }
}
