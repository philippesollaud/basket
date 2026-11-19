import { z } from 'zod'

export const PLAYER_COUNT = 14
export const MATCH_PLAYER_COUNT = 10
export const PERIOD_COUNT = 8
export const BACKUP_VERSION = 2
export const MAX_IMPORT_BYTES = 10 * 1024 * 1024

const PlayerSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1),
}).strict()

const RosterPlayerSchema = PlayerSchema.extend({
  number: z.string().regex(/^\d{1,3}$/),
}).strict()

const ScoreActionSchema = z.object({
  id: z.string().min(1),
  team: z.enum(['alm', 'opponent']),
  kind: z.literal('score'),
  points: z.union([z.literal(1), z.literal(2)]),
  playerId: z.string().min(1).nullable(),
}).strict()

const FoulActionSchema = z.object({
  id: z.string().min(1),
  team: z.literal('alm'),
  kind: z.literal('foul'),
  points: z.literal(0),
  playerId: z.string().min(1),
}).strict()

const ActionBaseSchema = z.discriminatedUnion('kind', [
  ScoreActionSchema,
  FoulActionSchema,
])

export const ActionSchema = ActionBaseSchema.superRefine((action, context) => {
  if (action.kind !== 'score') return
  if (action.team === 'opponent' && action.playerId !== null) {
    context.addIssue({ code: 'custom', message: 'Une action adverse ne peut pas avoir de joueur.' })
  }
  if (action.team === 'alm' && action.playerId === null) {
    context.addIssue({ code: 'custom', message: 'Une action ALM doit avoir un joueur.' })
  }
})

export type MatchAction = z.infer<typeof ActionSchema>

const PeriodSchema = z.object({
  number: z.number().int().min(1).max(PERIOD_COUNT),
  actions: z.array(ActionSchema),
  closed: z.boolean(),
  awardedAlm: z.number().int().min(1).max(3).nullable(),
  awardedOpponent: z.number().int().min(1).max(3).nullable(),
}).strict().superRefine((period, context) => {
  if (period.closed !== (period.awardedAlm !== null && period.awardedOpponent !== null)) {
    context.addIssue({ code: 'custom', message: 'La clôture de la période et ses points doivent être cohérents.' })
  }
})

export const MatchSchema = z.object({
  id: z.string().min(1),
  opponent: z.string().trim().min(1),
  location: z.enum(['home', 'away']),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
  trackFouls: z.boolean(),
  players: z.array(RosterPlayerSchema).length(MATCH_PLAYER_COUNT),
  periods: z.array(PeriodSchema).length(PERIOD_COUNT),
}).strict().superRefine((match, context) => {
  const playerIds = new Set(match.players.map((player) => player.id))
  const numbers = match.players.map((player) => Number(player.number))
  if (playerIds.size !== match.players.length) {
    context.addIssue({ code: 'custom', message: 'Un joueur ne peut apparaître qu’une fois dans la feuille de match.' })
  }
  if (new Set(numbers).size !== numbers.length) {
    context.addIssue({ code: 'custom', message: 'Les numéros du match doivent être uniques.' })
  }
  const actionIds = new Set<string>()
  let foundOpenPeriod = false
  match.periods.forEach((period, index) => {
    if (period.number !== index + 1) {
      context.addIssue({ code: 'custom', message: 'Les périodes doivent être ordonnées de 1 à 8.' })
    }
    if (foundOpenPeriod && period.closed) {
      context.addIssue({ code: 'custom', message: 'Une période ne peut pas être clôturée après une période ouverte.' })
    }
    if (!period.closed) foundOpenPeriod = true
    const score = period.actions.reduce(
      (total, action) => {
        if (action.kind === 'score') total[action.team] += action.points
        return total
      },
      { alm: 0, opponent: 0 },
    )
    if (period.closed) {
      const expectedAlm = score.alm > score.opponent ? 3 : score.alm < score.opponent ? 1 : 2
      const expectedOpponent = score.opponent > score.alm ? 3 : score.opponent < score.alm ? 1 : 2
      if (period.awardedAlm !== expectedAlm || period.awardedOpponent !== expectedOpponent) {
        context.addIssue({ code: 'custom', message: 'Les points de match ne correspondent pas au score de la période.' })
      }
    }
    period.actions.forEach((action) => {
      if (actionIds.has(action.id)) {
        context.addIssue({ code: 'custom', message: 'Chaque action doit avoir un identifiant unique dans le match.' })
      }
      actionIds.add(action.id)
      if (action.playerId !== null && !playerIds.has(action.playerId)) {
        context.addIssue({ code: 'custom', message: 'Une action référence un joueur absent du match.' })
      }
    })
  })
  if (match.completedAt !== null && match.periods.some((period) => !period.closed)) {
    context.addIssue({ code: 'custom', message: 'Un match terminé doit avoir huit périodes clôturées.' })
  }
  if (match.completedAt === null && match.periods.every((period) => period.closed)) {
    context.addIssue({ code: 'custom', message: 'Un match actif doit avoir une période ouverte.' })
  }
})

export const StateSchema = z.object({
  players: z.array(PlayerSchema).length(PLAYER_COUNT),
  trackFouls: z.boolean(),
  activeMatch: MatchSchema.nullable(),
  matches: z.array(MatchSchema),
  legacyTeams: z.array(z.unknown()),
}).strict().superRefine((state, context) => {
  const playerIds = state.players.map((player) => player.id)
  if (new Set(playerIds).size !== playerIds.length) {
    context.addIssue({ code: 'custom', message: 'Les identifiants de l’effectif doivent être uniques.' })
  }
  if (state.matches.some((match) => match.completedAt === null)) {
    context.addIssue({ code: 'custom', message: 'L’historique ne peut contenir que des matchs terminés.' })
  }
  const matchIds = [
    ...state.matches.map((match) => match.id),
    ...(state.activeMatch ? [state.activeMatch.id] : []),
  ]
  if (new Set(matchIds).size !== matchIds.length) {
    context.addIssue({ code: 'custom', message: 'Chaque match doit avoir un identifiant unique.' })
  }
})

export const BackupSchema = z.object({
  version: z.literal(BACKUP_VERSION),
  exportedAt: z.string().datetime(),
  state: StateSchema,
}).strict()

export type Player = z.infer<typeof PlayerSchema>
export type MatchPlayer = z.infer<typeof RosterPlayerSchema>
export type Period = z.infer<typeof PeriodSchema>
export type Match = z.infer<typeof MatchSchema>
export type NotebookState = z.infer<typeof StateSchema>

export function createInitialState(): NotebookState {
  return {
    players: Array.from({ length: PLAYER_COUNT }, (_, index) => ({
      id: `alm-${index + 1}`,
      name: `Joueur ${index + 1}`,
    })),
    trackFouls: false,
    activeMatch: null,
    matches: [],
    legacyTeams: [],
  }
}

export function validateMatchSetup(
  opponent: string,
  selected: Array<{ id: string; number: string }>,
  roster: Player[],
): string[] {
  const errors: string[] = []
  if (!opponent.trim()) errors.push('Le nom de l’équipe adverse est obligatoire.')
  if (selected.length !== MATCH_PLAYER_COUNT) {
    errors.push(`Sélectionnez exactement ${MATCH_PLAYER_COUNT} joueurs.`)
  }
  if (new Set(selected.map((player) => player.id)).size !== selected.length) {
    errors.push('Un joueur ne peut être sélectionné qu’une fois.')
  }
  const rosterIds = new Set(roster.map((player) => player.id))
  if (selected.some((player) => !rosterIds.has(player.id))) {
    errors.push('La sélection contient un joueur absent de l’effectif.')
  }
  const numbers = selected.map((player) => player.number.trim())
  if (numbers.some((number) => !/^\d{1,3}$/.test(number))) {
    errors.push('Chaque numéro doit comporter de 1 à 3 chiffres.')
  }
  if (new Set(numbers.map(Number)).size !== numbers.length) {
    errors.push('Les numéros de maillot doivent être uniques.')
  }
  return errors
}

export function startMatch(
  state: NotebookState,
  opponent: string,
  location: Match['location'],
  selected: Array<{ id: string; number: string }>,
  now = new Date(),
): NotebookState {
  if (state.activeMatch) throw new Error('Un match est déjà en cours.')
  const errors = validateMatchSetup(opponent, selected, state.players)
  if (errors.length) throw new Error(errors.join(' '))
  const players = selected.map((selection) => {
    const player = state.players.find((candidate) => candidate.id === selection.id)
    if (!player) throw new Error('Un joueur sélectionné est introuvable.')
    return { ...player, number: selection.number.trim() }
  })
  const periods: Period[] = Array.from({ length: PERIOD_COUNT }, (_, index) => ({
    number: index + 1,
    actions: [],
    closed: false,
    awardedAlm: null,
    awardedOpponent: null,
  }))
  const activeMatch: Match = {
    id: crypto.randomUUID(),
    opponent: opponent.trim(),
    location,
    startedAt: now.toISOString(),
    completedAt: null,
    trackFouls: state.trackFouls,
    players,
    periods,
  }
  return { ...state, activeMatch }
}

export function periodScore(period: Period): { alm: number; opponent: number } {
  return period.actions.reduce(
    (score, action) => {
      if (action.kind === 'score') score[action.team] += action.points
      return score
    },
    { alm: 0, opponent: 0 },
  )
}

export function recordAction(
  state: NotebookState,
  action: Omit<MatchAction, 'id'>,
): NotebookState {
  const match = state.activeMatch
  if (!match) throw new Error('Aucun match n’est en cours.')
  const period = match.periods.find((candidate) => !candidate.closed)
  if (!period) throw new Error('Toutes les périodes sont déjà clôturées.')
  const parsed = ActionSchema.parse({ ...action, id: crypto.randomUUID() })
  if (parsed.playerId !== null && !match.players.some((player) => player.id === parsed.playerId)) {
    throw new Error('Le joueur choisi ne fait pas partie de ce match.')
  }
  if (parsed.kind === 'foul' && !match.trackFouls) {
    throw new Error('Le suivi des fautes est désactivé pour ce match.')
  }
  const periods = match.periods.map((candidate) =>
    candidate.number === period.number
      ? { ...candidate, actions: [...candidate.actions, parsed] }
      : candidate,
  )
  return { ...state, activeMatch: { ...match, periods } }
}

export function undoLastAction(state: NotebookState): NotebookState {
  const match = state.activeMatch
  if (!match) throw new Error('Aucun match n’est en cours.')
  const period = match.periods.find((candidate) => !candidate.closed)
  if (!period || period.actions.length === 0) return state
  const periods = match.periods.map((candidate) =>
    candidate.number === period.number
      ? { ...candidate, actions: candidate.actions.slice(0, -1) }
      : candidate,
  )
  return { ...state, activeMatch: { ...match, periods } }
}

export function closeCurrentPeriod(state: NotebookState, now = new Date()): NotebookState {
  const match = state.activeMatch
  if (!match) throw new Error('Aucun match n’est en cours.')
  const period = match.periods.find((candidate) => !candidate.closed)
  if (!period) throw new Error('Toutes les périodes sont déjà clôturées.')
  const score = periodScore(period)
  const awardedAlm = score.alm > score.opponent ? 3 : score.alm < score.opponent ? 1 : 2
  const awardedOpponent = score.opponent > score.alm ? 3 : score.opponent < score.alm ? 1 : 2
  const periods = match.periods.map((candidate) =>
    candidate.number === period.number
      ? { ...candidate, closed: true, awardedAlm, awardedOpponent }
      : candidate,
  )
  const updatedMatch = { ...match, periods }
  if (periods.every((candidate) => candidate.closed)) {
    const completedMatch = { ...updatedMatch, completedAt: now.toISOString() }
    return {
      ...state,
      activeMatch: null,
      matches: [completedMatch, ...state.matches],
    }
  }
  return { ...state, activeMatch: updatedMatch }
}

export function matchPoints(match: Match): { alm: number; opponent: number } {
  return match.periods.reduce(
    (total, period) => ({
      alm: total.alm + (period.awardedAlm ?? 0),
      opponent: total.opponent + (period.awardedOpponent ?? 0),
    }),
    { alm: 0, opponent: 0 },
  )
}

export function playerStats(match: Match): Array<{ player: MatchPlayer; points: number; fouls: number }> {
  return match.players.map((player) => {
    const actions = match.periods.flatMap((period) => period.actions)
    return {
      player,
      points: actions.reduce(
        (total, action) => total + (action.kind === 'score' && action.playerId === player.id ? action.points : 0),
        0,
      ),
      fouls: actions.reduce(
        (total, action) => total + (action.kind === 'foul' && action.playerId === player.id ? 1 : 0),
        0,
      ),
    }
  })
}

export function parseBackup(text: string): NotebookState {
  if (new TextEncoder().encode(text).byteLength > MAX_IMPORT_BYTES) {
    throw new Error('Le fichier dépasse la limite de 10 Mo.')
  }
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new Error('Le fichier ne contient pas un JSON valide.')
  }
  const parsed = BackupSchema.safeParse(value)
  if (!parsed.success) {
    throw new Error(`Sauvegarde invalide : ${parsed.error.issues[0]?.message ?? 'format non reconnu'}`)
  }
  return parsed.data.state
}

export function createBackup(state: NotebookState, now = new Date()): string {
  return JSON.stringify({
    version: BACKUP_VERSION,
    exportedAt: now.toISOString(),
    state: StateSchema.parse(state),
  }, null, 2)
}
