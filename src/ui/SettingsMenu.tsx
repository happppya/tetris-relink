import { useEffect, useRef, useState } from 'react'
import { useSettings, ACTION_LABELS, msToFrames, serializeSettings } from '../state/settings'
import { BOT_PROFILES } from '../ai/profiles'
import { EFFECT_LEVELS } from '../render/effects'
import type { InputAction } from '../engine/types'

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center justify-between gap-4 py-1 font-mono text-sm">
      <span className="text-neutral-400">{label}</span>
      <span className="flex items-center gap-2">{children}</span>
    </label>
  )
}

function Slider({
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  value: number
  min: number
  max: number
  step?: number
  onChange: (v: number) => void
}) {
  return (
    <>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-40 accent-neutral-300"
      />
      <span className="w-14 text-right text-neutral-200">{value}</span>
    </>
  )
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!value)}
      className={`w-16 border px-2 py-0.5 text-xs ${value ? 'border-neutral-300 text-neutral-100' : 'border-neutral-700 text-neutral-500'}`}
    >
      {value ? 'ON' : 'OFF'}
    </button>
  )
}

function NumberInput({ value, onChange, step = 1, min = 0 }: { value: number; onChange: (v: number) => void; step?: number; min?: number }) {
  return (
    <input
      type="number"
      value={value}
      step={step}
      min={min}
      onChange={(e) => onChange(Number(e.target.value))}
      className="w-20 border border-neutral-700 bg-black px-2 py-0.5 text-right font-mono text-sm text-neutral-200 focus:border-neutral-400 focus:outline-none"
    />
  )
}

function KeybindButton({
  action,
  code,
  onCapturingChange,
}: {
  action: InputAction
  code: string
  onCapturingChange: (capturing: boolean) => void
}) {
  const bindKey = useSettings((s) => s.bindKey)
  const [listening, setListening] = useState(false)
  return (
    <button
      onKeyDown={(e) => {
        if (listening) {
          e.preventDefault()
          if (e.code !== 'Escape' || code !== 'Escape') bindKey(action, e.code)
          setListening(false)
          onCapturingChange(false)
        }
      }}
      onClick={() => {
        setListening(true)
        onCapturingChange(true)
      }}
      className={`w-32 border px-2 py-1 font-mono text-xs ${
        listening ? 'animate-pulse border-neutral-100 text-neutral-100' : 'border-neutral-700 text-neutral-300 hover:border-neutral-400'
      }`}
    >
      {listening ? 'PRESS KEY' : code || 'UNBOUND'}
    </button>
  )
}

function Section({
  title,
  onReset,
  children,
}: {
  title: string
  onReset?: () => void
  children: React.ReactNode
}) {
  return (
    <section className="mb-6 w-full">
      <div className="mb-2 flex items-center justify-between border-b border-neutral-800 pb-1">
        <h2 className="font-mono text-xs tracking-widest text-neutral-500">{title}</h2>
        {onReset && (
          <button
            onClick={onReset}
            className="font-mono text-[10px] tracking-widest text-neutral-600 hover:text-neutral-200"
          >
            RESET DEFAULTS
          </button>
        )}
      </div>
      {children}
    </section>
  )
}

function SettingsFileSection() {
  const importSettings = useSettings((s) => s.importSettings)
  const fileRef = useRef<HTMLInputElement>(null)
  const [status, setStatus] = useState('')

  const exportSettings = () => {
    const data = serializeSettings(useSettings.getState())
    const blob = new Blob([data], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'tetris-relinked-settings.json'
    a.click()
    URL.revokeObjectURL(url)
    setStatus('EXPORTED')
  }

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        setStatus(importSettings(JSON.parse(String(reader.result))) ? 'IMPORTED' : 'INVALID FILE')
      } catch {
        setStatus('INVALID FILE')
      }
    }
    reader.readAsText(file)
  }

  return (
    <Section title="SETTINGS FILE">
      <Row label="Export to file">
        <button
          onClick={exportSettings}
          className="border border-neutral-700 px-3 py-1 font-mono text-xs text-neutral-400 hover:border-neutral-400 hover:text-neutral-200"
        >
          EXPORT JSON
        </button>
      </Row>
      <Row label="Import from file">
        <button
          onClick={() => fileRef.current?.click()}
          className="border border-neutral-700 px-3 py-1 font-mono text-xs text-neutral-400 hover:border-neutral-400 hover:text-neutral-200"
        >
          IMPORT JSON
        </button>
        <input ref={fileRef} type="file" accept="application/json,.json" onChange={onFile} className="hidden" />
      </Row>
      {status && <p className="py-1 font-mono text-xs text-neutral-500">{status}</p>}
    </Section>
  )
}

export function SettingsMenu({ onBack }: { onBack: () => void }) {
  const s = useSettings()
  const [capturingKey, setCapturingKey] = useState(false)
  const pauseCode = s.keybinds.pause

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (capturingKey || !pauseCode) return
      if (e.code === pauseCode) {
        e.preventDefault()
        onBack()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [capturingKey, pauseCode, onBack])

  return (
    <main className="min-h-screen py-8 flex justify-center">
      <div className="w-[560px]">
        <Section title="HANDLING" onReset={s.resetHandling}>
          <Row label={`DAS (${msToFrames(s.dasMs)}f)`}>
            <Slider value={s.dasMs} min={10} max={300} onChange={(v) => s.update({ dasMs: v })} />
          </Row>
          <Row label={`ARR${s.arrMs === 0 ? ' (instant)' : ` (${msToFrames(s.arrMs)}f)`}`}>
            <Slider value={s.arrMs} min={0} max={100} onChange={(v) => s.update({ arrMs: v })} />
          </Row>
          <Row label={`Soft drop delay${s.sddMs === 0 ? ' (instant)' : ` (${msToFrames(s.sddMs)}f)`}`}>
            <Slider value={s.sddMs} min={0} max={100} onChange={(v) => s.update({ sddMs: v })} />
          </Row>
        </Section>

        <Section title="KEYBINDS" onReset={s.resetKeybinds}>
          <div className="grid grid-cols-2 gap-x-8">
            {(Object.keys(ACTION_LABELS) as InputAction[]).map((action) => (
              <Row key={action} label={ACTION_LABELS[action]}>
                <KeybindButton action={action} code={s.keybinds[action]} onCapturingChange={setCapturingKey} />
              </Row>
            ))}
          </div>
        </Section>

        <Section title="GAMEPLAY" onReset={s.resetGameplay}>
          <Row label="Ghost piece">
            <Toggle value={s.ghost} onChange={(v) => s.update({ ghost: v })} />
          </Row>
          <Row label="Start level">
            <Slider value={s.startLevel} min={1} max={19} onChange={(v) => s.update({ startLevel: v })} />
          </Row>
        </Section>

        <Section title="VISUAL EFFECTS" onReset={s.resetVisuals}>
          <Row label="Effects level">
            <span className="flex flex-wrap justify-end gap-1">
              {EFFECT_LEVELS.map((l) => (
                <button
                  key={l.level}
                  onClick={() => s.update({ effectsLevel: l.level })}
                  title={l.desc}
                  className={`border px-2 py-0.5 text-xs ${
                    s.effectsLevel === l.level
                      ? 'border-neutral-300 text-neutral-100'
                      : 'border-neutral-700 text-neutral-500 hover:border-neutral-400'
                  }`}
                >
                  {l.level}
                </button>
              ))}
            </span>
          </Row>
          <p className="py-1 text-right font-mono text-xs text-neutral-500">
            {EFFECT_LEVELS.find((l) => l.level === s.effectsLevel)?.desc}
          </p>
          <Row label="Screen shake">
            <Toggle value={s.shake} onChange={(v) => s.update({ shake: v })} />
          </Row>
          <Row label="Clear popups">
            <Toggle value={s.clearPopups} onChange={(v) => s.update({ clearPopups: v })} />
          </Row>
        </Section>

        <Section title="AI OPPONENT" onReset={s.resetAi}>
          <Row label="Mode">
            <span className="flex gap-1">
              <button
                onClick={() => s.updateAi({ mode: 'fixed' })}
                className={`border px-2 py-0.5 text-xs ${s.ai.mode === 'fixed' ? 'border-neutral-300 text-neutral-100' : 'border-neutral-700 text-neutral-500'}`}
              >
                FIXED PPS
              </button>
              <button
                onClick={() => s.updateAi({ mode: 'adaptive' })}
                className={`border px-2 py-0.5 text-xs ${s.ai.mode === 'adaptive' ? 'border-neutral-300 text-neutral-100' : 'border-neutral-700 text-neutral-500'}`}
              >
                ADAPTIVE
              </button>
            </span>
          </Row>
          <Row label="AI PPS">
            <Slider value={s.ai.pps} min={0.3} max={5} step={0.1} onChange={(v) => s.updateAi({ pps: v })} />
          </Row>
          <Row label="Bot personality">
            <span className="flex flex-wrap justify-end gap-1">
              {BOT_PROFILES.map((p) => (
                <button
                  key={p.id}
                  onClick={() => s.update({ botProfile: p.id })}
                  title={p.description}
                  className={`border px-2 py-0.5 text-xs ${
                    s.botProfile === p.id
                      ? 'border-neutral-300 text-neutral-100'
                      : 'border-neutral-700 text-neutral-500 hover:border-neutral-400'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </span>
          </Row>
          <Row label="Opponent board">
            <span className="flex gap-1">
              <button
                onClick={() => s.update({ opponentBoardSize: 'small' })}
                className={`border px-2 py-0.5 text-xs ${
                  s.opponentBoardSize === 'small' ? 'border-neutral-300 text-neutral-100' : 'border-neutral-700 text-neutral-500'
                }`}
              >
                SMALLER
              </button>
              <button
                onClick={() => s.update({ opponentBoardSize: 'full' })}
                className={`border px-2 py-0.5 text-xs ${
                  s.opponentBoardSize === 'full' ? 'border-neutral-300 text-neutral-100' : 'border-neutral-700 text-neutral-500'
                }`}
              >
                SAME SIZE
              </button>
            </span>
          </Row>
        </Section>

        <Section title="ATTACK TABLE (VERSUS)" onReset={s.resetAttackTable}>
          <Row label="Tetris sends">
            <NumberInput value={s.attack.tetris} onChange={(v) => s.updateAttack({ tetris: v })} />
          </Row>
          <Row label="Spin single">
            <NumberInput value={s.attack.spinSingle} onChange={(v) => s.updateAttack({ spinSingle: v })} />
          </Row>
          <Row label="Spin double">
            <NumberInput value={s.attack.spinDouble} onChange={(v) => s.updateAttack({ spinDouble: v })} />
          </Row>
          <Row label="Spin triple">
            <NumberInput value={s.attack.spinTriple} onChange={(v) => s.updateAttack({ spinTriple: v })} />
          </Row>
          <Row label="Perfect clear">
            <NumberInput value={s.attack.perfectClear} onChange={(v) => s.updateAttack({ perfectClear: v })} />
          </Row>
          <Row label="Combo multiplier / step">
            <NumberInput value={s.attack.comboStep} step={0.05} onChange={(v) => s.updateAttack({ comboStep: v })} />
          </Row>
          <Row label="Combo max multiplier">
            <NumberInput value={s.attack.comboMaxMult} step={0.25} onChange={(v) => s.updateAttack({ comboMaxMult: v })} />
          </Row>
          <Row label="Back-to-back bonus lines">
            <NumberInput value={s.attack.b2bBonus} onChange={(v) => s.updateAttack({ b2bBonus: v })} />
          </Row>
          <Row label="Streak send threshold (streak >)">
            <NumberInput value={s.attack.streakThreshold} onChange={(v) => s.updateAttack({ streakThreshold: v })} />
          </Row>
          <Row label="Blitz spin score x">
            <NumberInput value={s.scoring.blitzSpinMult} step={0.5} onChange={(v) => s.updateScoring({ blitzSpinMult: v })} />
          </Row>
          <Row label="Blitz tetris score x">
            <NumberInput value={s.scoring.blitzTetrisMult} step={0.25} onChange={(v) => s.updateScoring({ blitzTetrisMult: v })} />
          </Row>
          <Row label="Blitz perfect clear bonus">
            <NumberInput value={s.scoring.blitzPcBonus} step={500} onChange={(v) => s.updateScoring({ blitzPcBonus: v })} />
          </Row>
        </Section>

        <SettingsFileSection />

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
