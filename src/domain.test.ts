import { describe, expect, it } from 'vitest'
import {
  closeCurrentPeriod,
  createInitialState,
  matchPoints,
  parseBackup,
  periodScore,
  playerStats,
  recordAction,
  StateSchema,
  startMatch,
  undoLastAction,
  validateMatchSetup,
} from './domain'

function startedState() {
  const state = createInitialState()
  return startMatch(
    state,
    'Les Panthères',
    'home',
    state.players.slice(0, 10).map((player, index) => ({ id: player.id, number: String(index + 1) })),
    new Date('2026-01-01T10:00:00.000Z'),
  )
}

describe('match setup', () => {
  it('rejects duplicate jersey numbers after numeric normalization', () => {
    const state = createInitialState()
    const selected = state.players.slice(0, 10).map((player, index) => ({
      id: player.id,
      number: index === 1 ? '04' : String(index + 1),
    }))
    expect(validateMatchSetup('Adversaire', selected, state.players)).toContain('Les numéros de maillot doivent être uniques.')
  })

  it('requires exactly ten selected players and a non-empty opponent', () => {
    const state = createInitialState()
    expect(validateMatchSetup('  ', [], state.players)).toEqual([
      'Le nom de l’équipe adverse est obligatoire.',
      'Sélectionnez exactement 10 joueurs.',
    ])
  })
})

describe('match scoring', () => {
  it('adds period match points from basket score and resets the next period score', () => {
    let state = startedState()
    const playerId = state.activeMatch!.players[0]!.id
    state = recordAction(state, { team: 'alm', kind: 'score', points: 2, playerId })
    state = recordAction(state, { team: 'opponent', kind: 'score', points: 1, playerId: null })
    expect(periodScore(state.activeMatch!.periods[0]!)).toEqual({ alm: 2, opponent: 1 })

    state = closeCurrentPeriod(state, new Date('2026-01-01T10:10:00.000Z'))
    expect(matchPoints(state.activeMatch!)).toEqual({ alm: 3, opponent: 1 })
    expect(periodScore(state.activeMatch!.periods[1]!)).toEqual({ alm: 0, opponent: 0 })
  })

  it('allows a tie and only undoes the last action in the open period', () => {
    let state = startedState()
    const playerId = state.activeMatch!.players[0]!.id
    state = recordAction(state, { team: 'alm', kind: 'score', points: 1, playerId })
    state = recordAction(state, { team: 'opponent', kind: 'score', points: 1, playerId: null })
    state = undoLastAction(state)
    expect(periodScore(state.activeMatch!.periods[0]!)).toEqual({ alm: 1, opponent: 0 })
    state = closeCurrentPeriod(state)
    expect(state.activeMatch!.periods[0]!.awardedAlm).toBe(3)
  })

  it('retains recorded fouls when tracking is turned off', () => {
    let state = startedState()
    state = {
      ...state,
      trackFouls: true,
      activeMatch: { ...state.activeMatch!, trackFouls: true },
    }
    state = recordAction(state, {
      team: 'alm',
      kind: 'foul',
      points: 0,
      playerId: state.activeMatch!.players[0]!.id,
    })
    const match = { ...state.activeMatch!, trackFouls: false }
    state = { ...state, trackFouls: false, activeMatch: match }

    expect(StateSchema.parse(state).activeMatch?.periods[0]?.actions).toHaveLength(1)
    expect(playerStats(match)[0]?.fouls).toBe(1)
  })

  it('completes the game after eight closed periods and accepts a tied match-point result', () => {
    let state = startedState()
    for (let period = 0; period < 8; period += 1) state = closeCurrentPeriod(state)
    expect(state.activeMatch).toBeNull()
    expect(state.matches).toHaveLength(1)
    expect(matchPoints(state.matches[0]!)).toEqual({ alm: 16, opponent: 16 })
  })

  it('rejects invalid and oversized backups without returning partial state', () => {
    expect(() => parseBackup('{"version":2}')).toThrow('Sauvegarde invalide')
    expect(() => parseBackup('x'.repeat(10 * 1024 * 1024 + 1))).toThrow('limite de 10 Mo')
  })
})
