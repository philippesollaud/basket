import { describe, expect, it } from 'vitest'
import {
  addEvent, dataSchema, emptyData, exportBackup, finishPeriod, importBackup,
  matchPoints, periodPoints, periodScore, playerStats, saveTeam, startMatch, undoEvent,
} from './domain'
import { away, home, withMatch, withTeams } from './test/fixtures'

describe('règles U11', () => {
  it.each([
    [5, 2, 3, 1], [1, 4, 1, 3], [0, 0, 2, 2], [4, 4, 2, 2],
  ])('attribue les points de période %i–%i → %i–%i', (h, a, hp, ap) => {
    expect(periodPoints({ home: h, away: a })).toEqual({ home: hp, away: ap })
  })

  it('attribue les paniers aux deux équipes et ignore les fautes dans le score', () => {
    let data = withMatch()
    const id = data.matches[0].id
    data = addEvent(data, id, 'home', 'alice', 'one')
    data = addEvent(data, id, 'home', 'charlie', 'two')
    data = addEvent(data, id, 'away', 'bob', 'two')
    data = addEvent(data, id, 'away', 'bob', 'foul')
    expect(periodScore(data.matches[0].periods[0])).toEqual({ home: 3, away: 2 })
    expect(playerStats(data.matches[0], 'home', 'alice')).toEqual({ points: 1, fouls: 0 })
    expect(playerStats(data.matches[0], 'away', 'bob')).toEqual({ points: 2, fouls: 1 })
    expect(matchPoints(data.matches[0])).toEqual({ home: 0, away: 0 })
  })

  it('remet les paniers à zéro mais conserve fautes, statistiques et points de match', () => {
    let data = withMatch()
    const id = data.matches[0].id
    data = addEvent(data, id, 'home', 'alice', 'two')
    data = addEvent(data, id, 'home', 'alice', 'foul')
    data = finishPeriod(data, id)
    data = addEvent(data, id, 'home', 'alice', 'foul')
    expect(periodScore(data.matches[0].periods[1])).toEqual({ home: 0, away: 0 })
    expect(playerStats(data.matches[0], 'home', 'alice')).toEqual({ points: 2, fouls: 2 })
    expect(matchPoints(data.matches[0])).toEqual({ home: 3, away: 1 })
  })

  it('annule points et fautes uniquement dans la période active, sans muter les données', () => {
    const original = withMatch()
    const id = original.matches[0].id
    let data = addEvent(original, id, 'home', 'alice', 'two')
    data = addEvent(data, id, 'away', 'bob', 'foul')
    data = undoEvent(data, id)
    expect(playerStats(data.matches[0], 'away', 'bob').fouls).toBe(0)
    data = undoEvent(data, id)
    expect(periodScore(data.matches[0].periods[0]).home).toBe(0)
    expect(original.matches[0].periods[0]).toHaveLength(0)
    expect(() => undoEvent(data, id)).toThrow('Aucune action')
    data = finishPeriod(addEvent(data, id, 'home', 'alice', 'one'), id)
    expect(() => undoEvent(data, id)).toThrow('Aucune action')
    expect(periodScore(data.matches[0].periods[0]).home).toBe(1)
  })

  it('termine exactement après huit périodes et autorise un nul final', () => {
    let data = withMatch()
    const id = data.matches[0].id
    for (let index = 0; index < 7; index++) data = finishPeriod(data, id)
    expect(data.matches[0].status).toBe('active')
    expect(data.matches[0].periods).toHaveLength(8)
    data = finishPeriod(data, id)
    expect(data.matches[0].status).toBe('finished')
    expect(data.matches[0].finishedAt).not.toBeNull()
    expect(matchPoints(data.matches[0])).toEqual({ home: 16, away: 16 })
    expect(() => finishPeriod(data, id)).toThrow('plus actif')
    expect(() => undoEvent(data, id)).toThrow('plus actif')
    expect(() => addEvent(data, id, 'away', 'bob', 'two')).toThrow('plus actif')
    expect(startMatch(data, home.id, away.id).matches).toHaveLength(2)
  })

  it('calcule le résultat avec les points de match, pas le total des paniers', () => {
    let data = withMatch()
    const id = data.matches[0].id
    for (let period = 0; period < 8; period++) {
      if (period === 0) {
        for (let basket = 0; basket < 20; basket++) data = addEvent(data, id, 'home', 'alice', 'two')
      } else {
        data = addEvent(data, id, 'away', 'bob', 'one')
      }
      data = finishPeriod(data, id)
    }
    expect(matchPoints(data.matches[0])).toEqual({ home: 10, away: 22 })
    expect(playerStats(data.matches[0], 'home', 'alice').points).toBe(40)
  })

  it('compte les fautes sans exclusion automatique', () => {
    let data = withMatch()
    const id = data.matches[0].id
    for (let count = 0; count < 7; count++) data = addEvent(data, id, 'home', 'alice', 'foul')
    data = addEvent(data, id, 'home', 'alice', 'two')
    expect(playerStats(data.matches[0], 'home', 'alice')).toEqual({ fouls: 7, points: 2 })
  })

  it('refuse les équipes invalides, un second match et les joueurs inconnus', () => {
    expect(() => startMatch(emptyData(), home.id, away.id)).toThrow()
    expect(() => startMatch(withTeams(), home.id, home.id)).toThrow()
    expect(() => startMatch(withMatch(), home.id, away.id)).toThrow('déjà')
    const data = withMatch()
    expect(() => addEvent(data, data.matches[0].id, 'home', 'bob', 'one')).toThrow('Joueur introuvable')
    expect(() => saveTeam(data, { ...home, players: [] })).toThrow()
    expect(() => saveTeam(data, { ...home, players: [home.players[0], { ...home.players[1], number: '7' }] })).toThrow()
  })

  it('fige les effectifs du match lors des modifications ultérieures des équipes', () => {
    const data = withMatch()
    const edited = saveTeam(data, { ...home, name: 'Nouveau nom', players: [{ ...home.players[0], name: 'Autre nom' }] })
    expect(edited.matches[0].home).toEqual(home)
    expect(edited.teams[0].name).toBe('Nouveau nom')
  })
})

describe('sauvegardes JSON', () => {
  it('restaure fidèlement un match actif et son historique d’actions', () => {
    let data = withMatch()
    data = addEvent(data, data.matches[0].id, 'home', 'alice', 'foul')
    expect(importBackup(exportBackup(data))).toEqual(data)
  })

  it('préserve aussi un match terminé et ses résultats', () => {
    let data = withMatch()
    const id = data.matches[0].id
    for (let index = 0; index < 8; index++) data = finishPeriod(data, id)
    expect(importBackup(exportBackup(data))).toEqual(data)
  })

  it.each(['{', '{}', 'null', '{"app":"autre","version":1}'])('refuse un fichier invalide %s', (text) => {
    expect(() => importBackup(text)).toThrow()
  })

  it('rejette versions inconnues, champs inattendus et données incohérentes', () => {
    const backup = JSON.parse(exportBackup(withMatch()))
    expect(() => importBackup(JSON.stringify({ ...backup, version: 99 }))).toThrow()
    expect(() => importBackup(JSON.stringify({ ...backup, unexpected: true }))).toThrow()
    backup.data.matches[0].periods[0].push({ id: 'x', side: 'home', playerId: 'absent', kind: 'two' })
    expect(() => importBackup(JSON.stringify(backup))).toThrow('incohérente')
  })

  it('rejette identifiants dupliqués, plusieurs matchs actifs et fins prématurées', () => {
    const data = withMatch()
    expect(dataSchema.safeParse({ ...data, teams: [home, home] }).success).toBe(false)
    expect(dataSchema.safeParse({ ...data, matches: [data.matches[0], { ...data.matches[0], id: 'second' }] }).success).toBe(false)
    expect(dataSchema.safeParse({ ...data, matches: [{ ...data.matches[0], status: 'finished' }] }).success).toBe(false)
  })

  it('rejette les doublons d’actions, les scores inconnus et les dates incohérentes', () => {
    const data = withMatch()
    const match = data.matches[0]
    const event = { id: 'x', side: 'home', playerId: 'alice', kind: 'one' }
    expect(dataSchema.safeParse({ ...data, matches: [{ ...match, periods: [[event, event]] }] }).success).toBe(false)
    expect(dataSchema.safeParse({ ...data, matches: [{ ...match, periods: [[{ ...event, kind: 'three' }]] }] }).success).toBe(false)
    expect(dataSchema.safeParse({ ...data, matches: [{ ...match, finishedAt: new Date().toISOString() }] }).success).toBe(false)
  })

  it('refuse les fichiers dépassant 10 Mo', () => {
    expect(() => importBackup(' '.repeat(10 * 1024 * 1024 + 1))).toThrow('10 Mo')
  })
})
