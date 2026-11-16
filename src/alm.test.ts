import { describe, expect, it } from 'vitest'
import {
  addEvent, dataSchema, emptyData, exportBackup, finishPeriod, importBackup,
  matchPoints, migrateLegacyData, periodScore, playerStats, saveAlmRoster,
  setTrackFouls, startAlmMatch, undoEvent,
} from './domain'
import { legacyData, selection, withAlmMatch } from './test/fixtures'

describe('effectif permanent et sélection ALM', () => {
  it('initialise les 14 noms confirmés sans numéro de maillot', () => {
    const data = emptyData()
    expect(data.almRoster.map((player) => player.name)).toEqual([
      'Guillaume', 'Jawed', 'Alexandre', 'Alexis', 'Antonin', 'Rafael', 'Liam',
      'Paul', 'Nail', 'Medhi', 'Pierre-Louis', 'Noham', 'Adem', 'Oscar',
    ])
    expect(new Set(data.almRoster.map((player) => player.id)).size).toBe(14)
    expect(data.almRoster.every((player) => !('number' in player))).toBe(true)
    expect(data.settings.trackFouls).toBe(false)
  })

  it.each(['home', 'away'] as const)('configure ALM à %s et un adversaire sans effectif', (side) => {
    const data = withAlmMatch(side)
    const match = data.matches[0]
    expect(match.almSide).toBe(side)
    expect(match[side].name).toBe('ALM')
    expect(match[side].players).toHaveLength(10)
    expect(match[side].players.map((player) => player.number)).toEqual(selection().map((item) => item.number))
    expect(match[side === 'home' ? 'away' : 'home'].players).toEqual([])
  })

  it.each([0, 9, 11])('refuse une sélection de %i joueurs', (count) => {
    const data = emptyData()
    const players = data.almRoster.slice(0, count).map((player, index) => ({ playerId: player.id, number: String(index) }))
    expect(() => startAlmMatch(data, 'Lions', players, 'home')).toThrow('exactement 10')
  })

  it('refuse les doublons de joueurs et les joueurs absents de l’effectif', () => {
    const data = emptyData()
    const players = selection(data)
    expect(() => startAlmMatch(data, 'Lions', [players[0], ...players.slice(0, 9)], 'home')).toThrow('différents')
    expect(() => startAlmMatch(data, 'Lions', [{ playerId: 'inconnu', number: '99' }, ...players.slice(1)], 'home')).toThrow('effectif ALM')
  })

  it.each(['', '-1', '1234', 'abc'])('refuse un numéro invalide %s', (number) => {
    const data = emptyData()
    expect(() => startAlmMatch(data, 'Lions', [{ ...selection()[0], number }, ...selection().slice(1)], 'home')).toThrow()
  })

  it('refuse les numéros identiques y compris avec un zéro initial', () => {
    const data = emptyData()
    const players = selection(data)
    expect(() => startAlmMatch(data, 'Lions', [{ ...players[0], number: '04' }, { ...players[1], number: '4' }, ...players.slice(2)], 'home')).toThrow()
  })

  it('refuse le nom adverse vide et un deuxième match actif', () => {
    expect(() => startAlmMatch(emptyData(), '  ', selection(), 'home')).toThrow()
    expect(() => startAlmMatch(withAlmMatch(), 'Lions', selection(), 'home')).toThrow('déjà en cours')
  })

  it('fige les dix noms et numéros au démarrage sans modifier l’effectif permanent', () => {
    const data = withAlmMatch()
    const changed = saveAlmRoster(data, data.almRoster.map((player, index) => index === 0 ? { ...player, name: 'Nom modifié' } : player))
    expect(changed.almRoster[0].name).toBe('Nom modifié')
    expect(changed.matches[0].home.players[0].name).toBe('Guillaume')
    expect(data.almRoster[0].name).toBe('Guillaume')
    expect(data.almRoster[0]).not.toHaveProperty('number')
  })

  it('permet une autre sélection et de nouveaux numéros au match suivant', () => {
    let data = withAlmMatch()
    const first = data.matches[0]
    for (let period = 0; period < 8; period++) data = finishPeriod(data, first.id)
    const next = data.almRoster.slice(4).map((player, index) => ({ playerId: player.id, number: String(index + 20) }))
    data = startAlmMatch(data, 'Renards', next, 'away')
    expect(data.matches[0].home.players[0].number).toBe('4')
    expect(data.matches[1].away.players[0].number).toBe('20')
    expect(data.matches[1].away.players.at(-1)?.name).toBe('Oscar')
  })

  it('refuse un effectif incomplet, les noms vides et les identifiants dupliqués', () => {
    const data = emptyData()
    expect(() => saveAlmRoster(data, data.almRoster.slice(1))).toThrow()
    expect(() => saveAlmRoster(data, [{ ...data.almRoster[0], name: '  ' }, ...data.almRoster.slice(1)])).toThrow()
    expect(() => saveAlmRoster(data, [data.almRoster[0], ...data.almRoster.slice(0, 13)])).toThrow()
  })
})

describe('score adverse et fautes facultatives', () => {
  it.each(['home', 'away'] as const)('suit seulement le score adverse quand ALM est à %s', (almSide) => {
    let data = withAlmMatch(almSide)
    const id = data.matches[0].id
    const opponent = almSide === 'home' ? 'away' : 'home'
    data = addEvent(data, id, opponent, null, 'one')
    data = addEvent(data, id, opponent, null, 'two')
    expect(periodScore(data.matches[0].periods[0])[opponent]).toBe(3)
    data = undoEvent(data, id)
    expect(periodScore(data.matches[0].periods[0])[opponent]).toBe(1)
    data = finishPeriod(data, id)
    expect(periodScore(data.matches[0].periods[1])[opponent]).toBe(0)
    expect(matchPoints(data.matches[0])[opponent]).toBe(3)
    expect(dataSchema.safeParse(data).success).toBe(true)
  })

  it('refuse les points ALM sans joueur et un identifiant de joueur adverse', () => {
    const data = withAlmMatch()
    const id = data.matches[0].id
    expect(() => addEvent(data, id, 'home', null, 'two')).toThrow('Joueur introuvable')
    expect(() => addEvent(data, id, 'home', data.almRoster[13].id, 'two')).toThrow('Joueur introuvable')
    expect(() => addEvent(data, id, 'away', data.almRoster[0].id, 'two')).toThrow('score global adverse')
  })

  it('désactive les fautes par défaut et conserve les comptes après désactivation', () => {
    let data = withAlmMatch()
    const id = data.matches[0].id
    const playerId = data.almRoster[0].id
    expect(() => addEvent(data, id, 'home', playerId, 'foul')).toThrow('désactivé')
    data = setTrackFouls(data, true)
    data = addEvent(data, id, 'home', playerId, 'foul')
    data = finishPeriod(data, id)
    data = addEvent(data, id, 'home', playerId, 'foul')
    expect(() => addEvent(data, id, 'away', null, 'foul')).toThrow('score global adverse')
    data = setTrackFouls(data, false)
    expect(playerStats(data.matches[0], 'home', playerId).fouls).toBe(2)
    expect(() => addEvent(data, id, 'home', playerId, 'foul')).toThrow('désactivé')
    expect(playerStats(undoEvent(data, id).matches[0], 'home', playerId).fouls).toBe(1)
  })
})

describe('sauvegardes et compatibilité', () => {
  it('exporte et restaure effectif, sélections, numéros, réglages et score adverse', () => {
    let data = setTrackFouls(withAlmMatch('away'), true)
    data = addEvent(data, data.matches[0].id, 'home', null, 'two')
    data = addEvent(data, data.matches[0].id, 'away', data.almRoster[0].id, 'one')
    const backup = exportBackup(data)
    expect(JSON.parse(backup).version).toBe(2)
    expect(importBackup(backup)).toEqual(data)
  })

  it('importe un carnet v1 en conservant les anciens matchs et initialisant ALM', () => {
    const legacy = legacyData()
    const backup = JSON.stringify({ app: 'basket-u11', version: 1, exportedAt: new Date().toISOString(), data: legacy })
    const restored = importBackup(backup)
    expect(restored).toEqual(migrateLegacyData(legacy))
    expect(restored.matches[0].almSide).toBeNull()
    expect(restored.matches[0].home).toEqual(legacy.matches[0].home)
    expect(restored.almRoster).toHaveLength(14)
    expect(restored.settings.trackFouls).toBe(false)
    expect(importBackup(exportBackup(restored))).toEqual(restored)
  })

  it('refuse un v2 avec une sélection incohérente, des joueurs adverses ou une action invalide', () => {
    const data = withAlmMatch()
    const match = data.matches[0]
    expect(dataSchema.safeParse({ ...data, matches: [{ ...match, home: { ...match.home, players: match.home.players.slice(1) } }] }).success).toBe(false)
    expect(dataSchema.safeParse({ ...data, matches: [{ ...match, away: { ...match.away, players: [match.home.players[0]] } }] }).success).toBe(false)
    const anonymousAlm = { id: 'x', side: 'home', kind: 'two', playerId: null }
    const opposingFoul = { id: 'x', side: 'away', kind: 'foul', playerId: null }
    for (const event of [anonymousAlm, opposingFoul]) {
      expect(dataSchema.safeParse({ ...data, matches: [{ ...match, periods: [[event]] }] }).success).toBe(false)
    }
    const backup = JSON.parse(exportBackup(data))
    delete backup.data.settings
    expect(() => importBackup(JSON.stringify(backup))).toThrow('incompatible')
  })
})
