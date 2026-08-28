# TODO — Multiplayer Migration

Requirement list for migrating tetris-liberation from a fully local singleplayer app to multiplayer tetris. This list supersedes the previous singleplayer requirement list (removed — singleplayer features are considered complete and remain untouched). See `notes/multiplayer-plan.md` for the implementation plan.

Status legend: [ ] todo · [~] in progress · [x] done

## 1. Multiplayer foundation

- [x] Real-time networked play: players on different machines can play tetris against each other in the same match; the game is no longer limited to local and AI opponents.
- [x] Low latency: fast-paced play must stay responsive. Local input must never wait on the network; attacks and garbage land with minimal delay under normal network conditions, and the client should surface connection quality (latency) so players can see it.
- [x] Desync handling: clients that drift out of sync with the authoritative game state are detected and corrected (resynced) rather than silently diverging. Desyncs caused by lost/duplicated messages or client bugs must be recoverable mid-match without restarting the session.

## 2. Lobbies

- [x] Lobby creation from the main menu: a player creates a lobby and becomes its host.
- [x] Join code: every lobby is assigned a short join code made of letters and numbers at creation; the code is unique among active lobbies and shown to the host and players so others can join with it.
- [x] Join by code: any player can enter a join code to join that lobby.
- [x] Public vs private: the creator chooses at creation whether the lobby is public (listed on a public registry) or private (joinable only by code).
- [x] Public registry: a "lobbies" tab in the main menu lists public lobbies — host name, player count, and a summary of room settings — and allows joining directly from the list.
- [x] The lobby dissapears and gets cleaned up nicely after all players leave.

## 3. Lobby view

- [x] Players land in a lobby view after creating or joining a lobby, before any match starts.
- [x] Roster: the lobby view shows who is in the lobby, with the host clearly marked.
- [x] Room settings: the lobby view shows the room settings (scoring options, etc.) to everyone in the lobby.
- [x] Host-only editing: only the host can change room settings; changes apply live and are visible to all players in the lobby.
- [x] Leaving: players can leave the lobby at any time; if the host leaves, the lobby is transferred to the next oldest member without stranding the remaining players.

## 4. Match lifecycle

- [x] Host start: when the host clicks start, all players in the lobby transition together into an active session (match).
- [x] Rounds: a match is a series of games; each game is last-man-standing — players who top out are eliminated and the game continues until one survivor remains; the result is shown, and the next game starts automatically until the match win condition is met.
- [x] Match end: when the match's win condition is met, the session ends, results are shown to all players, and players return to the lobby view.
- [x] Disconnects: a player disconnecting mid-match must not crash or hang the session; remaining players are notified, a mid-game disconnect forfeits that game, and the match resolves according to the disconnect policy.

## 5. Competitive scoring options

- [x] Matches are decided by games won, not by lines sent: the match win condition is evaluated across a series of games, never inside a single board.
- [x] Last-man-standing: a player who tops out is eliminated for that game and play continues; the game ends when only one player remains, and that survivor wins the game.
- [x] First to X: the match ends as soon as a player has won X games (X is host-configurable; e.g., first to 5, first to 7, first to X).
- [x] Win by X: the match only ends when a player leads by at least X games won (e.g., win by 2), so a one-game lead cannot close the match; ties and smaller leads keep the match going.
- [x] Room settings: scoring mode and its values are room settings adjustable by the host before the match starts.
- [x] Between games: a brief results screen shows who won the game and the running match score, then the next game starts automatically.
- [x] Progress display: each player's wins and the match goal are visible in the HUD during play (e.g., 3/7).
- [x] Simultaneous top-out: if the final players top out at the same time there is no survivor, and the game resolves per policy (recommended: no win awarded, game replayed).

## 6. Multiplayer competitive view

- [x] 1v1 layout: with a single opponent, the existing side-by-side view is preserved (player's board on the left, opponent board with mirror info on the right).
- [x] N-player layout: with more than one opponent, the player's board stays on the left and all opponent boards are shown to the right of the player's board.
- [x] Per-opponent info: each opponent view shows their board plus per-player info (name, wins, incoming garbage, streak).
- [x] Scaling: opponent boards scale so any number of opponents (up to the lobby cap) fits on screen.
- [x] Elimination display: topped-out players are marked as eliminated (e.g., dead board) for the rest of the game, and they can no longer be targeted.

## 7. Garbage targeting

- [x] Targeting modes: when sending garbage, the player chooses where it goes via three modes — manual, revenge, random — switched with the number keys (defaults 1/2/3).
- [x] Manual: the player clicks an opponent's board to select them as the target; attacks go to that opponent until changed.
- [x] Revenge: attacks go to the opponent who most recently attacked the player.
- [x] Random: attacks go to a randomly chosen opponent.
- [x] Target icon: in all modes, a target icon is shown over the board of the player currently being targeted.
- [x] Fallbacks: if the current target is eliminated or disconnected, manual auto-reassigns to a random living opponent (mode unchanged) and revenge falls back to the most recent living attacker, then to random; when only one opponent remains, all modes route to them.
- [x] Targeting applies to all garbage sent by clears (attacks, combos, streaks); with a single opponent the modes still exist but routing is trivially moot.
- [x] Targeting state (mode, manual target, attacker history) resets at the start of each game.

## 8. Engineering & testing

- [x] Server component: a small server hosts lobbies, the public registry, and match relay; it is the authority on room settings, scoring, targeting, and desync resolution.
- [x] Shared protocol: a single source of truth for the message types shared between client and server, so the two sides cannot drift apart.
- [x] Tests: match win conditions (first-to-X, win-by-X) and round flow, targeting routing, lobby lifecycle, and desync detection/resync are unit-tested; at least one simulated message-loss test proves attacks/garbage stay consistent when messages are dropped.
- [x] Docs updated: `notes/tech-stack.md` and `AGENTS.md` are updated as the stack and project rules change (the project is no longer "no backend").
