import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BasketDatabase } from './storage'
import Dexie from 'dexie'
import { addEvent, emptyData, exportBackup, importBackup, saveTeam, setTrackFouls } from './domain'
import { home, legacyData, withAlmMatch, withMatch } from './test/fixtures'

let db: BasketDatabase
beforeEach(() => { db = new BasketDatabase(`test-${crypto.randomUUID()}`) })
afterEach(async () => { await db.delete() })

describe('stockage transactionnel IndexedDB', () => {
  it('initialise un carnet vide', async () => {
    expect(await db.read()).toEqual({ id: 'main', revision: 0, data: emptyData() })
  })

  it('conserve les données après fermeture et réouverture', async () => {
    await db.commit(0, () => withMatch())
    const current = await db.read()
    await db.commit(current.revision, (data) => addEvent(data, data.matches[0].id, 'home', 'alice', 'two'))
    db.close()
    await db.open()
    const reopened = await db.read()
    expect(reopened.revision).toBe(2)
    expect(reopened.data.matches[0].periods[0][0].kind).toBe('two')
  })

  it('ne perd pas de données lors de deux écritures concurrentes', async () => {
    await db.read()
    const results = await Promise.allSettled([
      db.commit(0, (data) => saveTeam(data, home)),
      db.commit(0, () => emptyData()),
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
    expect((await db.read()).revision).toBe(1)
  })

  it('refuse les écrans obsolètes et conserve la dernière écriture', async () => {
    await db.commit(0, (data) => saveTeam(data, home))
    await expect(db.commit(0, () => emptyData())).rejects.toThrow('autre fenêtre')
    expect((await db.read()).data.teams).toEqual([home])
  })

  it('préserve le carnet si la transformation échoue', async () => {
    await db.commit(0, () => withMatch())
    const previous = await db.read()
    await expect(db.commit(1, () => { throw new Error('test de panne') })).rejects.toThrow('test de panne')
    expect(await db.read()).toEqual(previous)
  })

  it('remplace les données par un import validé dans une seule transaction', async () => {
    const backup = exportBackup(withMatch())
    await db.commit(0, () => importBackup(backup))
    expect((await db.read()).data).toEqual(importBackup(backup))
    await expect(db.commit(1, () => importBackup('{}'))).rejects.toThrow()
    expect((await db.read()).revision).toBe(1)
  })

  it('signale explicitement des données manquantes au lieu de créer un carnet vide', async () => {
    await db.read()
    await db.state.clear()
    await expect(db.read()).rejects.toThrow('introuvables')
  })

  it('migre le stockage v1 sans effacer les anciens matchs et effectifs', async () => {
    const legacy = new Dexie(db.name)
    legacy.version(1).stores({ state: 'id' })
    const oldData = legacyData()
    await legacy.table('state').put({ id: 'main', revision: 5, data: oldData })
    legacy.close()
    const current = await db.read()
    expect(current.revision).toBe(6)
    expect(current.data.matches[0].home).toEqual(oldData.matches[0].home)
    expect(current.data.teams).toEqual(oldData.teams)
    expect(current.data.almRoster).toHaveLength(14)
    expect(current.data.settings.trackFouls).toBe(false)
    await db.commit(6, (data) => setTrackFouls(data, true))
    expect((await db.read()).revision).toBe(7)
  })

  it('persiste sélection, numéros, réglages et points adverses après réouverture', async () => {
    await db.commit(0, () => withAlmMatch('away'))
    await db.commit(1, (data) => setTrackFouls(addEvent(data, data.matches[0].id, 'home', null, 'two'), true))
    const previous = await db.read()
    db.close()
    await db.open()
    expect(await db.read()).toEqual(previous)
    expect((await db.read()).data.matches[0].away.players).toHaveLength(10)
  })
})
