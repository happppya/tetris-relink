# Tech Stack

Decision record for the tetris-liberation tech stack. Update this file when a decision changes.

## Chosen stack

| Concern | Choice | Rationale |
|---|---|---|
| Build tool | Vite | Fast HMR, zero-config TS, ideal for SPA-only projects |
| Framework | React 18 + TypeScript (strict) | User preference; strong typing matters for game logic (piece states, SRS kick tables) |
| Styling | Tailwind CSS | User preference; fits the terminal-like minimal UI well |
| Playfield rendering | HTML5 Canvas (via a single `<canvas>` element) | 60fps piece movement, particle effects, and zero line-clear delay animations are far cheaper on canvas than DOM re-renders. React only owns the surrounding UI chrome. |
| Game loop | `requestAnimationFrame` outside React | The loop must never be tied to React render cycles; state flows into React via refs/subscriptions |
| Global state | Zustand | Tiny, no boilerplate, easy persistence middleware for settings in localStorage |
| Settings persistence | localStorage via Zustand persist | Fully frontend, no backend needed |
| Testing | Vitest | Pairs with Vite; game logic (bag RNG, SRS kicks, DAS/ARR timing) must be unit tested |
| Lint/format | oxlint (scaffold default); Prettier optional | Fast, zero-config |
| Competitive AI | cold-clear-2 compiled to WASM, running in a Web Worker — **wired** | Vendored at `vendor/cold-clear-2` (pinned upstream snapshot) with a `wasm-bindgen` wrapper (`vendor/cc2-wasm`) exposing start/pump/play/suggest; built to `src/ai/cc2-wasm` via `npm run build:cc2`. Vendored patches, all wasm-only or cosmetic: public `bot`/`sync` modules, thread-free `spawn_workers`, cooperative `pump_work`, puffin profiling stripped, `Instant` stubbed on wasm (removes the bare `env.now` std import; `scripts/patch-cc2.mjs` re-applies glue fixups after every rebuild). Runs single-threaded by design — no COOP/COEP or SharedArrayBuffer needed; search budget scales via `pump()` iterations. Training profiles map onto cc2's `BotConfig` weights (`cc2ConfigJson`). Falls back to the built-in weighted TS search if the wasm module fails to load. |
| Web Workers | Vite built-in worker support (`new Worker(new URL(...), { type: 'module' })`) | For bot inference so gameplay stays smooth |

## Key architectural notes

- **Game logic is pure TypeScript**, decoupled from React. Modules: bag RNG, piece definitions, SRS rotation/kick tables, gravity/DAS/ARR/soft-drop-delay timing engine, lock/clear logic.
- **Renderer is swappable**: canvas now; DOM/WebGL possible later. Logic never touches rendering APIs.
- **Timing model**: DAS/ARR/soft drop delay measured in frames at fixed timestep (e.g., 60Hz simulation) so behavior is deterministic regardless of display refresh rate.
- No backend. Everything runs client-side.

## Alternatives considered

- **PixiJS / WebGL** â€” overkill for now; plain canvas 2D is sufficient for particles at this scale. Revisit if effects become heavy.
- **Svelte/Solid** â€” fine choices but user prefers React ecosystem.
- **CSS-grid DOM playfield** â€” simpler but struggles with per-frame updates and particle systems.
