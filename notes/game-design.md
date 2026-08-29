# Game Design Notes

Reference for modern Tetris guideline mechanics as implemented in tetris-relinked.

## Playfield & pieces

- 10 columns x 20 visible rows; spawn area is rows above the visible field (guideline: pieces spawn in rows 21-22). Pieces spawn straddling the boundary — top cells above the field, lowest row on the first visible row — so a new piece is immediately visible.
- 7 tetrominoes: I, O, T, S, Z, J, L. Standard colors are allowed but should stay muted to fit the terminal aesthetic.
- Pieces spawn flat-side down, centered, in their guideline spawn orientations.

## 7-bag randomizer

- Shuffle all 7 pieces into a bag; deal from it; refill when empty.
- Guarantees no piece drought longer than 12 pieces.
- Next queue must always show 5 upcoming pieces (so keep >= 5 dealt ahead internally).

## SRS

- Standard kick tables for JLSTZ and a separate table for I. O does not kick.
- Test order matters — implement exactly per guideline tables (see tests).
- Support CW, CCW rotations; 180 rotation uses a dedicated kick set (SRS does not standardize it): `(0,0) (+1,0) (-1,0) (0,-1 up)` — wall kicks plus one floor kick. `kickTable()` must be total: every (piece, from, to) combination returns a non-empty table.

## Timing model

- All handling timings in **frames at 60Hz fixed timestep** (convert ms -> frames where needed):
  - DAS: delay before auto-shift starts (default guideline ~10-17f)
  - ARR: interval between auto-shifts (0 = instant move)
  - Soft drop delay: interval between soft drop steps (0 = instant drop to the ghost); natural gravity still applies concurrently, so the faster of the two wins
  - Lock delay: 0.5s with up to 15 move/rotation resets per piece; hard drop locks instantly.
  - Gravity follows guideline level curve (e.g., `(0.8 - ((level - 1) * 0.007)) ^ (level - 1)` seconds per row).

## Zero line clear delay

- Cleared rows disappear immediately; gravity of the stack above applies on the same frame the piece locks.
- No animation pause between lock and next piece control. Particles are purely cosmetic overlays; clear-label and send-number popups draw on a dedicated `PopupLayer` canvas above the board so they are never clipped at the board edge or hidden behind side panels.

## Scoring (guideline)

- Single 100, Double 300, Triple 500, Tetris 800 (x level); T-spins: mini 100/200, TS single 800, double 1200, triple 1600; combo bonus 50 x combo x level; back-to-back x1.5 for tetris/T-spin clears.
- Soft drop 1 pt/cell, hard drop 2 pts/cell.

## Spins

- All rotations are recognized, not just T: S-spins, Z-spins, J-spins, and L-spins (T-spin mini variants included).
- A spin clear requires the piece to have rotated as its last action and be in an immovable position; use guideline-ish detection (kick index check) — keep the detector generic so S/Z work.

## Competitive mode: attacks & garbage

All values live in a single config object so they are easily adjustable.

### Base attack table

| Clear | Lines sent |
|---|---|
| Perfect clear | 10 |
| Tetris | 4 |
| Triple | 2 |
| Double | 1 |
| Spin triple | 6 |
| Spin double | 4 |
| Spin single | 2 |

Applies to T, S, Z, J, and L spins alike.

Non-clearing placements and plain singles send nothing.

### Combo

- Each consecutive placement that clears lines increments combo; a non-clearing placement resets it to 0.
- Attack scales exactly as `floor(base * (1 + 0.25 * combo))` with **no cap** (larger bases gain more absolute lines per combo step). Zero-base attacks (e.g. singles with a 0 table value) instead grow via `floor(ln(1 + 1.25 * combo))` from the 2-combo on, so long chains of weak clears eventually send something. Same formula on client and server (shared `computeAttack`).

### Streak

- Tetris or any spin clear increments the streak. Any other clear or non-clearing placement breaks it.
- Consecutive power clears (Tetris, any spin, perfect clear) build the streak: N in a row -> streak N.
- Non-clearing placements do not affect the streak. Only a non-power clear (plain single/double/triple) breaks it.
- When the streak breaks, send `streak` extra lines — **only if streak > 3** (threshold + value adjustable).
- An active streak is shown in the HUD as a boxed number whose size and color intensity scale with the streak length (up to 200).

### Garbage

- Garbage lines arrive greyed out (distinct from piece colors).
- Incoming queue indicator showing pending garbage.
- Garbage cancelling: your clear's attack value offsets pending incoming garbage first (4 incoming - 2 cleared = 2 received); surplus beyond pending is forwarded to the opponent.
- Incoming cancellable garbage only arrives after a placement **without** a clear; clearing placements never take garbage.

## AI opponent

- Uses MinusKelvin's cold-clear-2 (https://github.com/MinusKelvin/cold-clear-2), Rust -> WASM. No custom AI. (The original cold-clear is archived; cold-clear-2 is the active rewrite, MIT/Apache-2.0, and implements the Tetris Bot Protocol.)
- Runs on a Web Worker so the main thread keeps 60fps; single-threaded by design, so no COOP/COEP headers or SharedArrayBuffer are needed (see tech-stack.md for the vendored build).

### Bot modes & training profiles

- Implemented as weight profiles (`src/ai/profiles.ts`) mirroring cold-clear-2's freestyle `BotConfig` shape, serialized into the cc2 wasm planner (`src/ai/search.worker.ts`). The worker executes cc2's top-ranked suggestion verbatim — never substituting lower-ranked hard-drop-only placements, which measurably degrades play.
- Profiles: OPTIMAL (upstream-style defaults), SPIN FINDER (maximized tslot/spin rewards, wasted-T penalty), PERFECT CLEAR (high PC bonus + override, hole-tolerant), CLEAN STACKER (dominant holes/height/transition penalties), B2B KEEPER (boosted back-to-back terms).
- Profiles apply to the versus opponent personality and to zen-mode assist hints.

### Assist mode

- Zen mode only. The assist keybind (default G, remappable) toggles an overlay of bot suggestions while the user retains full control; a sidebar toggle enables the feature and selects profile + hint count.
- Configurable hint count (1-4): upcoming bot placements drawn as fading piece outlines at their target landing spots.

### Difficulty adjustment

The AI's speed is adjustable in two ways:

- **Fixed PPS**: a direct pieces-per-second setting; the AI places pieces at that rate regardless of the game state.
- **Adaptive mode**: the AI's target PPS shifts based on how the player is doing — e.g., scaling up when the player is ahead (low stack height / few garbage rows received) and easing off when the player is behind. The mapping from player state to AI speed should be data-driven and configurable (same config object as the attack table).

## Four-wide mode

A variant toggle for zen and multiplayer lobbies: grey `W` walls fill the side columns (0-2 and 7-9), leaving a 4-cell-wide well (3-6). A row clears when the centre 4 fill (the sides are always occupied); fresh rows re-lay the walls; perfect clears are impossible by design. Garbage/cheese holes are clamped into the well. Server authorities are walled too and reject placements into the wall.

## Zen mode

Endless practice mode with an in-game settings sidebar and persistent progression.

- **Gravity**: adjustable level 0-19, applies live to the running game. Level 0 disables natural gravity entirely (the piece only moves via soft/hard drop); scoring uses level 1 in that case so clears still score.
- **Practice mode**: Ctrl+Z / Ctrl+Y undo/redo of placements via engine snapshots (board, hold, score, bag queue and RNG state).
- **Garbage** (select one, default *none*):
  - *None*: no garbage.
  - *Backfire* (0.5x / 1x / 2x): your attack lines are multiplied and queued back into your board after a placement without a clear; only the surplus attack (the lines actually sent after cancelling pending garbage) comes back, and it can be cancelled by later clears.
  - *Unclear* (0.5x / 1x / 2x): multiplied attack lines are pushed into your board instantly on clear.
  - *Cheese layer*: the bottom 6 rows are always garbage lines with one random hole each; holes stay stable while a row remains cheese, and rows eaten by clears regenerate as fresh cheese.
- **Four-wide** toggle: grey walls fill the side columns, leaving a 4-cell well.
- A thin red meter beside the board shows pending incoming garbage.
- **Progression**: every point scored flows into a persisted XP total at all times. Level requirements scale linearly (`base * level`); the level is shown next to the menu entry and level/XP below the board during play.

## Multiplayer

Server-hosted lobbies and live matches over WebSockets; the server is authoritative for room settings, attack values, targeting, and every player's board (see architecture.md for the netcode model).

- **Matches are series of games** decided by games won, never lines sent. Each game is last-man-standing: a top-out eliminates the player for that game; one survivor wins it. End conditions: **first-to-X** (a player reaches X wins) or **win-by-X** (a player leads by at least X). A simultaneous final top-out is a draw — no win awarded, the game replayed. Disconnects forfeit the current game; leavers are removed permanently. Match logic lives in `src/engine/match.ts`.
- **Rounds**: after each game an intermission scoreboard shows the round winner (+1) and the running match score, then the next game starts automatically; players with enough wins get a MATCH POINT marker.
- **Garbage targeting** (per player, reset each game): *manual* (attacks go to the clicked opponent; if they die, auto-reassign to a random living opponent, mode kept), *revenge* (most recent living attacker, falling back down history then to random), *random* (uniform re-roll per attack). With one living opponent all modes route to them. The server owns targeting state and broadcasts target updates so all clients agree.
- **Garbage routing**: a clear's attack first cancels pending incoming garbage on the attacker (only cancellable garbage; surplus beyond pending is forwarded), then the remaining lines route to the target. Garbage arrives on a placement **without** a clear.
- **Reconnect**: an unexpected disconnect buffers the player for a grace window (sat out of the game, never targeted); a refresh offers rejoin via the persisted per-tab `selfId`. **Spectate/AFK**: players toggle PLAY/SPECTATE mid-match (spectators never targeted, can't win), auto-spectate on death in N>2 games, and two-step leave (AFK, then gone) with return-to-game.
- **Desync handling**: the server reconstructs each board from the cells every `lock` carries and cross-checks throttled snapshots — a match is acked, a genuine divergence gets a corrective `resync`. Anti-corruption rule: a resync only fires on real divergence, never a blind overwrite (a lost/duplicated message surfaces on the authority board and is healed via resync).
