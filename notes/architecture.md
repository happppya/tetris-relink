# Architecture Notes

How the codebase is organized. See tech-stack.md for tooling decisions and game-design.md for mechanics.

## Layers

```
server/          # Node + ws multiplayer server (plain `node server/index.ts`)
  index.ts       # WebSocket entry: connection lifecycle, lobby + match message routing, rejoin/grace buffers
  lobby.ts       # lobby membership, host transfer, settings
  registry.ts    # join-code registry, public list
  codes.ts       # join code generator
  session.ts     # authoritative match state: attack computation, garbage routing, targeting, wins
  match-session.ts # ties the engine `Match` (rounds/wins/eliminations) into a live session
  authority.ts   # board reconstruction from lock cells + deterministic garbage application + snapshot cross-check
  lossyproxy.ts  # test helper: drops server messages to simulate packet loss
  test-client.ts # shared multi-client simulator for socket tests
  *.test.ts      # lobby, lifecycle, disconnect, targeting, message-loss, multiclient, sequential-matches, load

shared/          # imported by both server and client (explicit .ts extensions)
  protocol.ts    # single source of truth for client<->server messages
  lobby-settings.ts # defaults, sanitization, descriptions
  board.ts       # board serialization + deterministic garbage application

src/
  engine/        # pure TS, zero DOM/React imports
    types.ts         # board dims, cell, piece, action types
    pieces.ts        # tetromino shapes, spawn states
    bag.ts           # 7-bag RNG (seedable, fixed-queue aware)
    srs.ts           # rotation + kick tables, collision, ghost
    scoring.ts       # guideline scores, gravity curve (level 0 = no natural gravity), blitz bonuses
    attack.ts        # attack table config + computeAttack (combo/streak/b2b); shared with the server
    match.ts         # series-of-games match state: wins, rounds, last-man-standing eliminations,
                     #   first-to-X / win-by-X end conditions, spectate/revive/AFK re-entry
    drills.ts        # practice drill catalog: preset boards, fixed queues, goals (engine-only; no UI yet)
    stackstats.ts    # stack quality metrics: holes, bumpiness, heights, stack top
    game.ts          # core simulation: tick(input) -> events; garbage queue/cancellation; snapshots
  game/
    runner.ts        # fixed-timestep accumulator + buffered action queue, mode end detection, reset()
    input.ts         # keyboard -> engine actions (DAS dir stack); shared drain/bind helpers
  render/
    canvas.ts        # playfield + mini-piece renderer (canvas 2D)
    effects.ts       # tiered visual effects system (cosmetic only; presets MINIMAL/MEDIUM/HIGH/ULTRA)
    cleartext.ts     # clear-label + send-number popup renderers (edge-clamped)
    PopupLayer.tsx   # transparent z-layered canvas above the board that popup VFX draws on
    spectator-fx.ts  # relay-diff clear detection for spectator boards
  ai/
    protocol.ts      # bot message types (worker <-> main)
    profiles.ts      # bot personalities / training weight profiles
    search.worker.ts # worker: cold-clear-2 wasm planning (single brain; reports 'unavailable' if wasm fails)
    cc2-wasm/        # generated wasm-bindgen pkg (rebuild via npm run build:cc2)
    botdriver.ts     # executes plans at configured PPS (versus AI)
    assistant.ts     # zen assist-mode hint client
    executor.ts      # builds per-frame input scripts that land a plan's placement exactly
    board.ts         # bot board helpers (placement cells, board diffing)
  state/
    settings.ts      # zustand store w/ localStorage persist (handling presets, fx config, keybinds)
    stats.ts         # records persistence
    zen.ts           # zen progression (xp/level) + zen mode settings
    lobby.ts         # createLobbyStore(conn) factory; useLobby singleton
    identity.ts      # per-tab selfId (sessionStorage) + persisted display name (localStorage)
  net/
    connection.ts    # WebSocket wrapper: heartbeat, latency, reconnect, server-URL resolution
    match-client.ts  # match netcode: locks, snapshots, garbage, resync, spectate/AFK, intermission
  ui/
    MainMenu, MenuList, SettingsMenu, StatsScreen, GameScreen, VersusScreen, ZenScreen,
    LobbyScreen, MultiplayerScreen, MultiplayerGameScreen, SpectatorBoard,
    GarbageMeter, StreakBox, format
  App.tsx / main.tsx
```

## Rules

1. `engine/` must never import from `ui/`, `render/`, or React. It is pure logic and fully unit-testable.
2. The game loop is a single `requestAnimationFrame` driving a fixed-timestep accumulator; it calls `game.tick()` and hands the result to the renderer.
3. React never re-renders per frame. HUD values are pushed via subscriptions at a throttled rate or refs. Game screens throttle `setHud`-style updates with a `lastHudUpdate > 100` guard — never update React state from the inner loop.
4. Settings changes take effect immediately in the running engine where possible (DAS/ARR/SDF/keybinds).
5. Particles/effects live behind the per-parameter effects config (`EffectsConfig` in `render/effects.ts`) with presets MINIMAL/MEDIUM/HIGH/ULTRA (default HIGH); each parameter can be tweaked individually and effects must never change gameplay behavior. Popup VFX (clear labels, send numbers) draws on a dedicated `PopupLayer` canvas above the board so it is never clipped or hidden behind side panels.

## Simulation & input

Gameplay and input are decoupled from the render framerate:

- The simulator (`GameRunner.advance`) runs in fixed 60Hz ticks via a capped accumulator (`STEP_MS = 1000/60`, max catch-up 200ms). Movement (DAS/ARR/SDF) and gravity are per-tick, so behavior is identical on any display refresh.
- **Discrete actions (rotate / hold / hard drop) are buffered inside the runner**, not dropped between ticks: `queueActions()` appends to an internal queue, and `advance()` consumes and clears that queue exactly once, on the first tick that actually runs. This guarantees a tap is never lost on frames where no tick fires (e.g. high-refresh displays) and never double-applied when one frame catches up several ticks. `clearActions()` discards buffered input (used on pause). `reset()` un-finalizes an ended runner so a multiplayer round change can reuse it.
- Input wiring is shared by every game screen through `game/input.ts`: `bindInput(keybinds)` attaches an `InputManager`, and `drainFrame(input, runner)` must be called **once per animation frame** — it drains, immediately calls `runner.queueActions`, and reports which control keys (retry/pause/assist/hard drop) were pressed. Draining without queueing is a bug that silently drops inputs.
- Handling timings are built from settings via `state/settings.ts::handlingFromSettings` (ms -> 60Hz frame counts), shared by all screens.

## Multiplayer model

- **Client-side simulation + server authority**: each client simulates its own board at full speed; input never waits on the network. On every lock the client sends the placed **cells**; the server reconstructs the authoritative board (`server/authority.ts`), computes attack from the shared table, routes garbage, and cross-checks throttled snapshots (~10Hz) — a matching snapshot is acked, a genuine divergence gets a corrective `resync`. A resync only ever fires on real divergence against the reconstructed board — never a blind overwrite, so a healthy stack can't be wiped.
- **Matches are series of games** (first-to-X / win-by-X), last-man-standing per game. The engine `Match` (`src/engine/match.ts`) is the shared source of truth for wins/rounds/eliminations and is driven identically by tests and the server (`server/match-session.ts`).
- **Garbage targeting**: manual / revenge / random, resolved server-side per attack with the documented fallbacks (see game-design.md). Targeting state resets each game.
- **Reconnect resilience**: an unexpected disconnect buffers the player for a grace window (sat out of the current game, never targeted); a refresh presents its persisted `selfId` and is offered a rejoin. Identity is per-tab (`sessionStorage`) so sibling tabs can't collide; the server holds live-member identity claims in a short window so a refresh racing its own close is the only way to inherit an identity.
- **Spectate / AFK**: players can toggle PLAY/SPECTATE mid-match, auto-spectate on death in N>2 games, and two-step leave (AFK → gone) with return-to-game.
- **Protocol**: `shared/protocol.ts` is the single source of truth for client↔server messages; the server runs with plain `node server/index.ts` (Node 22.18+ type stripping, explicit `.ts` import extensions).

## Determinism

- Fixed timestep simulation so DAS/ARR behave identically on any refresh rate.
- Bag RNG seeded with a seedable PRNG so games can be replayed later (nice-to-have).
