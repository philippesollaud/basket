import Dexie, { type EntityTable } from 'dexie'
import { dataSchema, emptyData, migrateLegacyData, type AppData } from './domain'

export interface StoredData {
  id: 'main'
  revision: number
  data: AppData
}

export class BasketDatabase extends Dexie {
  state!: EntityTable<StoredData, 'id'>

  constructor(databaseName = 'basket-u11') {
    super(databaseName)
    this.version(1).stores({ state: 'id' })
    this.version(2).stores({ state: 'id' }).upgrade(async (transaction) => {
      const state = transaction.table<StoredData>('state')
      const current = await state.get('main')
      if (!current) throw new Error('Migration impossible : carnet local introuvable.')
      await state.put({ ...current, revision: current.revision + 1, data: migrateLegacyData(current.data) })
    })
    this.on('populate', (transaction) => {
      transaction.table('state').add({ id: 'main', revision: 0, data: emptyData() })
    })
  }

  async read(): Promise<StoredData> {
    const stored = await this.state.get('main')
    if (!stored) throw new Error('Les données locales sont introuvables. Rechargez l’application ou restaurez une sauvegarde.')
    return { ...stored, data: dataSchema.parse(stored.data) }
  }

  async commit(revision: number, change: (data: AppData) => AppData): Promise<void> {
    await this.transaction('rw', this.state, async () => {
      const current = await this.read()
      if (current.revision !== revision) {
        throw new Error('Les données ont changé dans une autre fenêtre. Réessayez après leur actualisation.')
      }
      const data = dataSchema.parse(change(current.data))
      await this.state.put({ id: 'main', revision: current.revision + 1, data })
    })
  }
}

export const database = new BasketDatabase()

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Une erreur inattendue est survenue.'
}
