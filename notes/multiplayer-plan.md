# Multiplayer Implementation Plan

Implementation plan for migrating tetris-liberation from a fully local singleplayer app to multiplayer tetris. Companion to `notes/todo.md` (the requirement list). This file records architecture decisions, the protocol, and the phased work plan. Update it as decisions land.

## 1. Scope

**In scope**
- Server-hosted lobbies: create, join by code, public registry, public/private visibility
- Lobby view: roster, room settings, host editing
- Live multiplayer matches with N players
- Competitive scoring: first-to-X and win-by-X, decided across a series of games
- N-player competitive view with garbage targeting (manual / revenge / random)
- Desync detection and mid-match resync

**Out of scope (v1)**
- Singleplayer modes (40 Lines, Blitz, Zen) — untouched
- Spectators, replays, in-game chat
- Matchmaking / ranked ladder
- Reconnect to an in-progress match (disconnect = leave the match)
- Hard anti-cheat (server-side attack validation is the baseline)

## 2. Architecture

### 2.1 Topology

```
browser (Vite app)  <--WebSocket-->  server (Node.js + ws, new server/)
```

- New `server/` directory: Node.js + `ws`, plain TypeScript, no framework. Owns lobbies, the registry, sessions, and authoritative match state.
- `shared/protocol.ts`: single source of truth for message types, imported by both server and client (wire up via tsconfig paths or a small shared workspace — decide in Phase 0).
- Client: the existing Vite app gains `src/net/` (connection + codec), `src/state/lobby.ts` and `src/state/session.ts` (zustand stores), and new screens under `src/ui/`.
- Dev flow: `npm run server` + `npm run dev`. Production: the server must run somewhere WebSocket-capable — GitHub Pages cannot host WebSockets (open decision, §9).

### 2.2 Netcode model — client-side simulation + server authority

The genre standard (TETR.IO/Jstris-style):

- Each client simulates its own board locally at full speed. Input → action is instant; the network never sits in the input path. This is what satisfies the low-latency requirement: only small event messages (clears, targets, snapshots) travel the wire.
- On every lock, the client sends a `lock` event (rows cleared, spin info, combo, streak). The server computes the attack value from the room's attack table, applies it to its authoritative copy of the target's board, and relays `garbage` to the target client.
- Clients send board snapshots on lock and at a throttled cadence (~10Hz). The server cross-checks each snapshot against its authoritative copy.

**Why not lockstep / rollback:** the engine is deterministic and fixed-timestep, so lockstep is *possible*, but lockstep delays every input by at least one RTT (perceptible in fast play) and requires all clients to tick in perfect lockstep. Rollback (GGPO-style) gives zero input delay but is substantially more complex (state journals, prediction, correction) for little gain in tetris, where each player's own board is private and only attacks cross the wire. Client-side simulation keeps local play identical to today and confines network effects to garbage arrival, which is already a queued mechanic.

### 2.3 Desync handling

Desync sources: lost/duplicated messages, client bugs, clock drift, tampering.

- The server is the authority on: room settings, attack values, garbage queues, wins/eliminations, targeting, and each player's board (via snapshots).
- Server-side per-player state: `board`, `pendingGarbage`, `score`, `wins`, `round`, `targetMode`, `manualTarget`, `attackerHistory`.
- Detection: server compares each incoming client snapshot against its authoritative copy. Mismatch → server sends `resync` with the authoritative board + pending garbage + score + wins + round; the client applies it and play continues. No session restart.
- Correctness rule: client and server must apply the *same* garbage rules (garbage lands on the next non-clearing placement; clears cancel incoming garbage first, surplus forwards). These rules already live in `src/engine/` and are documented in `notes/game-design.md` — the server imports the same pure engine logic so both sides cannot drift by construction.
- Snapshot bandwidth is trivial: 200 cells ≈ a few hundred bytes at 10Hz per player.

## 3. Protocol

JSON messages over a single WebSocket. All messages carry `type`; server → client messages that must be ordered (garbage, resync) carry a `seq`. Catalog:

| Direction | Message | Payload | Notes |
|---|---|---|---|
| C→S | `hello` | name | first message after connect |
| C→S | `create_lobby` | name, visibility, settings | creator becomes host |
| C→S | `join_lobby` | code | |
| C→S | `leave_lobby` | — | also implied by disconnect |
| C→S | `settings_update` | settings | host only; server validates |
| C→S | `start_match` | — | host only |
| C→S | `list_lobbies` | — | fetch the public registry |
| C→S | `lock` | rows, spin info, combo, streak | server computes attack from room table |
| C→S | `snapshot` | board | on lock + throttled (~10Hz) |
| C→S | `topout` | board snapshot at death | server validates; player eliminated for the game |
| C→S | `target` | mode, manualTarget? | mode switch or manual selection |
| C→S | `ready` | — | match-start barrier |
| C→S | `ping` | t | latency probe |
| S→C | `welcome` | selfId, name, latency | |
| S→C | `lobby_state` | code, visibility, hostId, roster, settings | full state on join |
| S→C | `roster_update` | joined/left, hostId? | deltas |
| S→C | `settings_update` | settings | broadcast to lobby |
| S→C | `match_start` | matchId, players, settings | all clients start together (barrier on `ready`); starts round 1 |
| S→C | `garbage` | lines, from | queued to the target |
| S→C | `snapshot_ack` / `resync` | board, pendingGarbage, score, wins, round | resync only on mismatch |
| S→C | `target_update` | playerId, mode, targetId | broadcast so icons render everywhere |
| S→C | `game_end` | round, winnerId, eliminatedIds, wins | broadcast; interstitial + countdown |
| S→C | `game_start` | round, players | next game begins |
| S→C | `match_end` | winner, results | → everyone returns to lobby |
| S→C | `lobby_list` | lobbies | public registry: code, host name, player count, settings summary |
| S→C | `error` | code, message | |
| S→C | `pong` | t | |

## 4. Server design (`server/`)

- **Join codes**: 5 characters from an unambiguous alphabet (no 0/O, 1/I/L), unique among active lobbies; regenerate on collision. Displayed in the lobby view with a copy affordance.
- **Registry**: list of public lobbies (host name, player count, settings summary). Private lobbies are never listed.
- **Lobby lifecycle**: when the last player leaves, the lobby is destroyed immediately and removed from the registry; an idle-expiry safety net catches abandoned lobbies; host disconnect → transfer to earliest joiner (recommended) or dissolve (§9).
- **Match authority**: per-player authoritative state (§2.3), attack computation from the room's attack table (reusing `src/engine/attack.ts`), targeting routing (§7), match win conditions (§6).
- **Round management**: tracks the round counter, per-player wins, and per-game eliminations; validates top-outs against the authoritative board; broadcasts `game_end` when one survivor remains, starts the next game after the countdown, and ends the match when the win condition is met.
- **Disconnect policy**: a mid-match disconnect removes the player from the session; 1v1 → match ends and the remaining player returns to the lobby; N>2 → match continues without them (recommended, §9).
- **Latency**: heartbeat ping/pong every ~2s; latency shown in the HUD.

## 5. Client design (`src/`)

- `net/connection.ts` — WebSocket wrapper: connect, reconnect to lobby state (not mid-match), heartbeat, latency measurement, message dispatch.
- `net/protocol.ts` — client-side mirror of `shared/protocol.ts` types.
- `state/lobby.ts` — zustand store: current lobby (code, roster, settings, hostId), create/join/leave actions.
- `state/session.ts` — zustand store: match state (players, wins, round, targets, garbage), driven by server messages.
- `ui/MainMenu.tsx` — add a Multiplayer entry: Create Lobby form (name, public/private), Join by Code, and a Lobbies tab rendering the public registry.
- `ui/LobbyScreen.tsx` — roster, join code display, room settings (read-only for non-hosts, editable for host), Start button (host only), Leave.
- `ui/MultiplayerScreen.tsx` — refactor of `VersusScreen` (§8 Phase 4): player board left, opponent boards right, per-opponent mini-HUD, target icons, click-to-target, number-key mode switching.
- Keybinds: add targeting actions to the existing keybind system with defaults 1/2/3 (manual/revenge/random).

## 6. Competitive scoring — series of games

- Matches are decided by **games won**, not lines sent. Top-out is the only way to lose a game; the match win condition is evaluated across a series of games.
- **Game flow**: every player starts each game with a fresh board under the same room settings. Last-man-standing: a player who tops out is eliminated for that game and play continues; when only one player remains, that survivor wins the game. A game-end interstitial shows the result and the running match score, then the next game starts automatically after a short countdown. The match ends when the win condition is met; everyone returns to the lobby.
- **First to X**: the match ends when a player has won X games (X host-configurable; sensible defaults 5/7).
- **Win by X**: the match ends only when a player leads by at least X games won (default 2). Ties and smaller leads keep the match going. Same wins tracking as first-to-X; only the end predicate differs.
- **Simultaneous top-out** (rare): if the final players top out at the same time there is no survivor — draw, no win awarded, the game is replayed (recommended; see §9).
- **Disconnect mid-game** counts as a forfeit: the disconnected player loses that game.
- End-condition logic lives in pure engine code (`src/engine/`) so it is unit-testable and shared with the server.
- HUD: wins + goal per player (e.g., `3/7`); the game-end interstitial shows who won the game and the updated match score; the match-end overlay shows the winner and final results.

## 7. Garbage targeting

Per-player, per-game targeting state, reset at every game start: `targetMode` (`manual` | `revenge` | `random`), `manualTarget`, and `attackerHistory` (players who attacked you, most recent first). The server is the sole owner of this state; clients only send mode switches and manual selections (`target`).

Routing rules, evaluated per attack in order:

1. **Single living opponent**: all modes trivially route to that opponent. (The game ends at one survivor, so a living player always has ≥ 1 living opponent.)
2. **Manual**: attack goes to `manualTarget`. If the manual target is eliminated or disconnects, the mode is **kept** but the target is auto-reassigned to a uniform-random living opponent and a `target_update` is broadcast; the player can re-click to re-target at any time. Decided: manual mode never silently degrades to random — the player's intent is "directed attacks", only the identity of the target is re-picked.
3. **Revenge**: attack goes to the most recent **living** attacker in `attackerHistory`. If the last attacker is eliminated, revenge falls back down the history to the next most recent living attacker. If no living attacker exists (nobody attacked you this game, or every attacker is gone), fall back to uniform-random among living opponents.
4. **Random**: uniform-random among living opponents, re-rolled per attack.

Ordering: the server is single-threaded and processes messages in arrival order; WebSocket guarantees per-connection ordering, so "most recent" and simultaneous-attack ties are resolved deterministically by arrival order. An attack already in flight when its sender tops out lands normally (it was sent while alive); once the server processes a player's topout, that player's messages are rejected and they can no longer attack.

Target icon: manual and revenge show the current target; random shows the target of the most recent roll (updates per attack). Icons are driven by server broadcasts (`target_update`) so all clients agree.

Edge cases decided:
- Last attacker eliminated → revenge falls back down the living-attacker history, then to random.
- Manual target eliminated → auto-reassign to a random living opponent, mode unchanged.
- All-but-one eliminated → all modes route to the sole survivor.
- No living opponents → impossible while alive (game ends at one survivor); defensively, the attack is dropped.
- Targeting state (mode, manual target, attacker history) resets at every game start.

## 8. Phased work plan

Status: **Phase 0 ✅ · Phase 1 ✅ · Phase 2 ✅ · Phase 3 (server half) ✅**. Phases 3 (client half) – 5 remain.

### Phase 0 — Server & protocol skeleton — ✅ done
- Add `server/` (Node + ws, TS), `shared/protocol.ts`, tsconfig wiring.
- Add `src/net/connection.ts` with heartbeat/latency.
- **Exit criteria**: client and server exchange ping/pong over localhost; protocol types are shared, not duplicated.

### Phase 1 — Lobbies — ✅ done
- Server: lobby CRUD, join codes, registry, visibility, host transfer, expiry.
- Client: multiplayer entry in main menu, create/join forms, lobbies tab, LobbyScreen (roster, settings, host editing, start).
- **Exit criteria**: two browser tabs can create/join/leave a lobby, see each other and live settings updates; a public lobby appears in the registry.
- Tests: join-code uniqueness/collision, join/leave flows, host disconnect.

### Phase 2 — Competitive scoring (series of games) — ✅ done

- Engine: `src/engine/match.ts` — wins tracking, round state, last-man-standing eliminations, first-to-X / win-by-X end conditions, draw/replay, forfeits; emits `eliminated` / `game_won` / `game_draw` / `match_won` events for the server to relay. Settings type is structurally identical to `shared/protocol.ts` `LobbySettings`.
- Room settings UI for scoring mode + values (landed in Phase 1); HUD wins display and game-end interstitial are deferred to Phase 3 (they need live match state).
- **Exit criteria**: met — 20 unit tests covering last-man-standing elimination, first-to-X, win-by-X, draws, and forfeits.

### Phase 3 — Live match sync
- Protocol: `lock`, `snapshot`, `garbage`, `resync`, `match_start`/`ready` barrier, `match_end`.
- Server (done): `server/session.ts` authoritative per-player state (board + score + pending garbage), attack computation from the room table (`src/engine/attack.ts`), deterministic garbage application (`shared/board.ts` — hole at column 0 so server and client can never disagree), snapshot cross-check with `resync`/`snapshot_ack`, `match_start` broadcast, `lock`/`snapshot` handlers. `server/lossyproxy.ts` simulates message loss for tests.
- Client (pending): multiplayer game loop wired into the existing fixed-timestep runner; garbage receive; snapshot sender; resync application. Note: the client's engine garbage holes are random — aligning it to the deterministic `shared/board.ts` representation is part of this work.
- **Exit criteria**: two clients play a full match with consistent boards; injected message loss does not permanently desync (resync recovers).
- Tests: attack math, garbage rules, desync detection + resync, simulated message loss (server half done: `server/session.test.ts` + `server/message-loss.test.ts`).

### Phase 4 — N-player view & targeting
- Refactor `VersusScreen` → `MultiplayerScreen`: player board left, N opponent boards right with per-opponent mini-HUD; boards scale to the lobby cap.
- Targeting: modes, number keys, target icons, click-to-target; server routing + revenge bookkeeping.
- **Exit criteria**: 3+ players in one match; targeting works per mode; icons correct on all clients.
- Tests: routing rules and fallbacks.

### Phase 5 — Hardening, docs, deployment
- Latency display polish, empty-lobby expiry, error surfacing, edge cases (host leaves mid-match, all-but-one disconnect).
- Docs: update `AGENTS.md` (backend rule), `notes/tech-stack.md` (new deps/decisions), `README.md` (run instructions).
- Deployment: stand up the server somewhere WebSocket-capable; wire client server-URL config (dev vs prod).
- **Exit criteria**: a real cross-machine match plays cleanly; the desync drill passes.

## 9. Open decisions

| Decision | Recommendation | Notes |
|---|---|---|
| Simultaneous top-out | draw — no win awarded, game replayed | only when the final players top out together |
| Next-game start | auto after a short countdown (~5s) | host-triggered alternative |
| Server deployment | small VPS / Fly.io / Render | GitHub Pages can't host WebSockets |
| Max players per lobby | 8 | drives board scaling in the N-player view |
| Mid-match disconnect | 1v1: end match; N>2: remove and continue | |
| Host leaves lobby | transfer to earliest joiner | |
| Targeting keys | remappable, defaults 1/2/3 | consistent with the existing keybind system |

## 10. Testing strategy

- Engine tests (Vitest, existing harness): match win conditions and round flow, garbage rules, attack math.
- Server tests (Vitest, Node): lobby lifecycle, join codes, targeting routing, authoritative state, resync trigger. Server logic is pure TS — most tests need no sockets; keep the socket layer thin.
- Integration: two WebSocket clients against one server running full matches, with a loss-injection layer to prove desync recovery.
- Manual: two browser tabs / two machines; latency check; N-player targeting drill.