import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInitialNotebook, makeBackup } from './domain';
import { backupSnapshot, chooseExistingBackup, chooseNewBackup, readBackup, readBackupOrEmpty, writeBackup } from './file-backup';

function handleForFile(contents: string, size = contents.length): FileSystemFileHandle {
  return {
    getFile: async () => ({ size, text: async () => contents }),
  } as FileSystemFileHandle;
}

describe('backup files', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('isolates opening and saving from a stale default picker location', async () => {
    const handle = handleForFile('');
    const locations = new Map<string, boolean>([['', false]]);
    async function pick(options: { id?: string; startIn?: string }) {
      const id = options.id ?? '';
      if (locations.get(id) === false) throw new DOMException('Stale location', 'InvalidStateError');
      if (!locations.has(id) && options.startIn !== 'documents') throw new Error('No initial location');
      locations.set(id, true);
      return handle;
    }
    vi.stubGlobal('window', {
      showSaveFilePicker: pick,
      showOpenFilePicker: async (options: { id?: string; startIn?: string }) => [await pick(options)],
    });
    expect(await chooseNewBackup()).toBe(handle);
    expect(await chooseExistingBackup()).toBe(handle);
    expect(locations.size).toBe(3);
    expect(locations.get('')).toBe(false);
  });

  it('validates a backup before using it', async () => {
    const data = createInitialNotebook();
    const result = await readBackup(handleForFile(JSON.stringify(makeBackup(data))));
    expect(result.snapshot).toBe(backupSnapshot(data));
    await expect(readBackup(handleForFile('{"version":2,"notebook":{}}'))).rejects.toThrow();
    await expect(readBackup(handleForFile('', 10 * 1024 * 1024 + 1))).rejects.toThrow(/10 Mo/);
    expect(await readBackupOrEmpty(handleForFile(''))).toBeNull();
    await expect(readBackup(handleForFile(''))).rejects.toThrow(/vide/);
    await expect(readBackupOrEmpty(handleForFile(' '))).rejects.toThrow();
  });

  it('reports the failed writing stage without retrying a stale handle', async () => {
    const handle = handleForFile('');
    const createWritable = vi.fn<FileSystemFileHandle['createWritable']>()
      .mockRejectedValue(new DOMException('Stale state', 'InvalidStateError'));
    handle.createWritable = createWritable;
    await expect(writeBackup(handle, createInitialNotebook())).rejects.toThrow(
      /Ouverture du fichier en écriture.*InvalidStateError.*Choisir un fichier existant/,
    );
    expect(createWritable).toHaveBeenCalledOnce();
  });

  it('only reports success after reading back the saved content', async () => {
    let content = '';
    const handle: FileSystemFileHandle = {
      kind: 'file',
      name: 'carnet.json',
      isSameEntry: async () => false,
      getFile: () => handleForFile(content).getFile(),
      createWritable: vi.fn().mockResolvedValue({
        write: async (data: string) => { content = data; },
        close: vi.fn(),
        abort: vi.fn(),
      }),
    };
    const notebook = createInitialNotebook();
    expect(await writeBackup(handle, notebook)).toBe(backupSnapshot(notebook));
    handle.getFile = () => handleForFile(JSON.stringify(makeBackup({ ...notebook, trackFouls: true }))).getFile();
    await expect(writeBackup(handle, notebook)).rejects.toThrow(/Vérification.*ne correspond pas/);
  });

  it('aborts a failed write and preserves the original error', async () => {
    const abort = vi.fn().mockResolvedValue(undefined);
    const handle: FileSystemFileHandle = {
      kind: 'file',
      name: 'carnet.json',
      isSameEntry: async () => false,
      getFile: async () => new File([], 'carnet.json'),
      createWritable: vi.fn().mockResolvedValue({
        write: async () => { throw new Error('Disque plein'); },
        close: vi.fn(),
        abort,
      }),
    };
    await expect(writeBackup(handle, createInitialNotebook())).rejects.toThrow('Disque plein');
    expect(abort).toHaveBeenCalledOnce();
  });
});
