import { makeBackup, parseBackup, type Notebook } from './domain';

type Permission = 'granted' | 'denied' | 'prompt';
type BackupHandle = FileSystemFileHandle & {
  queryPermission(options: { mode: 'readwrite' }): Promise<Permission>;
  requestPermission(options: { mode: 'readwrite' }): Promise<Permission>;
};
type PickerWindow = Window & {
  showOpenFilePicker?: (options: PickerOptions) => Promise<BackupHandle[]>;
  showSaveFilePicker?: (options: PickerOptions & { suggestedName: string }) => Promise<BackupHandle>;
};
type FilePickerType = { description: string; accept: Record<string, string[]> };
type PickerOptions = { id: string; startIn: 'documents'; types: FilePickerType[] };

const types = [{ description: 'Sauvegarde du carnet', accept: { 'application/json': ['.json'] } }];
const maxFileSize = 10 * 1024 * 1024;
const permissionOptions = { mode: 'readwrite' } as const;

export class BackupFileError extends Error {
  constructor(operation: string, cause: unknown) {
    const detail = cause instanceof Error ? `${cause.name} : ${cause.message}` : String(cause);
    const guidance = cause instanceof DOMException && cause.name === 'InvalidStateError'
      ? ' Réouvrez le fichier avec « Choisir un fichier existant ». Si l’erreur persiste, utilisez l’export manuel.'
      : '';
    super(`${operation} : ${detail}.${guidance}`, { cause });
    this.name = 'BackupFileError';
  }
}

export function fileBackupSupported(): boolean {
  const picker = window as PickerWindow;
  return typeof picker.showOpenFilePicker === 'function' && typeof picker.showSaveFilePicker === 'function';
}

export async function chooseNewBackup(): Promise<FileSystemFileHandle> {
  const picker = (window as PickerWindow).showSaveFilePicker;
  if (!picker) throw new Error('La sauvegarde automatique n’est pas disponible dans ce navigateur.');
  return picker.call(window, {
    id: 'le-banc-backup-save-v2', startIn: 'documents',
    suggestedName: 'le-banc-sauvegarde.json', types,
  });
}

export async function chooseExistingBackup(): Promise<FileSystemFileHandle> {
  const picker = (window as PickerWindow).showOpenFilePicker;
  if (!picker) throw new Error('La sauvegarde automatique n’est pas disponible dans ce navigateur.');
  const [handle] = await picker.call(window, {
    id: 'le-banc-backup-open-v2', startIn: 'documents', types,
  });
  if (!handle) throw new Error('Aucun fichier sélectionné.');
  return handle;
}

export function backupPermission(handle: FileSystemFileHandle, request = false): Promise<Permission> {
  const file = handle as BackupHandle;
  return request ? file.requestPermission(permissionOptions) : file.queryPermission(permissionOptions);
}

export function backupSnapshot(notebook: Notebook): string {
  return JSON.stringify(makeBackup(notebook));
}

export async function readBackup(handle: FileSystemFileHandle): Promise<{ data: Notebook; snapshot: string }> {
  const backup = await readBackupOrEmpty(handle);
  if (!backup) throw new Error('Le fichier de sauvegarde est vide.');
  return backup;
}

export async function readBackupOrEmpty(handle: FileSystemFileHandle): Promise<{ data: Notebook; snapshot: string } | null> {
  try {
    const file = await handle.getFile();
    if (file.size > maxFileSize) throw new Error('Le fichier de sauvegarde dépasse 10 Mo.');
    const text = await file.text();
    if (text.length === 0) return null;
    const data = parseBackup(JSON.parse(text) as unknown);
    return { data, snapshot: backupSnapshot(data) };
  } catch (cause) {
    throw new BackupFileError('Lecture du fichier', cause);
  }
}

export async function writeBackup(handle: FileSystemFileHandle, notebook: Notebook): Promise<string> {
  const snapshot = backupSnapshot(notebook);
  let operation = 'Ouverture du fichier en écriture';
  let writable: FileSystemWritableFileStream | undefined;
  let closed = false;
  try {
    writable = await handle.createWritable();
    operation = 'Écriture du fichier';
    await writable.write(snapshot);
    operation = 'Finalisation du fichier';
    await writable.close();
    closed = true;
    operation = 'Vérification du fichier enregistré';
    if ((await readBackup(handle)).snapshot !== snapshot) {
      throw new Error('Le contenu relu ne correspond pas au carnet enregistré.');
    }
  } catch (cause) {
    if (writable && !closed) {
      try {
        await writable.abort();
      } catch (abortError) {
        console.error('Impossible de fermer le flux après une erreur de sauvegarde.', abortError);
      }
    }
    throw new BackupFileError(operation, cause);
  }
  return snapshot;
}
