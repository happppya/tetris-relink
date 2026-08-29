import { describe, expect, it } from 'vitest'
import { Game } from '../engine/game'
import { MatchClient, type MatchClientState } from './match-client'
import { emptyBoard, serializeBoard } from '../../shared/board.ts'
import type { PieceType } from '../engine/types'
import type { ClientMessage, ServerMessage } from '../../shared/protocol.ts'

function harness(fixedQueue: PieceType[] = ['I']) {
  const game = new Game({ mode: 'versus', sendsGarbage: true, fixedQueue })
  const sent: ClientMessage[] = []
  let handler: ((msg: ServerMessage) => void) | null = null
  const client = new MatchClient({
    game,
    matchId: 'm1',
    send: (msg) => sent.push(msg),
    onMessage: (h) => {
      handler = h
      return () => {
        handler = null
      }
    },
    selfId: () => 'a',
  })
  const states: MatchClientState[] = []
  client.subscribe((s) => states.push(s))
  return { game, client, sent, feed: (msg: ServerMessage) => handler!(msg), states }
}

const gameStart = (round = 1): ServerMessage => ({ type: 'game_start', round, players: [], board: serializeBoard(emptyBoard()) })

describe('MatchClient', () => {
  it('sends one lock with the placed visible cells per non-clearing placement', () => {
    const { game, client, sent } = harness()
    // hard-drop the I straight down into the bottom row
    const events = game.tick({ dir: 0, softDrop: false, actions: ['hardDrop'] })
    client.handleEvents(events)
    const lock = sent.find((m): m is Extract<ClientMessage, { type: 'lock' }> => m.type === 'lock')
    expect(lock).toBeDefined()
    expect(lock!.lock.cells).toEqual([{ x: 3, y: 19 }, { x: 4, y: 19 }, { x: 5, y: 19 }, { x: 6, y: 19 }])
    expect(lock!.lock.rows).toBe(0)
  })

  it('queues incoming garbage on the local game', () => {
    const { game, feed } = harness()
    feed({ type: 'garbage', lines: 2, hole: 0, from: 'b' })
    expect(game.pendingGarbage).toBe(2)
  })

  it('game_start resets board, hold, combo, streak and clears opponents', () => {
    const { game, client, feed } = harness(['I', 'I', 'T'])
    // hold the I, then place a piece so hold is populated and combo state exists
    client.handleEvents(game.tick({ dir: 0, softDrop: false, actions: ['hold'] }))
    client.handleEvents(game.tick({ dir: 0, softDrop: false, actions: ['hardDrop'] }))
    expect(game.hold).toBe('I')
    expect(game.board.some((row) => row.some((c) => c !== null))).toBe(true)

    feed({ type: 'board_update', playerId: 'b', board: serializeBoard(emptyBoard().map((r, i) => (i === 19 ? ['T', ...r.slice(1)] : r))), score: 0, pendingGarbage: 0, round: 1 })
    expect(client.getState().opponents['b']).toBeDefined()

    feed(gameStart(2))
    expect(game.hold).toBeNull()
    expect(game.combo).toBe(0)
    expect(game.streak).toBe(0)
    expect(game.board.every((row) => row.every((c) => c === null))).toBe(true)
    expect(client.getState().opponents).toEqual({})
    expect(client.getState().round).toBe(2)
  })

  it('drops board relays from a previous round (stale carryover)', () => {
    const { client, feed } = harness()
    feed(gameStart(1))
    feed({ type: 'board_update', playerId: 'b', board: serializeBoard(emptyBoard()), score: 0, pendingGarbage: 0, round: 1 })
    expect(client.getState().opponents['b']).toBeDefined()
    // round 2 begins; a round-1 relay still in flight must not repopulate the board
    feed(gameStart(2))
    expect(client.getState().opponents).toEqual({})
    feed({ type: 'board_update', playerId: 'b', board: serializeBoard(emptyBoard().map((r, i) => (i === 19 ? ['S', ...r.slice(1)] : r))), score: 0, pendingGarbage: 0, round: 1 })
    expect(client.getState().opponents['b']).toBeUndefined()
    feed({ type: 'board_update', playerId: 'b', board: serializeBoard(emptyBoard().map((r, i) => (i === 19 ? ['S', ...r.slice(1)] : r))), score: 0, pendingGarbage: 0, round: 2 })
    expect(client.getState().opponents['b']).toBeDefined()
  })

  it('applies a resync board and re-queues the pending garbage', () => {
    const { game, client, feed } = harness()
    const withPiece = emptyBoard().map((row, i) => (i === 19 ? ['T', ...row.slice(1)] : row))
    feed({ type: 'resync', board: serializeBoard(withPiece), pendingGarbage: 3, score: 50 })
    expect(serializeBoard(game.board.slice(-20))).toBe(serializeBoard(withPiece))
    expect(game.score).toBe(50)
    expect(game.pendingGarbage).toBe(3)
    expect(client.resyncs).toBe(1)
  })

  it('sends throttled snapshots of the visible board', () => {
    const { game, client, sent } = harness()
    // 29 frames: no snapshot yet
    for (let i = 0; i < 29; i++) game.tick({ dir: 0, softDrop: false, actions: [] })
    client.maybeSendSnapshot()
    expect(sent.some((m) => m.type === 'snapshot')).toBe(false)
    game.tick({ dir: 0, softDrop: false, actions: [] })
    client.maybeSendSnapshot()
    const snap = sent.find((m): m is Extract<ClientMessage, { type: 'snapshot' }> => m.type === 'snapshot')
    expect(snap).toBeDefined()
    expect(snap!.board).toBe(serializeBoard(game.board.slice(-20)))
    expect(snap!.seq).toBe(1)
    expect(snap!.matchId).toBe('m1')
  })

  it('snapshots carry hold, next queue, and lines for the opponent view', () => {
    const { game, client, sent } = harness(['I', 'I', 'O', 'T'])
    client.handleEvents(game.tick({ dir: 0, softDrop: false, actions: ['hold'] }))
    expect(game.hold).toBe('I')
    for (let i = 0; i < 30; i++) game.tick({ dir: 0, softDrop: false, actions: [] })
    client.maybeSendSnapshot()
    const snap = sent.find((m): m is Extract<ClientMessage, { type: 'snapshot' }> => m.type === 'snapshot')
    expect(snap).toBeDefined()
    expect(snap!.hold).toBe('I')
    // the fixed prefix ['I','I','O','T'] is consumed deterministically: the
    // first I is held, the second becomes active, then O and T lead the queue
    expect(snap!.next!.slice(0, 2)).toEqual(['O', 'T'])
    expect(snap!.lines).toBe(game.lines)
  })

  it('player_spectating for self marks this client spectating and gates all gameplay sends', () => {
    const { game, client, sent, feed } = harness(['I'])
    feed(gameStart(1))
    feed({ type: 'player_spectating', playerId: 'a', spectating: true })
    expect(client.getState().spectating).toBe(true)
    // no locks, snapshots, or topouts leave while spectating
    client.handleEvents(game.tick({ dir: 0, softDrop: false, actions: ['hardDrop'] }))
    for (let i = 0; i < 30; i++) game.tick({ dir: 0, softDrop: false, actions: [] })
    client.maybeSendSnapshot()
    client.sendTopout()
    expect(sent.some((m) => m.type === 'lock' || m.type === 'snapshot' || m.type === 'topout')).toBe(false)
    // the server still relays opponent state so the spectator view stays live
    feed({ type: 'board_update', playerId: 'b', board: serializeBoard(emptyBoard()), score: 0, pendingGarbage: 0, round: 1, hold: 'T', next: ['S'] })
    expect(client.getState().opponents['b']).toBeDefined()
    // un-spectating (next match / rejoining as player) resumes sends
    feed({ type: 'player_spectating', playerId: 'a', spectating: false })
    expect(client.getState().spectating).toBe(false)
    client.maybeSendSnapshot()
    expect(sent.some((m) => m.type === 'snapshot')).toBe(true)
  })

  it('player_spectating marks the opponent as watching', () => {
    const { client, feed } = harness()
    feed(gameStart(1))
    feed({ type: 'player_spectating', playerId: 'b', spectating: true })
    expect(client.getState().opponents['b']?.spectating).toBe(true)
    feed({ type: 'player_spectating', playerId: 'b', spectating: false })
    expect(client.getState().opponents['b']?.spectating).toBe(false)
  })

  it('player_afk marks the opponent AFK and prunes the stale board; returning unmarks', () => {
    const { client, feed } = harness()
    feed(gameStart(1))
    feed({ type: 'board_update', playerId: 'b', board: serializeBoard(emptyBoard().map((r, i) => (i === 19 ? ['T', ...r.slice(1)] : r))), score: 10, pendingGarbage: 0, round: 1, hold: 'T', next: ['S'] })
    expect(client.getState().opponents['b']!.board.length).toBe(20)
    feed({ type: 'player_afk', playerId: 'b', afk: true })
    const opp = client.getState().opponents['b']!
    expect(opp.afk).toBe(true)
    expect(opp.board).toEqual([])
    // returning to the game clears the marker; the board repopulates via relays
    feed({ type: 'player_afk', playerId: 'b', afk: false })
    expect(client.getState().opponents['b']!.afk).toBe(false)
    feed({ type: 'board_update', playerId: 'b', board: serializeBoard(emptyBoard()), score: 0, pendingGarbage: 0, round: 1, hold: null, next: [] })
    expect(client.getState().opponents['b']!.board.length).toBe(20)
  })

  it('a match_end with no winner reads MATCH OVER', () => {
    const { client, feed } = harness()
    feed({ type: 'match_end', winnerId: null, wins: {}, scores: {} })
    expect(client.getState().finished).toBe(true)
    expect(client.getState().error).toBe('MATCH OVER')
  })

  it('a round win opens the intermission with ranked round scores, and match_end keeps it', () => {
    const { client, feed } = harness()
    feed(gameStart(1))
    feed({ type: 'game_end', round: 1, winnerId: 'b', eliminatedIds: [], wins: { a: 0, b: 1 }, scores: { a: 450, b: 1200 } })
    const intermission = client.getState().intermission
    expect(intermission).not.toBeNull()
    expect(intermission!.winnerId).toBe('b')
    expect(intermission!.scores).toEqual({ a: 450, b: 1200 })
    expect(intermission!.wins).toEqual({ a: 0, b: 1 })
    // game_start for the next round does NOT wipe the scoreboard (the UI owns
    // dismissing it after the short intermission)
    feed(gameStart(2))
    expect(client.getState().intermission).not.toBeNull()
    // the final round's match_end keeps the scoreboard up through the exit window
    feed({ type: 'match_end', winnerId: 'b', wins: { a: 0, b: 1 }, scores: { a: 450, b: 1200 } })
    expect(client.getState().intermission!.scores).toEqual({ a: 450, b: 1200 })
    expect(client.getState().finished).toBe(true)
  })

  it('clearIntermission on the UI dismissal stops the scoreboard from being resurrected by a later relay', () => {
    const { client, feed } = harness()
    feed(gameStart(1))
    feed({ type: 'game_end', round: 1, winnerId: 'b', eliminatedIds: [], wins: { a: 0, b: 1 }, scores: { a: 450, b: 1200 } })
    expect(client.getState().intermission).not.toBeNull()
    // the UI dismissed the scoreboard after its timeout; a later relay must not
    // re-open it the way it would if MatchClient kept a stale intermission
    client.clearIntermission()
    expect(client.getState().intermission).toBeNull()
    feed({ type: 'board_update', playerId: 'b', board: serializeBoard(emptyBoard()), score: 0, pendingGarbage: 0, round: 2 })
    expect(client.getState().intermission).toBeNull()
    // a brand-new round ending still opens a fresh intermission
    feed({ type: 'game_end', round: 2, winnerId: 'a', eliminatedIds: [], wins: { a: 1, b: 1 }, scores: { a: 300, b: 100 } })
    expect(client.getState().intermission).not.toBeNull()
    expect(client.getState().intermission!.round).toBe(2)
  })

  it('a mid-round elimination does not open an intermission (the round continues)', () => {
    const { client, feed } = harness()
    feed(gameStart(1))
    feed({ type: 'game_end', round: 1, winnerId: null, eliminatedIds: ['c'], wins: {}, scores: { a: 100, b: 200, c: 300 } })
    expect(client.getState().intermission).toBeNull()
  })

  it('prunes a leaving opponent: board, hold, next, and stats are cleared', () => {
    const { client, feed } = harness()
    feed(gameStart(1))
    const withPiece = emptyBoard().map((r, i) => (i === 19 ? ['J', ...r.slice(1)] : r))
    feed({ type: 'board_update', playerId: 'b', board: serializeBoard(withPiece), score: 120, pendingGarbage: 3, round: 1, lines: 4, hold: 'T', next: ['S', 'Z', 'L'] })
    expect(client.getState().opponents['b']!.board.length).toBe(20)

    feed({ type: 'player_left', playerId: 'b' })
    const opp = client.getState().opponents['b']
    expect(opp).toBeDefined()
    expect(opp!.left).toBe(true)
    expect(opp!.alive).toBe(false)
    // the leaver is pruned from the view: no board, no pieces, no stats
    expect(opp!.board).toEqual([])
    expect(opp!.hold).toBeNull()
    expect(opp!.next).toEqual([])
    expect(opp!.score).toBe(0)
    expect(opp!.lines).toBe(0)
    expect(opp!.incoming).toBe(0)
  })

  it('stores the opponent\'s hold, next queue, and lines from a board_update relay', () => {
    const { client, feed } = harness()
    feed(gameStart(1))
    const withPiece = emptyBoard().map((r, i) => (i === 19 ? ['J', ...r.slice(1)] : r))
    feed({ type: 'board_update', playerId: 'b', board: serializeBoard(withPiece), score: 120, pendingGarbage: 3, round: 1, lines: 4, hold: 'T', next: ['S', 'Z', 'L'] })
    const opp = client.getState().opponents['b']
    expect(opp).toBeDefined()
    expect(opp!.board.length).toBe(20)
    expect(opp!.score).toBe(120)
    expect(opp!.lines).toBe(4)
    expect(opp!.incoming).toBe(3)
    expect(opp!.hold).toBe('T')
    expect(opp!.next).toEqual(['S', 'Z', 'L'])
  })
})
