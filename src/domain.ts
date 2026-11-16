import { z } from 'zod'

const id = z.string().min(1).max(100)
const name = z.string().trim().min(1, 'Un nom est requis.').max(80)
const rosterPlayerSchema = z.strictObject({ id, name })
const playerSchema = z.strictObject({
  id,
  name,
  number: z.string().regex(/^\d{1,3}$/, 'Le numéro doit contenir 1 à 3 chiffres.'),
})

function uniquePlayers(players: { id: string; number: string }[], context: z.RefinementCtx, numericNumbers = false) {
  for (const key of ['id', 'number'] as const) {
    const values = players.map((player) => key === 'number' && numericNumbers ? String(Number(player.number)) : player[key])
    if (new Set(values).size !== values.length) {
      context.addIssue({ code: 'custom', message: 'Chaque joueur doit avoir un identifiant et un numéro uniques.' })
    }
  }
}

const snapshotSchema = z.strictObject({
  id,
  name,
  players: z.array(playerSchema).max(50),
})
export const teamSchema = snapshotSchema.extend({
  players: z.array(playerSchema).min(1, 'Ajoutez au moins un joueur.').max(50),
}).superRefine((team, context) => uniquePlayers(team.players, context))

export const almRosterSchema = z.array(rosterPlayerSchema).length(14, 'L’effectif ALM doit contenir 14 joueurs.')
  .superRefine((players, context) => {
    if (new Set(players.map((player) => player.id)).size !== players.length) {
      context.addIssue({ code: 'custom', message: 'Chaque joueur doit avoir un identifiant unique.' })
    }
  })

const eventSchema = z.strictObject({
  id,
  side: z.enum(['home', 'away']),
  playerId: id.nullable(),
  kind: z.enum(['one', 'two', 'foul']),
})

const matchBaseSchema = z.strictObject({
  id,
  home: snapshotSchema,
  away: snapshotSchema,
  almSide: z.enum(['home', 'away']).nullable(),
  createdAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().nullable(),
  status: z.enum(['active', 'finished']),
  periods: z.array(z.array(eventSchema)).min(1).max(8),
})

function validateMatch(match: z.infer<typeof matchBaseSchema>, context: z.RefinementCtx) {
  const issue = (message: string) => context.addIssue({ code: 'custom', message })
  for (const side of ['home', 'away'] as const) {
    uniquePlayers(match[side].players, context, match.almSide !== null)
    if (match.almSide === null && !match[side].players.length) issue('Un ancien match doit conserver ses joueurs.')
  }
  if (match.almSide !== null) {
    const opponent = match.almSide === 'home' ? 'away' : 'home'
    if (match[match.almSide].name !== 'ALM' || match[match.almSide].players.length !== 10) {
      issue('ALM doit avoir exactement 10 joueurs sélectionnés.')
    }
    if (match[opponent].players.length) issue('L’équipe adverse ne doit pas contenir de joueurs.')
  }
  if (match.home.id === match.away.id) issue('Sélectionnez deux équipes différentes.')
  if (match.status === 'finished' && (match.periods.length !== 8 || !match.finishedAt)) {
    issue('Un match terminé doit contenir huit périodes et une date de fin.')
  }
  if (match.status === 'active' && match.finishedAt !== null) issue('Un match actif ne peut pas avoir de date de fin.')
  if (match.finishedAt && match.finishedAt < match.createdAt) issue('La date de fin précède le match.')
  const seen = new Set<string>()
  for (const event of match.periods.flat()) {
    if (seen.has(event.id)) issue('Une action est présente plusieurs fois.')
    seen.add(event.id)
    const anonymous = match.almSide !== null && event.side !== match.almSide
    if (anonymous ? event.playerId !== null || event.kind === 'foul'
      : !match[event.side].players.some((player) => player.id === event.playerId)) {
      issue('Une action référence un joueur inconnu.')
    }
  }
}

const matchSchema = matchBaseSchema.superRefine(validateMatch)
const legacyMatchSchema = matchBaseSchema.omit({ almSide: true }).extend({
  home: teamSchema,
  away: teamSchema,
  periods: z.array(z.array(eventSchema.extend({ playerId: id }))).min(1).max(8),
}).superRefine((match, context) => validateMatch({ ...match, almSide: null }, context))

function validateCollections(data: { teams: { id: string }[]; matches: { id: string; status: string }[] }, context: z.RefinementCtx) {
  for (const collection of [data.teams, data.matches]) {
    if (new Set(collection.map((item) => item.id)).size !== collection.length) {
      context.addIssue({ code: 'custom', message: 'Des identifiants sont dupliqués.' })
    }
  }
  if (data.matches.filter((match) => match.status === 'active').length > 1) {
    context.addIssue({ code: 'custom', message: 'Un seul match peut être actif.' })
  }
}

export const legacyDataSchema = z.strictObject({
  teams: z.array(teamSchema),
  matches: z.array(legacyMatchSchema),
}).superRefine(validateCollections)

export const dataSchema = z.strictObject({
  almRoster: almRosterSchema,
  settings: z.strictObject({ trackFouls: z.boolean() }),
  teams: z.array(teamSchema),
  matches: z.array(matchSchema),
}).superRefine(validateCollections)

const backupSchema = z.strictObject({
  app: z.literal('basket-u11'),
  version: z.literal(2),
  exportedAt: z.iso.datetime(),
  data: dataSchema,
})
const legacyBackupSchema = backupSchema.extend({ version: z.literal(1), data: legacyDataSchema })

export type Team = z.infer<typeof teamSchema>
export type Player = Team['players'][number]
export type RosterPlayer = z.infer<typeof rosterPlayerSchema>
export type Match = z.infer<typeof matchSchema>
export type MatchEvent = z.infer<typeof eventSchema>
export type Side = MatchEvent['side']
export type EventKind = MatchEvent['kind']
export type AppData = z.infer<typeof dataSchema>
export type Score = Record<Side, number>

export function emptyData(): AppData {
  return {
    almRoster: [
      'Guillaume', 'Jawed', 'Alexandre', 'Alexis', 'Antonin', 'Rafael', 'Liam',
      'Paul', 'Nail', 'Medhi', 'Pierre-Louis', 'Noham', 'Adem', 'Oscar',
    ].map((name, index) => ({ id: `alm-player-${index + 1}`, name })),
    settings: { trackFouls: false },
    teams: [],
    matches: [],
  }
}

export function migrateLegacyData(input: unknown): AppData {
  const legacy = legacyDataSchema.parse(input)
  return {
    ...emptyData(),
    ...legacy,
    matches: legacy.matches.map((match) => ({ ...match, almSide: null })),
  }
}

export function saveAlmRoster(data: AppData, roster: RosterPlayer[]): AppData {
  return { ...data, almRoster: almRosterSchema.parse(roster) }
}

export function setTrackFouls(data: AppData, enabled: boolean): AppData {
  return { ...data, settings: { ...data.settings, trackFouls: enabled } }
}

export interface MatchSelection { playerId: string; number: string }

export function startAlmMatch(data: AppData, opponentName: string, selection: MatchSelection[], almSide: Side): AppData {
  if (data.matches.some((match) => match.status === 'active')) throw new Error('Un match est déjà en cours.')
  if (selection.length !== 10 || new Set(selection.map((item) => item.playerId)).size !== 10) {
    throw new Error('Sélectionnez exactement 10 joueurs différents.')
  }
  const players = selection.map((item) => {
    const player = data.almRoster.find((player) => player.id === item.playerId)
    if (!player) throw new Error('Un joueur sélectionné ne figure pas dans l’effectif ALM.')
    return { ...player, number: item.number }
  })
  const alm = teamSchema.parse({ id: 'alm', name: 'ALM', players })
  const opponent = snapshotSchema.parse({ id: crypto.randomUUID(), name: opponentName, players: [] })
  const match: Match = {
    id: crypto.randomUUID(),
    home: almSide === 'home' ? alm : opponent,
    away: almSide === 'away' ? alm : opponent,
    almSide,
    createdAt: new Date().toISOString(),
    finishedAt: null,
    status: 'active',
    periods: [[]],
  }
  return dataSchema.parse({ ...data, matches: [...data.matches, match] })
}

export function periodScore(events: MatchEvent[]): Score {
  return events.reduce<Score>((score, event) => {
    score[event.side] += event.kind === 'one' ? 1 : event.kind === 'two' ? 2 : 0
    return score
  }, { home: 0, away: 0 })
}

export function periodPoints(score: Score): Score {
  return score.home === score.away
    ? { home: 2, away: 2 }
    : score.home > score.away ? { home: 3, away: 1 } : { home: 1, away: 3 }
}

export function completedPeriods(match: Match): MatchEvent[][] {
  return match.status === 'finished' ? match.periods : match.periods.slice(0, -1)
}

export function matchPoints(match: Match): Score {
  return completedPeriods(match).reduce<Score>((total, period) => {
    const points = periodPoints(periodScore(period))
    return { home: total.home + points.home, away: total.away + points.away }
  }, { home: 0, away: 0 })
}

export function playerStats(match: Match, side: Side, playerId: string) {
  const events = match.periods.flat().filter((event) => event.side === side && event.playerId === playerId)
  return {
    points: periodScore(events)[side],
    fouls: events.filter((event) => event.kind === 'foul').length,
  }
}

export function startMatch(data: AppData, homeId: string, awayId: string): AppData {
  if (data.matches.some((match) => match.status === 'active')) throw new Error('Un match est déjà en cours.')
  const home = data.teams.find((team) => team.id === homeId)
  const away = data.teams.find((team) => team.id === awayId)
  if (!home || !away || homeId === awayId) throw new Error('Sélectionnez deux équipes différentes.')
  const match: Match = {
    id: crypto.randomUUID(),
    home: structuredClone(home),
    away: structuredClone(away),
    almSide: null,
    createdAt: new Date().toISOString(),
    finishedAt: null,
    status: 'active',
    periods: [[]],
  }
  return { ...data, matches: [...data.matches, match] }
}

function updateActive(data: AppData, matchId: string, change: (match: Match) => Match): AppData {
  const match = data.matches.find((item) => item.id === matchId)
  if (!match || match.status !== 'active') throw new Error('Ce match n’est plus actif.')
  return { ...data, matches: data.matches.map((item) => item.id === matchId ? change(item) : item) }
}

export function addEvent(data: AppData, matchId: string, side: Side, playerId: string | null, kind: EventKind): AppData {
  return updateActive(data, matchId, (match) => {
    if (kind === 'foul' && !data.settings.trackFouls) throw new Error('Le suivi des fautes est désactivé.')
    const anonymous = match.almSide !== null && side !== match.almSide
    if (anonymous) {
      if (playerId !== null || kind === 'foul') throw new Error('Seul le score global adverse est suivi.')
    } else if (!match[side].players.some((player) => player.id === playerId)) {
      throw new Error('Joueur introuvable.')
    }
    const periods = match.periods.map((events) => [...events])
    periods[periods.length - 1].push({ id: crypto.randomUUID(), side, playerId, kind })
    return { ...match, periods }
  })
}

export function undoEvent(data: AppData, matchId: string): AppData {
  return updateActive(data, matchId, (match) => {
    if (!match.periods.at(-1)?.length) throw new Error('Aucune action à annuler dans cette période.')
    return { ...match, periods: match.periods.map((events, index) =>
      index === match.periods.length - 1 ? events.slice(0, -1) : events) }
  })
}

export function finishPeriod(data: AppData, matchId: string): AppData {
  return updateActive(data, matchId, (match) => match.periods.length === 8
    ? { ...match, status: 'finished', finishedAt: new Date().toISOString() }
    : { ...match, periods: [...match.periods, []] })
}

export function saveTeam(data: AppData, input: Team): AppData {
  const team = teamSchema.parse(input)
  return {
    ...data,
    teams: data.teams.some((item) => item.id === team.id)
      ? data.teams.map((item) => item.id === team.id ? team : item)
      : [...data.teams, team],
  }
}

export function exportBackup(data: AppData): string {
  return JSON.stringify(backupSchema.parse({
    app: 'basket-u11', version: 2, exportedAt: new Date().toISOString(), data,
  }), null, 2)
}

export function importBackup(text: string): AppData {
  if (new Blob([text]).size > 10 * 1024 * 1024) throw new Error('La sauvegarde dépasse la limite de 10 Mo.')
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new Error('Le fichier ne contient pas un JSON valide.')
  }
  const parsed = z.discriminatedUnion('version', [legacyBackupSchema, backupSchema]).safeParse(value)
  if (!parsed.success) throw new Error('Sauvegarde incompatible ou incohérente. Aucune donnée n’a été modifiée.')
  return parsed.data.version === 1 ? migrateLegacyData(parsed.data.data) : parsed.data.data
}
