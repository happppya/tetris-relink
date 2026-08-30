# Bugs & TODOs — multiplayer round / garbage fixes

Reported during testing on a prod server with 2 players. **Status: all fixed**
(the `Do not fix yet` hold was lifted). Each bug has a reproduction test in
`src/net/multiplayer-regressions.test.ts` that now passes; those tests are the
regression net for the fixes below.

## BUG 01 — Round scoreboard shows the round outcome, not the running match score

**Symptom:** The intermission scoreboard goes up by one on the first win. If
the same player wins again it still reads 1. If the other player wins next it
reads 1 : 0 — always crediting exactly 1 to the round winner. It should show
the actual running score (rounds won), incrementing by 1 per win each round.

**Root cause:** `server/index.ts` `emitMatchEvents` builds the scoreboard rows
from `roundScores(...)`, which reports ONLY the round outcome (`winner +1,
everyone else 0`) instead of the cumulative `match.wins()` tally. Logically the
scoreboard should equal `wins` (rounds won).

**Intended fix:** `roundScores` in `server/round-scores.ts` should return the
cumulative per-player wins (`match.wins()`), not a per-round 1/0. The
`Intermission` `scores` field then carries the running total through the
overlay.

**Repro:** `src/net/multiplayer-regressions.test.ts` (scoreboard) — returns
`{ a: 2, b: 0 }` after two wins by `a`.

## BUG 02 — Garbage holes all land in the left-most column

**Symptom:** Every garbage line is received with its hole in column 0.

**Root cause:** `server/session.ts` `move()` forwards surplus attack by calling
`queueGarbage(target.auth, surplus, 0)` — the hole is hard-coded to `0`. That
hole is echoed to the client over the wire, so both the authoritative board and
the engine place every hole at column 0.

**Intended fix:** pick a random hole (engine already has a `randomHole()`
range: `0..9`, or `3..6` in four-wide) at send time so hole columns vary, and
send/apply that same hole so authoritative + client boards agree.

**Repro:** `src/net/multiplayer-regressions.test.ts` (garbage hole) — across
several `move()`s the routed holes are not all `0`.

## BUG 03 — APM is wildly inflated on the second round

**Symptom:** On the 2nd round, APM (and effectively "lines sent per minute")
is wrong, because total attack (including last round's `sentLines`) is divided
by the time since the start of the *current* round.

**Root cause:** `src/net/match-client.ts` `game_start` resets `frames`,
`piecesPlaced`, `score`, `lines`, `combo`, etc. on `game.restore(...)` but NOT
`sentLines`. `Game.apm = sentLines * 3600 / frames`, so with `sentLines` carried
over and `frames` near 0 at round start, APM explodes.

**Intended fix:** reset `sentLines: 0` on the round transition
(`game_start` restore) so APM measures only the current round. The single-player
versus/zen round equivalents (rematch/reset) should do the same if they reuse a
running `Game`.

**Repro:** `src/net/multiplayer-regressions.test.ts` (APM reset) — after
`game_start` (round 2) + one tick, `game.apm` is huge instead of 0.

## BUG 04 — Inputs are not blocked while the scoreboard is up

**Symptom:** With the intermission scoreboard overlay shown, key presses are
still collected, so a piece can be accidentally placed the moment the
scoreboard dismisses.

**Root cause:** `src/ui/MultiplayerGameScreen.tsx` calls
`drainFrame(input, runner)` on every animation frame, including while
`intermissionRef.current` is set. Discrete actions (hard drop / rotate / hold)
are buffered into the `GameRunner`'s action queue, and the loop only skips
`runner.advance(...)` during the intermission — so the buffered inputs fire
unsolicited once the overlay clears. `runner.reset()` (fired at the round
change) clears whatever was queued before the reset, but anything pressed while
the scoreboard is up survives into the next round.

**Intended fix:** don't accept/keep inputs while the intermission is active —
either stop draining/binding input during the intermission or clear the queued
actions when it shows (and keep them blocked until it dismisses). Game should
only start after the scoreboard disappears.

**Repro:** `src/net/multiplayer-regressions.test.ts` (intermission input) —
actions queued during the "scoreboard" window must not place a piece when play
resumes on the next round.

## BUG 05 — "MATCH POINT" shows on the winner's final scoreboard

**Symptom:** Match point is correct on the actual match-point round, but it
also prints "MATCH POINT" on the scoreboard after a player has already won the
match. It should read "WINNER" in that case.

**Root cause:** `shared/lobby-settings.ts` `isMatchPoint()` uses
`mine >= goal - 1` for first-to-X, so once a player reaches `goal` (they've
already won) it still returns true and `ui/MultiplayerGameScreen.tsx`
`IntermissionOverlay` renders the "MATCH POINT" tag for them on the final
scoreboard.

**Intended fix:** `isMatchPoint` should be false once the player already reached
the goal (`mine >= goal`), and the overlay should label the eventual winner
"WINNER" on the final/`final` scoreboard.

**Repro:** `src/net/multiplayer-regressions.test.ts` (match point) —
`isMatchPoint({a:3,b:2}, goal:3, 'a')` is `false` (already won), not `true`.

## BUG 06 — Garbage should be delivered at most 8 lines at a time

**Symptom:** All queued garbage lands at once (on the next placement without a
clear), instead of at most 8 rows at a time with the remainder staying owed.

**Root cause:** engine `Game.applyGarbage` (`src/engine/game.ts`) and server
`BoardAuthority.applyQueued`/`cancelToSurplus` paths apply the ENTIRE queue on a
non-clearing placement. There is no per-placement cap.

**Intended fix:** deliver at most 8 rows on a non-clearing placement and take
that many away from the total, keeping the rest queued. This applies everywhere
the queued `receiveGarbage` path is used: multiplayer server + client, zen
backfire, and versus AI. (`receiveGarbageNow`/zen "unclear" is the separate
"instant" mode; leave it instant.)

**Repro:** `src/net/multiplayer-regressions.test.ts` (garbage cap) — after
queueing 20 and one non-clearing placement, only 8 land
(`pendingGarbage === 12`), not 0; and the same for the authoritative board.