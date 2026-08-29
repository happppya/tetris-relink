# Practice & Learning Design

Ideas and roadmap for the practice tools: how players learn openers, stacking concepts,
and spin placement in tetris-relinked. Companion to `todo.md` (requirements) and
`architecture.md` (module layout).

## Shipped (v1)

- **Drill system** (`src/engine/drills.ts`): preset board + fixed queue + measurable goal.
  Categories: T-spins (TSD pockets), perfect clear (PCO), openers (TKI, DT Cannon),
  stacking (flat stack, well discipline).
- **Stack analyzer** (`src/engine/stackstats.ts`): live HOLE / BUMP / PEAK readouts in zen HUD.
- **Goal tracking**: complete/fail overlays, max-piece limits, hole-fail condition.
- Drills compose with existing tools: assist hints (cc2 profiles) show the intended line,
  undo/redo lets players experiment, retry restarts the drill instantly.

Design principles:

1. Every drill is *verifiable* — a goal kind the engine can score (spin clears, PC,
   lines, tetrises, clean placements). No honor-system drills.
2. Spin drills are proven solvable by a BFS over real placements under SRS first-fit
   kick semantics (`drills.test.ts`). If the solver cannot do it, players cannot either.
3. Teaching text lives in `tips` and is shown in-context (zen setup sidebar), not behind docs.

## Curriculum idea: a learning path

Order drills as a progression rather than a flat list:

1. **Stacking fundamentals** — flat stacking, hole avoidance, well discipline.
   These come first: openers assume clean stacking instincts.
2. **Opener shapes** — fixed-queue replays of TKI / DT Cannon / PCO. Muscle memory
   through repetition; assist hints demonstrate the line before the player commits.
3. **Spin placement** — recognize pockets in real stacks. Start from preset pockets
   (shipped), then "freestyle" variants: random mid-height stacks with a guaranteed
   pocket carved out.
4. **Transfer** — normal zen/marathon play with the analyzer visible; success = the
   metrics (holes, bumpiness, spins per 100 pieces) improving over time.

## Future drill ideas

- **Finesse trainer**: count finesse errors per placement using minimal-input pathing;
  show error count + the ideal input string after each piece. Needs a finesse table module.
- **TST tower / T-spin single setups**: more presets once a richer solvability checker
  exists (multi-piece BFS or cc2-assisted validation).
- **PC finish trainer**: pre-stack the last 4 rows minus one PC-solvable shape; goal:
  perfect clear within N pieces.
- **Skim/downstack drills**: start with a tall garbage stack; goal: clear it below N rows
  with minimum pieces (efficiency scored).
- **Daily seeded challenge**: fixed seed + mode, leaderboard vs. your own history.
- **Custom board editor**: draw a stack, save it as a personal drill, share as JSON.

## Stacking concepts worth teaching in-game

Concepts the analyzer + drills can surface incrementally:

- **Bumpiness budget**: keep adjacent-column height deltas ≤ 2; the BUMP readout makes
  the number visible while the flat-stack drill enforces consequences.
- **Hole cost**: one buried hole costs ~4 pieces to fix at speed; HOLES counter plus
  fail-on-hole drills teach avoidance before it happens.
- **Well commitment**: pick the well early (side columns are easier); WELL DISCIPLINE
  drill rewards committing for multiple tetrises instead of flip-flopping.
- **Piece freedom**: prefer placements that keep future I/J/L/S/Z placements legal —
  a future "freedom score" could quantify placements kept open per piece.
- **Opener literacy**: knowing 2-3 openers (TKI, PCO, DT Cannon) covers most first-bag
  patterns; fixed queues turn them into muscle memory, then randomized queues force
  adaptation (hold usage, mirrored builds).

## Engine notes

- Drill boards are plain row strings parsed by `parseDrillBoard`; `X` renders as neutral
  grey (`G`) so preset walls are visually distinct from placed pieces.
- `Game` accepts `initialBoard` and `fixedQueue`, so any mode could reuse drills
  (e.g., a future "drill marathon" mixing scenarios).
