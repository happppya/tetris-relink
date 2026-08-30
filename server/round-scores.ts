import type { Match } from '../src/engine/match.ts'

/**
 * The intermission scoreboard values for a finished round: the running match
 * score (rounds won) for every player, incrementing by one each time they win a
 * round. The `winnerId` identifies who won this round for the UI highlight.
 */
export const roundScores = (match: Match, _winnerId: string | null): Record<string, number> => {
  return match.wins()
}