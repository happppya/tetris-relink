import { useEffect, useRef, useState } from 'react'
import {
  useSettings,
  ACTION_LABELS,
  HANDLING_PRESETS,
  handlingPresetFromValues,
  msToFrames,
  serializeSettings,
} from '../state/settings'
import { BOT_PROFILES } from '../ai/profiles'
import { FX_PRESET_INFO, presetFromConfig } from '../render/effects'
import type { InputAction } from '../engine/types'

function Row({
  label,
  children,
  hint,
}: {
  label: string
  children: React.ReactNode
  hint?: string
}) {
  return (
    <label
      title={hint}
      className={`flex items-center justify-between gap-4 py-1 font-mono text-sm ${hint ? 'cursor-help' : ''}`}
    >
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

const KEYBIND_HINTS: Record<InputAction, string> = {
  moveLeft: 'Slide the piece one cell left; hold for DAS/ARR repeat movement.',
  moveRight: 'Slide the piece one cell right; hold for DAS/ARR repeat movement.',
  softDrop: 'Drop the piece one cell at a time, faster than gravity.',
  hardDrop: 'Instantly drop the piece to the bottom and lock it; triggers impact VFX.',
  rotateCW: 'Rotate the piece clockwise.',
  rotateCCW: 'Rotate the piece counter-clockwise.',
  rotate180: 'Rotate the piece 180°.',
  hold: 'Swap the current piece with the piece in hold (once per piece).',
  retry: 'Restart the run on a fresh board.',
  pause: 'Pause/unpause the game; in the settings menu, backs out.',
  assist: 'Toggle assist hints (zen: best-placement advice; versus/multiplayer: cycles targeting mode).',
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
      <Row label="Export to file" hint="Downloads the current settings as a JSON file you can back up or share.">
        <button
          onClick={exportSettings}
          className="border border-neutral-700 px-3 py-1 font-mono text-xs text-neutral-400 hover:border-neutral-400 hover:text-neutral-200"
        >
          EXPORT JSON
        </button>
      </Row>
      <Row label="Import from file" hint="Loads settings from a previously exported JSON file, replacing your current settings.">
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
  const activeHandlingPreset = handlingPresetFromValues(s)

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
          <Row label="Preset" hint="Applies a full handling profile. NOOB = the default beginner-friendly feel; PRO = competitive handling (80ms DAS, instant slides, instant soft drops).">
            <span className="flex gap-1">
              <button
                onClick={() => s.update({ ...HANDLING_PRESETS.noob })}
                title={`Beginner-friendly defaults: DAS ${HANDLING_PRESETS.noob.dasMs}ms, ARR ${HANDLING_PRESETS.noob.arrMs}ms, soft drop ${HANDLING_PRESETS.noob.sddMs}ms.`}
                className={`border px-2 py-0.5 text-xs ${
                  activeHandlingPreset === 'noob' ? 'border-neutral-300 text-neutral-100' : 'border-neutral-700 text-neutral-500 hover:border-neutral-400'
                }`}
              >
                NOOB
              </button>
              <button
                onClick={() => s.update({ ...HANDLING_PRESETS.pro })}
                title={`Competitive handling: DAS ${HANDLING_PRESETS.pro.dasMs}ms, instant slides (ARR 0), instant soft drops (SDD 0).`}
                className={`border px-2 py-0.5 text-xs ${
                  activeHandlingPreset === 'pro' ? 'border-neutral-300 text-neutral-100' : 'border-neutral-700 text-neutral-500 hover:border-neutral-400'
                }`}
              >
                PRO
              </button>
            </span>
          </Row>
          <p className="py-1 text-right font-mono text-xs text-neutral-500">
            {activeHandlingPreset === null
              ? 'custom — tweak the sliders below'
              : `${activeHandlingPreset.toUpperCase()} preset`}
          </p>
          <Row label={`DAS (${msToFrames(s.dasMs)}f)`} hint="Delayed Auto Shift: hold a direction to start sliding after this delay. Lower = snappier starts; the first tap always moves one cell immediately.">
            <Slider value={s.dasMs} min={10} max={300} onChange={(v) => s.update({ dasMs: v })} />
          </Row>
          <Row label={`ARR${s.arrMs === 0 ? ' (instant)' : ` (${msToFrames(s.arrMs)}f)`}`} hint="Auto Repeat Rate: how fast the piece keeps sliding while a direction is held. 0 = slides straight to the far wall.">
            <Slider value={s.arrMs} min={0} max={100} onChange={(v) => s.update({ arrMs: v })} />
          </Row>
          <Row label={`Soft drop delay${s.sddMs === 0 ? ' (instant)' : ` (${msToFrames(s.sddMs)}f)`}`} hint="Delay between soft-drop steps while holding down. 0 = drops as fast as the simulation allows.">
            <Slider value={s.sddMs} min={0} max={100} onChange={(v) => s.update({ sddMs: v })} />
          </Row>
        </Section>

        <Section title="KEYBINDS" onReset={s.resetKeybinds}>
          <div className="grid grid-cols-2 gap-x-8">
            {(Object.keys(ACTION_LABELS) as InputAction[]).map((action) => (
              <Row key={action} label={ACTION_LABELS[action]} hint={KEYBIND_HINTS[action]}>
                <KeybindButton action={action} code={s.keybinds[action]} onCapturingChange={setCapturingKey} />
              </Row>
            ))}
          </div>
        </Section>

        <Section title="GAMEPLAY" onReset={s.resetGameplay}>
          <Row label="Ghost piece" hint="Shows a translucent outline where the current piece will land.">
            <Toggle value={s.ghost} onChange={(v) => s.update({ ghost: v })} />
          </Row>
          <Row label="Start level" hint="Starting gravity level: higher = faster initial gravity and higher scoring from the first line.">
            <Slider value={s.startLevel} min={1} max={19} onChange={(v) => s.update({ startLevel: v })} />
          </Row>
        </Section>

        <Section title="VISUAL EFFECTS" onReset={s.resetVisuals}>
          <Row label="Preset" hint="Sets all effects parameters below at once. The active preset is highlighted; tweaking any individual parameter switches to a custom config.">
            <span className="flex flex-wrap justify-end gap-1">
              {FX_PRESET_INFO.map((p) => {
                const active = presetFromConfig(s.fx) === p.id
                return (
                  <button
                    key={p.id}
                    onClick={() => s.setFxPreset(p.id)}
                    className={`border px-2 py-0.5 text-xs ${
                      active ? 'border-neutral-300 text-neutral-100' : 'border-neutral-700 text-neutral-500 hover:border-neutral-400'
                    }`}
                  >
                    {p.name}
                  </button>
                )
              })}
            </span>
          </Row>
          {presetFromConfig(s.fx) === null && (
            <p className="py-1 text-right font-mono text-xs text-neutral-500">custom — tweak individual parameters below</p>
          )}
          <Row label="Particles" hint="Sparks on line clears. OFF = none, ON = normal density, EXTRA = denser and faster bursts.">
            <span className="flex gap-1">
              {[0, 1, 2].map((v) => (
                <button
                  key={v}
                  onClick={() => s.updateFx({ particles: v })}
                  title={v === 0 ? 'No sparks on clears' : v === 1 ? 'Normal spark density' : 'Denser, faster sparks'}
                  className={`border px-2 py-0.5 text-xs ${s.fx.particles === v ? 'border-neutral-300 text-neutral-100' : 'border-neutral-700 text-neutral-500 hover:border-neutral-400'}`}
                >
                  {v === 0 ? 'OFF' : v === 1 ? 'ON' : 'EXTRA'}
                </button>
              ))}
            </span>
          </Row>
          <Row label="Shockwave rings" hint="Rings radiating from the clear on spins, tetris and perfect clears. COMBO adds extra pulses as combos climb.">
            <span className="flex gap-1">
              {[0, 1, 2].map((v) => (
                <button
                  key={v}
                  onClick={() => s.updateFx({ rings: v })}
                  title={v === 0 ? 'No shockwave rings' : v === 1 ? 'Base ring on major clears' : 'Base ring plus extra pulses per combo step'}
                  className={`border px-2 py-0.5 text-xs ${s.fx.rings === v ? 'border-neutral-300 text-neutral-100' : 'border-neutral-700 text-neutral-500 hover:border-neutral-400'}`}
                >
                  {v === 0 ? 'OFF' : v === 1 ? 'ON' : 'COMBO'}
                </button>
              ))}
            </span>
          </Row>
          <Row label="Row flash" hint="Bright white flash along the cleared rows. MAJORS = only spins/tetris/perfect clears; ALL = every cleared row.">
            <span className="flex gap-1">
              {[0, 1, 2].map((v) => (
                <button
                  key={v}
                  onClick={() => s.updateFx({ rowFlash: v })}
                  title={v === 0 ? 'No row flash' : v === 1 ? 'Flash only on major clears' : 'Flash on every cleared row'}
                  className={`border px-2 py-0.5 text-xs ${s.fx.rowFlash === v ? 'border-neutral-300 text-neutral-100' : 'border-neutral-700 text-neutral-500 hover:border-neutral-400'}`}
                >
                  {v === 0 ? 'OFF' : v === 1 ? 'MAJORS' : 'ALL'}
                </button>
              ))}
            </span>
          </Row>
          <Row label="Tetris beams" hint="Horizontal light beams that sweep across the rows of a tetris clear.">
            <Toggle value={s.fx.beams} onChange={(v) => s.updateFx({ beams: v })} />
          </Row>
          <Row label="Screen flash" hint="Brief full-canvas flash on major clears (tinted per event type).">
            <Toggle value={s.fx.screenFlash} onChange={(v) => s.updateFx({ screenFlash: v })} />
          </Row>
          <Row label="Hard-drop dust" hint="Dust burst where a piece lands after a hard drop.">
            <Toggle value={s.fx.impact} onChange={(v) => s.updateFx({ impact: v })} />
          </Row>
          <Row label="Send number popups" hint="Big number showing the total lines sent by the current combo, with x-combo tags on combo sends and STREAK BROKEN warnings.">
            <Toggle value={s.fx.sendPopups} onChange={(v) => s.updateFx({ sendPopups: v })} />
          </Row>
          <Row label="Screen shake" hint="Camera shake on major clears; its strength follows the effects preset.">
            <Toggle value={s.shake} onChange={(v) => s.update({ shake: v })} />
          </Row>
          <Row label="Clear popups" hint="Text labels like TETRIS / T-SPIN / PERFECT CLEAR above the board.">
            <Toggle value={s.clearPopups} onChange={(v) => s.update({ clearPopups: v })} />
          </Row>
        </Section>

        <Section title="AI OPPONENT" onReset={s.resetAi}>
          <Row label="Mode" hint="FIXED = the bot plays at a constant PPS. ADAPTIVE = the bot speeds up when your stack is lower than its and eases off when it is ahead.">
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
          <Row label="AI PPS" hint="Target pieces per second for the bot. Higher = faster and harder; adaptive mode uses this as the base and scales around it.">
            <Slider value={s.ai.pps} min={0.3} max={5} step={0.1} onChange={(v) => s.updateAi({ pps: v })} />
          </Row>
          <Row label="Bot personality" hint="Stacking profile that decides how the bot builds (e.g. all-spins vs. tetris-heavy).">
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
          <Row label="Opponent board" hint="SMALLER = compact opponent board beside yours; SAME SIZE = full-size board matching your own.">
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

        <Section title="GAME PARAMETERS">
          <Row label="Single" hint="Lines sent by a 1-line clear (0 in the default table).">
            <span className="text-neutral-300">{s.attack.single}</span>
          </Row>
          <Row label="Double" hint="Lines sent by a 2-line clear.">
            <span className="text-neutral-300">{s.attack.double}</span>
          </Row>
          <Row label="Triple" hint="Lines sent by a 3-line clear.">
            <span className="text-neutral-300">{s.attack.triple}</span>
          </Row>
          <Row label="Tetris" hint="Lines sent by a 4-line clear.">
            <span className="text-neutral-300">{s.attack.tetris}</span>
          </Row>
          <Row label="Spin single" hint="Lines sent by a T/S/Z/J/L spin that clears 1 row.">
            <span className="text-neutral-300">{s.attack.spinSingle}</span>
          </Row>
          <Row label="Spin double" hint="Lines sent by a T/S/Z/J/L spin that clears 2 rows.">
            <span className="text-neutral-300">{s.attack.spinDouble}</span>
          </Row>
          <Row label="Spin triple" hint="Lines sent by a T/S/Z/J/L spin that clears 3 rows.">
            <span className="text-neutral-300">{s.attack.spinTriple}</span>
          </Row>
          <Row label="Perfect clear" hint="Lines sent when a clear empties the entire board.">
            <span className="text-neutral-300">{s.attack.perfectClear}</span>
          </Row>
          <Row label="Combo multiplier" hint="Each consecutive clear multiplies the base by 1 + 0.25 × combo (floored, no cap), so bigger clears gain more per combo step. Zero-base clears use ln(1 + 1.25 × combo) from the 2-combo on.">
            <span className="text-neutral-300">×(1 + 0.25 × combo)</span>
          </Row>
          <Row label="Back-to-back bonus" hint="Bonus lines added when a power clear (spin or tetris) immediately follows another power clear.">
            <span className="text-neutral-300">{s.attack.b2bBonus}</span>
          </Row>
          <Row label="Streak threshold" hint="A non-power clear that breaks a streak longer than this sends the streak length as bonus lines (e.g. >3 means a 4-streak break sends +4).">
            <span className="text-neutral-300">&gt; {s.attack.streakThreshold}</span>
          </Row>
          <Row label="Blitz spin score ×" hint="Blitz mode only: score multiplier applied to spin clears.">
            <span className="text-neutral-300">{s.scoring.blitzSpinMult}</span>
          </Row>
          <Row label="Blitz tetris score ×" hint="Blitz mode only: score multiplier applied to tetris clears.">
            <span className="text-neutral-300">{s.scoring.blitzTetrisMult}</span>
          </Row>
          <Row label="Blitz perfect-clear bonus" hint="Blitz mode only: flat bonus score for a perfect clear.">
            <span className="text-neutral-300">{s.scoring.blitzPcBonus}</span>
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
