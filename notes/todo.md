# TODO — Requirements

Full requirement list for tetris-liberation: a fully frontend, singleplayer modern Tetris application.

Status legend: [ ] todo · [~] in progress · [x] done

## 1. Core game (modern Tetris guideline behavior)

- [x] 10x20 visible playfield (with hidden rows above for spawn)
- [x] 7-bag randomizer (seedable PRNG)
- [x] SRS (Super Rotation System) with standard wall/floor kicks
- [x] Hold piece (one slot, blocked until next lock)
- [x] Next queue showing **5 pieces** ahead
- [x] Ghost piece
- [x] Hard drop (instant lock)
- [x] Soft drop with adjustable **SDF** (soft drop factor)
- [x] **Zero line clear delay**: cleared rows vanish and next piece is controllable on the same frame
- [x] Lock delay (0.5s) with move-reset capped at 15 per piece
- [x] Guideline scoring (clears, T/S/Z/J/L-spins incl. mini, combos, back-to-back)
- [x] Level system with guideline gravity curve, configurable start level
- [x] Game over detection (block out / lock out)
- [x] Spawned piece is immediately visible: spawn straddles the hidden/visible boundary (top cells above the field, lowest row on the first visible row)

## 2. Input & handling settings

- [x] Configurable **DAS** (ms slider, converted to frames at 60Hz)
- [x] Configurable **ARR** (ms slider, 0 = instant wall movement)
- [x] Configurable **soft drop delay** (ms slider, 0 = instant drop to the ghost)
- [x] Full keybind remapping: left/right/soft/hard drop, CW, CCW, 180, hold, retry, pause
- [x] Settings persist across sessions (localStorage via zustand/persist)
- [ ] Presets for common handling configs — optional/nice to have

## 3. UI

- [x] Terminal-like interface: monospace, minimal borders, low-chroma palette
- [x] Color used strictly to communicate information (piece types, danger tint); no decorative color
- [x] Main menu: mode select, settings, stats
- [x] In-game HUD: score, level, lines, time, PPS (+ APM in versus/blitz contexts)
- [x] Settings menu sections: handling, keybinds, gameplay, visuals, AI, attack table
- [x] Keybind capture UI with conflict detection
- [x] Per-section "reset to defaults" in the settings menu
- [x] Settings export/import to local JSON files
- [x] Pause overlay
- [x] Game over screen with summary stats and retry
- [x] Keyboard-only interaction in game
- [x] Versus layout: next queue attached to top right of player board, opponent board (with full mirror display: hold, stats, streak, next queue) to its right; opponent board size configurable (same size / smaller) in settings

## 4. Visual effects (toggleable)

- [x] Global toggles in settings (particles / shake)
- [x] Clear text popups on line clears (SINGLE/DOUBLE/TRIPLE/TETRIS, T/S/Z-spins incl. mini, PERFECT CLEAR) with a settings toggle
- [x] Particle effects on line clears
- [ ] Particle effects on hard drop impact
- [x] Optional screen shake on tetris/t-spin/perfect clear
- [ ] Subtle lock flash — optional/nice to have

## 5. Stats & extras

- [x] Records persistence: 40 Lines best time, Blitz best score per duration, games played (stats screen)
- [x] Retry hotkey for instant restart

## 6. Game modes

- [x] Mode select on main menu: 40 Lines, Blitz, Competitive
- [x] **Zen mode**: endless mode with in-game settings sidebar (gravity, practice undo/redo via Ctrl+Z/Ctrl+Y, garbage modes: backfire / unclear / cheese layer with 0.5x/1x/2x rates), persistent XP total across runs, linearly scaling level requirements, level shown on the menu and level/XP in-game
- [x] **40 Lines (Sprint)**: clear 40 lines as fast as possible; fastest time recorded in localStorage; end-of-run summary with time/PPS
- [x] **Blitz**: 1 min / 3 min / 5 min variants; highest score per duration recorded in localStorage
- [x] Blitz bonus scoring: spins (configurable multiplier), tetrises (multiplier), perfect clears (flat bonus)
- [x] **Competitive mode**: player vs AI opponent on separate boards shown side by side
- [x] AI opponent via MinusKelvin's cold-clear-2 (https://github.com/MinusKelvin/cold-clear-2) — vendored under `vendor/cold-clear-2` with a wasm-bindgen wrapper (`vendor/cc2-wasm`); compiled to `src/ai/cc2-wasm` via `npm run build:cc2`. Single-threaded cooperative search on wasm (no COOP/COEP needed). cc2 is the sole planner: the worker executes its top-ranked suggestion verbatim (spins/tucks included); if wasm fails to init it reports an explicit `unavailable` message instead of silently degrading. Rebuild with `npm run build:cc2` after touching either crate.
- [x] Survival regression test: headless cc2 + executor harness must clear steadily without topping out (`src/ai/survival.test.ts`)
- [x] Fix: `play()` x-coordinate round-trip in the wasm wrapper had an inverted sign (`cc = our + our_min − cc_min`, not `our − our_min + cc_min`), so replays of T/I/J/S/Z placements threw "played placement was not part of the current suggestion" — bot idled to the hard-drop failsafe in versus and hint chains failed instantly in zen. Rebuilt `src/ai/cc2-wasm` via `npm run build:cc2`.
- [x] Fix: assist hints were late/missing/shifting — HintProvider never sent `seq` so replies matched whichever request was pending (stale replies clobbered fresh ones); the worker had no cancellation and burned full searches on superseded queued requests; future hints were rendered against the live board instead of each step's predicted board. Now: seq-matched replies, worker skips superseded requests before pumping, per-step predicted boards drive rendering, hold/divergence clears the chain, and empty chains self-heal via a throttled re-request.
- [x] Fix: assist stalled once the stack grew tall — each self-heal re-request superseded the pending one and resolved it with an empty list, clobbering hints in a loop whenever search exceeded the 250ms throttle. Replies are now seq-tagged and stale ones ignored; re-requests only fire after the latest request was answered.
- [x] Assist pipeline stays full: every consumed hint tops the chain back up to the configured count immediately (not just when exhausted). The worker continues an existing search when a request matches the board+piece state its last chain ended on (same DAG cursor, no stop/start), so refills are fast and suggestions stay consistent.
- [x] Fix continuation regressions: cc2 hedges blindly once its search cursor advances past the seeded queue (`suggest()` returns an empty list), so continuations are gated on remaining known queue depth (restart re-seeds the live queue); hint requests are always answered even when empty so the requester's await flag can't stick; superseded provider replies now carry a void seq (0) so they can never match a caller's captured seq and clobber state.
- [x] **Hold awareness**: cc2's search cannot generate hold swaps itself (single-piece DAG layers), so the worker plans both options when a usable hold exists — play the falling piece vs. swap-then-play-held, in fresh equally-budgeted searches — and keeps the better line by eval score. The wrapper exposes per-candidate `eval` (`Evaluation::score`) and accepts the hold piece in `start()`; the chosen swap is flagged on plan/hints messages, executed by the versus driver (hold action prepended to the input search), and shown as a SWAP indicator for zen hints. Requests now carry the real hold state (null when blocked), so undo/redo snapshots that restore hold produce correctly-fresh plans.
- [x] Fix: executing the advised swap used to wipe and replan the hint chain. A hold that matches the advice now slices the chain (like following a placement) and the refill reproduces it exactly — branch B's search root now models the real post-swap hold slot (old falling piece), making pre-swap and post-swap searches bit-identical. Unprompted swaps still replan, correctly.
- [x] Bot executor: cold-clear-2 plans exact placements (cells + spin intent); the driver searches real per-frame inputs (engine snapshot simulation) to lock pieces exactly on plan — including genuine T-spin rotations. PPS setting paces placements; stale plans are dropped via request sequence numbers; poisoned wasm instances are recycled automatically.
- [x] Opponent board viewable at all times during competitive play (side-by-side layout)
- [x] Attack table for garbage sent to opponent, all values adjustable in settings:
  - Perfect clear = 10 lines
  - Tetris = 4 lines
  - Triple = 2 lines
  - Double = 1 line
  - Spin triple = 6 lines
  - Spin double = 4 lines
  - Spin single = 2 lines
- [x] Combo mechanic: consecutive clearing placements increment combo; combo multiplies garbage sent (step + cap configurable)
- [x] Streak mechanic: consecutive Tetris/spin clears build a streak; when broken, send lines equal to the streak length — only if streak > threshold (adjustable, default 3)
- [x] Garbage lines arrive greyed out (visually distinct from piece colors)
- [x] Incoming garbage indicator (pending count in HUD)
- [x] Garbage cancelling: clears offset pending incoming garbage; surplus forwarded to opponent
- [x] Incoming garbage meter (thin red bar beside the board)
- [x] AI difficulty is adjustable:
  - [x] Direct PPS (pieces per second) setting for the AI
  - [x] Optional adaptive mode: AI speeds up or slows down based on relative stack height, keeping matches competitive
- [x] **Assist mode** (zen mode): a keybind toggles a hint overlay showing what the bot would do next, while the user keeps full control of placement; setting for how many upcoming bot placements to show at a time (1-4)
- [x] **Bot training profiles**: multiple bot behavior presets via weight configs shaped like cold-clear-2's `BotConfig`, each targeting a trainable skill — spin finding (SPIN FINDER), perfect clears (PERFECT CLEAR), clean stacking (CLEAN STACKER), back-to-back maintenance (B2B KEEPER), and overall optimal play (OPTIMAL); selectable for assist hints in zen setup and as the versus opponent personality. Profiles serialize directly into cold-clear-2's `BotConfig` for the wasm planner (`src/ai/search.worker.ts`); the weighted TS search that previously backed them was removed in favor of cc2 as the single brain.
- [x] Stats available to the player live during play and in end-of-run summaries:
  - PPS (pieces per second)
  - APM (attack per minute)
  - Time
  - Plus per-mode records (best sprint time, best blitz scores)

## 7. Engineering

- [x] Project scaffold: Vite + React + TS + Tailwind (see tech-stack.md)
- [x] Strict TypeScript config
- [x] Pure game logic modules fully separated from React/rendering (`src/engine/`)
- [x] Fixed-timestep simulation loop decoupled from render (60Hz accumulator)
- [x] Unit tests (Vitest): 7-bag distribution, SRS kick tables + rotation, DAS/ARR timing, SDF, scoring, line clears, garbage, attack/combo/streak math, spin detection
- [x] Lint configured (oxlint); Prettier optional
