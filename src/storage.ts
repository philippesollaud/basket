import Dexie, { type Table } from 'dexie';
import {
  createInitialNotebook,
  parseBackup,
  validateNotebook,
  type Notebook,
} from './domain';

type StateRow = {
  key: 'main';
  data: Notebook;
  revision: number;
};

type BackupRow = {
  key: 'file';
  handle: FileSystemFileHandle;
};

class BasketDatabase extends Dexie {
  state!: Table<StateRow, 'main'>;
  backup!: Table<BackupRow, 'file'>;

  constructor() {
    super('basket-u11');
    this.version(1).stores({ state: '&key' });
    this.version(2)
      .stores({ state: '&key' })
      .upgrade(async (transaction) => {
        const table = transaction.table('state');
        const row = await table.get('main') as Record<string, unknown> | undefined;
        if (!row) return;

        const source = row.data ?? row.notebook ?? row.value;
        let data: Notebook;
        try {
          data = parseBackup(source);
        } catch {
          data = parseBackup({ version: 1, notebook: source });
        }
        const revision = typeof row.revision === 'number' && Number.isInteger(row.revision)
          ? Math.max(0, row.revision)
          : 0;
        await table.put({ key: 'main', data, revision });
      });
    this.version(3).stores({ state: '&key', backup: '&key' });
  }
}

export const database = new BasketDatabase();

export class RevisionConflictError extends Error {
  constructor() {
    super('Notebook changed since it was loaded; reload before saving.');
    this.name = 'RevisionConflictError';
  }
}

export async function loadState(): Promise<{ data: Notebook; revision: number }> {
  return database.transaction('rw', database.state, async () => {
    const row = await database.state.get('main');
    if (!row) {
      const data = createInitialNotebook();
      await database.state.add({ key: 'main', data, revision: 0 });
      return { data, revision: 0 };
    }
    if (!Number.isInteger(row.revision) || row.revision < 0 || !validateNotebook(row.data)) {
      throw new Error('Stored notebook is invalid');
    }
    return { data: row.data, revision: row.revision };
  });
}

export async function saveState(
  data: Notebook,
  expectedRevision: number,
): Promise<{ data: Notebook; revision: number }> {
  if (!validateNotebook(data)) throw new Error('Notebook is invalid');
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
    throw new Error('Expected revision must be a non-negative integer');
  }
  const copy = structuredClone(data);

  return database.transaction('rw', database.state, async () => {
    const row = await database.state.get('main');
    const actualRevision = row?.revision ?? 0;
    if (actualRevision !== expectedRevision) throw new RevisionConflictError();

    const revision = actualRevision + 1;
    await database.state.put({ key: 'main', data: copy, revision });
    return { data: structuredClone(copy), revision };
  });
}

export async function loadBackupHandle(): Promise<FileSystemFileHandle | undefined> {
  return (await database.backup.get('file'))?.handle;
}

export async function saveBackupHandle(handle: FileSystemFileHandle): Promise<void> {
  await database.backup.put({ key: 'file', handle });
}

export async function clearStateForTests(): Promise<void> {
  await database.transaction('rw', database.state, database.backup, async () => {
    await database.state.delete('main');
    await database.backup.delete('file');
  });
}
