# Architecture Notes

How the codebase is organized. See tech-stack.md for tooling decisions and game-design.md for mechanics.

## Layers

```
src/
  engine/        # pure TS, zero DOM/React imports
    types.ts         # board dims, cell, piece, action types
    pieces.ts        # tetromino shapes, spawn states
    bag.ts           # 7-bag RNG (seedable)
    srs.ts           # rotation + kick tables, collision, ghost
    scoring.ts       # guideline scores, gravity curve, blitz bonuses
    attack.ts        # attack table config, combo/streak math
    game.ts          # core simulation: tick(input) -> events
  game/
    runner.ts        # fixed-timestep accumulator, mode end detection
    input.ts         # keyboard -> engine actions (DAS dir stack)
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
3. React never re-renders per frame. HUD values are pushed via subscriptions at a throttled rate or refs.
4. Settings changes take effect immediately in the running engine where possible (DAS/ARR/SDF/keybinds).
5. Particles/effects live behind the global effects-level setting (`EFFECT_LEVELS` 1-5 in `render/effects.ts`); level 1 disables them entirely and must not change gameplay behavior.

## Determinism

- Fixed timestep simulation so DAS/ARR behave identically on any refresh rate.
- Bag RNG seeded with a seedable PRNG so games can be replayed later (nice-to-have).
