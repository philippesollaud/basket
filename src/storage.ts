import Dexie, { type Table } from 'dexie'
import { StateSchema, createInitialState, type NotebookState } from './domain'

interface StoredState {
  key: 'main'
  revision: number
  state: NotebookState
}

class BasketDatabase extends Dexie {
  state!: Table<StoredState, string>

  constructor() {
    super('basket-u11')
    this.version(1).stores({ state: '&key' })
    this.version(2).stores({ state: '&key' })
  }
}

const database = new BasketDatabase()

export class RevisionConflictError extends Error {
  constructor() {
    super('Le carnet a été modifié dans un autre onglet. Rechargez les données avant de continuer.')
    this.name = 'RevisionConflictError'
  }
}

export async function readNotebook(): Promise<{ state: NotebookState; revision: number }> {
  return database.transaction('rw', database.state, async () => {
    const stored = await database.state.get('main')
    if (stored) return { state: StateSchema.parse(stored.state), revision: stored.revision }
    const state = createInitialState()
    await database.state.put({ key: 'main', revision: 0, state })
    return { state, revision: 0 }
  })
}

export async function writeNotebook(
  state: NotebookState,
  expectedRevision: number,
): Promise<number> {
  const validState = StateSchema.parse(state)
  return database.transaction('rw', database.state, async () => {
    const current = await database.state.get('main')
    if (!current || current.revision !== expectedRevision) throw new RevisionConflictError()
    const revision = current.revision + 1
    await database.state.put({ key: 'main', revision, state: validState })
    return revision
  })
}

export async function replaceNotebook(state: NotebookState): Promise<number> {
  const validState = StateSchema.parse(state)
  return database.transaction('rw', database.state, async () => {
    const current = await database.state.get('main')
    const revision = (current?.revision ?? 0) + 1
    await database.state.put({ key: 'main', revision, state: validState })
    return revision
  })
}

export async function requestPersistentStorage(): Promise<boolean> {
  if (!navigator.storage?.persist) {
    throw new Error('La protection du stockage persistant n’est pas disponible dans ce navigateur.')
  }
  return navigator.storage.persist()
}
