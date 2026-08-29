# Architecture Notes

How the codebase is organized. See tech-stack.md for tooling decisions and game-design.md for mechanics.

## Layers

```
server/          # Node + ws multiplayer server (plain `node server/index.ts`)
  index.ts       # WebSocket entry: lobby + match message handling
  lobby.ts       # lobby membership, host transfer, settings
  registry.ts    # join-code registry, public list
  codes.ts       # join code generator
  session.ts     # authoritative match state: attack computation, garbage routing, target/score; reconstructs each player's board from lock cells and sends a real resync on divergence
  lossyproxy.ts  # test helper: drops server messages to simulate packet loss
shared/          # imported by both server and client (explicit .ts extensions)
  protocol.ts    # single source of truth for client<->server messages
  lobby-settings.ts # defaults, sanitization, descriptions
  board.ts       # board serialization + deterministic garbage application

src/
  engine/        # pure TS, zero DOM/React imports
    types.ts         # board dims, cell, piece, action types
    pieces.ts        # tetromino shapes, spawn states
    bag.ts           # 7-bag RNG (seedable)
    srs.ts           # rotation + kick tables, collision, ghost
    scoring.ts       # guideline scores, gravity curve, blitz bonuses
    attack.ts        # attack table config, combo/streak math
    match.ts         # series-of-games match state: wins, rounds, last-man-standing eliminations, first-to-X / win-by-X end conditions
    drills.ts        # practice drill catalog: preset boards, fixed queues, goals
    stackstats.ts    # stack quality metrics: holes, bumpiness, heights, stack top
    game.ts          # core simulation: tick(input) -> events
  game/
    runner.ts        # fixed-timestep accumulator + buffered action queue, mode end detection
    input.ts         # keyboard -> engine actions (DAS dir stack); shared drain/bind helpers
  render/
    canvas.ts        # playfield + mini-piece renderer (canvas 2D)
    effects.ts       # tiered visual effects system (cosmetic only; levels 1-5)
   ai/
     protocol.ts      # bot message types (worker <-> main)
     profiles.ts      # bot personalities / training weight profiles
      search.worker.ts # worker: cold-clear-2 wasm planning (single brain; reports 'unavailable' if wasm fails)
     cc2-wasm/        # generated wasm-bindgen pkg (rebuild via npm run build:cc2)
     botdriver.ts     # executes plans at configured PPS
     assistant.ts     # zen assist-mode hint client
   state/
     settings.ts      # zustand store w/ localStorage persist
     stats.ts         # records persistence
     zen.ts           # zen progression (xp/level) + zen mode settings
   ui/
     MainMenu, SettingsMenu, StatsScreen, GameScreen, VersusScreen, ZenScreen ...
  App.tsx / main.tsx
```

## Rules

1. `engine/` must never import from `ui/`, `render/`, or React. It is pure logic and fully unit-testable.
2. The game loop is a single `requestAnimationFrame` driving a fixed-timestep accumulator; it calls `game.tick()` and hands the result to the renderer.
3. React never re-renders per frame. HUD values are pushed via subscriptions at a throttled rate or refs. Game screens throttle `setHud`-style updates with a `lastHudUpdate > 100` guard — never update React state from the inner loop.
4. Settings changes take effect immediately in the running engine where possible (DAS/ARR/SDF/keybinds).
5. Particles/effects live behind the per-parameter effects config (`EffectsConfig` in `render/effects.ts`) with presets MINIMAL/MEDIUM/HIGH/ULTRA (default HIGH); each parameter can be tweaked individually and effects must never change gameplay behavior.

## Simulation & input

Gameplay and input are decoupled from the render framerate:

- The simulator (`GameRunner.advance`) runs in fixed 60Hz ticks via a capped accumulator (`STEP_MS = 1000/60`, max catch-up 200ms). Movement (DAS/ARR/SDF) and gravity are per-tick, so behavior is identical on any display refresh.
- **Discrete actions (rotate / hold / hard drop) are buffered inside the runner**, not dropped between ticks: `queueActions()` appends to an internal queue, and `advance()` consumes and clears that queue exactly once, on the first tick that actually runs. This guarantees a tap is never lost on frames where no tick fires (e.g. high-refresh displays) and never double-applied when one frame catches up several ticks. `clearActions()` discards buffered input (used on pause).
- Input wiring is shared by every game screen through `game/input.ts`: `bindInput(keybinds)` attaches an `InputManager`, and `drainFrame(input, runner)` must be called **once per animation frame** — it drains, immediately calls `runner.queueActions`, and reports which control keys (retry/pause/assist/hard drop) were pressed. Draining without queueing is a bug that silently drops inputs.
- Handling timings are built from settings via `state/settings.ts::handlingFromSettings` (ms -> 60Hz frame counts), shared by all screens.


## Determinism

- Fixed timestep simulation so DAS/ARR behave identically on any refresh rate.
- Bag RNG seeded with a seedable PRNG so games can be replayed later (nice-to-have).
