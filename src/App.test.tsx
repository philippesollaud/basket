import 'fake-indexeddb/auto';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { clearStateForTests, loadState } from './storage';
import * as storage from './storage';
import * as fileBackup from './file-backup';
import { createInitialNotebook, type Notebook } from './domain';

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({ needRefresh: [false, vi.fn()], updateServiceWorker: vi.fn() }),
}));

describe('coach workflow', () => {
  beforeEach(async () => { await clearStateForTests(); });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('validates preparation and persists actions only after player selection', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('Jour de match');
    await user.click(screen.getByRole('button', { name: /démarrer le match/i }));
    expect(screen.getByRole('alert')).toHaveTextContent('équipe adverse');
    await user.type(screen.getByLabelText('ÉQUIPE ADVERSE'), 'Lions');
    for (let i = 1; i <= 10; i++) {
      await user.click(screen.getByRole('checkbox', { name: `Joueur ${i}` }));
      expect(screen.getByLabelText(`Numéro de Joueur ${i}`)).toHaveValue(String(i + 3));
    }
    const lastNumber = screen.getByLabelText('Numéro de Joueur 10');
    await user.clear(lastNumber);
    await user.type(lastNumber, '4');
    expect(screen.getByRole('alert')).toHaveTextContent('numéros doivent être uniques');
    await user.clear(lastNumber);
    await user.type(lastNumber, '13');
    await user.click(screen.getByRole('button', { name: /à l’extérieur/i }));
    await user.click(screen.getByRole('button', { name: /démarrer le match/i }));
    await screen.findByText('Sur le terrain');
    expect(screen.getByRole('group', { name: 'Score de la période' })).toHaveTextContent(/Lions\s*0\s*:\s*ALM\s*0/);
    const teamActions = screen.getAllByRole('group', { name: /^Actions/ });
    expect(teamActions[0]).toHaveAccessibleName('Actions Lions');
    expect(teamActions[1]).toHaveAccessibleName('Actions ALM');
    await user.click(within(teamActions[1]).getByRole('button', { name: /\+2 points/i }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).queryByRole('button', { name: 'Annuler' })).not.toBeInTheDocument();
    expect((await loadState()).data.matches[0].periods[0].actions).toHaveLength(0);
    await user.click(within(dialog).getByRole('button', { name: /Joueur 1$/ }));
    await waitFor(async () => expect((await loadState()).data.matches[0].periods[0].actions).toHaveLength(1));
    expect(screen.getByText('Joueur 1 · +2 points')).toBeInTheDocument();
    await user.click(within(screen.getByRole('group', { name: 'Actions Lions' })).getByRole('button', { name: /\+1 point/i }));
    await waitFor(async () => expect((await loadState()).data.matches[0].periods[0].actions).toHaveLength(2));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    await user.click(screen.getByRole('button', { name: /clôturer la période/i }));
    expect((await loadState()).data.matches[0].periods[0].closed).toBe(false);
  });

  describe('automatic file backup', () => {
    const handle = { name: 'carnet.json' } as FileSystemFileHandle;
    let file: Notebook;
    let linked: FileSystemFileHandle | undefined;
    let permission: 'granted' | 'prompt';
    let empty: boolean;

    beforeEach(async () => {
      await clearStateForTests();
      file = createInitialNotebook();
      linked = undefined;
      permission = 'granted';
      empty = false;
      vi.spyOn(fileBackup, 'fileBackupSupported').mockReturnValue(true);
      vi.spyOn(fileBackup, 'chooseNewBackup').mockResolvedValue(handle);
      vi.spyOn(fileBackup, 'chooseExistingBackup').mockResolvedValue(handle);
      vi.spyOn(fileBackup, 'backupPermission').mockImplementation(async () => permission);
      vi.spyOn(fileBackup, 'readBackup').mockImplementation(async () => ({
        data: structuredClone(file), snapshot: fileBackup.backupSnapshot(file),
      }));
      vi.spyOn(fileBackup, 'readBackupOrEmpty').mockImplementation(async () => empty ? null : ({
        data: structuredClone(file), snapshot: fileBackup.backupSnapshot(file),
      }));
      vi.spyOn(fileBackup, 'writeBackup').mockImplementation(async (_handle, data) => {
        file = structuredClone(data);
        empty = false;
        return fileBackup.backupSnapshot(file);
      });
      vi.spyOn(storage, 'loadBackupHandle').mockImplementation(async () => linked);
      vi.spyOn(storage, 'saveBackupHandle').mockImplementation(async (value) => { linked = value; });
      vi.spyOn(window, 'confirm').mockReturnValue(true);
    });
    afterEach(() => { cleanup(); vi.restoreAllMocks(); });

    it('reports a picker failure without linking or writing a file', async () => {
      vi.mocked(fileBackup.chooseExistingBackup).mockRejectedValueOnce(
        new DOMException('Stale location', 'InvalidStateError'),
      );
      const user = userEvent.setup();
      render(<App />);
      await screen.findByText('Jour de match');
      const before = await loadState();
      await user.click(screen.getByRole('button', { name: 'Sauvegardes' }));
      await user.click(screen.getByRole('button', { name: 'Choisir un fichier existant' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('sélecteur Documents');
      expect(fileBackup.writeBackup).not.toHaveBeenCalled();
      expect(linked).toBeUndefined();
      expect(await loadState()).toEqual(before);
    });

    it('can reopen and initialize an empty file after a stale-handle creation failure', async () => {
      empty = true;
      vi.mocked(fileBackup.writeBackup).mockRejectedValueOnce(new fileBackup.BackupFileError(
        'Ouverture du fichier en écriture', new DOMException('Stale state', 'InvalidStateError'),
      ));
      const user = userEvent.setup();
      render(<App />);
      await screen.findByText('Jour de match');
      await user.click(screen.getByRole('button', { name: 'Sauvegardes' }));
      await user.click(screen.getByRole('button', { name: 'Créer un fichier de sauvegarde' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('Ouverture du fichier en écriture');
      expect(screen.getByRole('alert')).toHaveTextContent('Choisir un fichier existant');
      expect(linked).toBeUndefined();
      await user.click(screen.getByRole('button', { name: 'Choisir un fichier existant' }));
      await screen.findByText('Active : carnet.json');
      expect(linked).toBe(handle);
      expect(empty).toBe(false);
      expect(file).toEqual((await loadState()).data);
    });

    it('does not initialize an empty file without confirmation or accept an invalid file', async () => {
      empty = true;
      vi.mocked(window.confirm).mockReturnValue(false);
      const user = userEvent.setup();
      render(<App />);
      await screen.findByText('Jour de match');
      await user.click(screen.getByRole('button', { name: 'Sauvegardes' }));
      await user.click(screen.getByRole('button', { name: 'Choisir un fichier existant' }));
      expect(fileBackup.writeBackup).not.toHaveBeenCalled();
      expect(linked).toBeUndefined();
      vi.mocked(fileBackup.readBackupOrEmpty).mockRejectedValueOnce(new Error('Fichier invalide'));
      await user.click(screen.getByRole('button', { name: 'Choisir un fichier existant' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('Fichier invalide');
      expect(fileBackup.writeBackup).not.toHaveBeenCalled();
      expect(linked).toBeUndefined();
    });

    it('updates the chosen file after saving and reconnects on reload', async () => {
      const user = userEvent.setup();
      const view = render(<App />);
      await screen.findByText('Jour de match');
      await user.click(screen.getByRole('button', { name: 'Sauvegardes' }));
      await user.click(screen.getByRole('button', { name: 'Créer un fichier de sauvegarde' }));
      await screen.findByText('Active : carnet.json');
      await user.click(screen.getByRole('button', { name: 'Effectif' }));
      const name = screen.getByLabelText('Prénom du joueur 1');
      await user.clear(name);
      await user.type(name, 'Camille');
      await user.click(screen.getByRole('button', { name: /enregistrer l’effectif/i }));
      await waitFor(() => expect(file.roster[0].name).toBe('Camille'));
      view.unmount();
      render(<App />);
      await screen.findByText('Jour de match');
      await user.click(screen.getByRole('button', { name: 'Sauvegardes' }));
      expect(await screen.findByText('Active : carnet.json')).toBeInTheDocument();
    });

    it('offers to restore an existing file without overwriting local data', async () => {
      file.roster[0].name = 'Camille';
      const user = userEvent.setup();
      render(<App />);
      await screen.findByText('Jour de match');
      await user.click(screen.getByRole('button', { name: 'Sauvegardes' }));
      await user.click(screen.getByRole('button', { name: 'Choisir un fichier existant' }));
      await screen.findByText(/sont différents/);
      expect((await loadState()).data.roster[0].name).toBe('Joueur 1');
      expect(file.roster[0].name).toBe('Camille');
      await user.click(screen.getByRole('button', { name: 'Restaurer le fichier' }));
      await screen.findByText('Active : carnet.json');
      expect((await loadState()).data.roster[0].name).toBe('Camille');
    });

    it('pauses on missing permission and reconciles changes after access is restored', async () => {
      linked = handle;
      permission = 'prompt';
      const user = userEvent.setup();
      render(<App />);
      await screen.findByText(/sauvegarde automatique est en pause/);
      await user.click(screen.getByRole('button', { name: 'Effectif' }));
      const name = screen.getByLabelText('Prénom du joueur 1');
      await user.clear(name);
      await user.type(name, 'Camille');
      await user.click(screen.getByRole('button', { name: /enregistrer l’effectif/i }));
      await waitFor(async () => expect((await loadState()).data.roster[0].name).toBe('Camille'));
      expect(file.roster[0].name).toBe('Joueur 1');
      permission = 'granted';
      await user.click(screen.getByRole('button', { name: 'Sauvegardes' }));
      await user.click(screen.getByRole('button', { name: 'Vérifier l’accès au fichier' }));
      await screen.findByText(/sont différents/);
      await user.click(screen.getByRole('button', { name: 'Conserver le carnet de cet appareil' }));
      await screen.findByText('Active : carnet.json');
      expect(file.roster[0].name).toBe('Camille');
    });

    it('pauses instead of overwriting an externally modified file', async () => {
      linked = handle;
      const user = userEvent.setup();
      render(<App />);
      await screen.findByText('Jour de match');
      file.roster[0].name = 'Alex';
      await user.click(screen.getByRole('button', { name: 'Effectif' }));
      const name = screen.getByLabelText('Prénom du joueur 1');
      await user.clear(name);
      await user.type(name, 'Camille');
      await user.click(screen.getByRole('button', { name: /enregistrer l’effectif/i }));
      await screen.findByText(/sauvegarde automatique est en pause/);
      expect(file.roster[0].name).toBe('Alex');
      expect((await loadState()).data.roster[0].name).toBe('Camille');
    });

    it('keeps the local change and reports a failed file write', async () => {
      linked = handle;
      vi.spyOn(fileBackup, 'writeBackup').mockRejectedValue(new Error('Disque plein'));
      const user = userEvent.setup();
      render(<App />);
      await screen.findByText('Jour de match');
      await user.click(screen.getByRole('button', { name: 'Effectif' }));
      await user.click(screen.getByLabelText('Suivi des fautes'));
      await screen.findByText(/sauvegarde automatique est en pause/);
      expect((await loadState()).data.trackFouls).toBe(true);
      expect(file.trackFouls).toBe(false);
      await user.click(screen.getByRole('button', { name: 'Sauvegardes' }));
      expect(screen.getByText(/Disque plein/)).toBeInTheDocument();
    });

    it('asks again if the file changes before a conflict is resolved', async () => {
      file.roster[0].name = 'Alex';
      linked = handle;
      const user = userEvent.setup();
      render(<App />);
      await screen.findByText(/sauvegarde automatique est en pause/);
      await user.click(screen.getByRole('button', { name: 'Sauvegardes' }));
      file.roster[0].name = 'Camille';
      await user.click(screen.getByRole('button', { name: 'Restaurer le fichier' }));
      await screen.findByText(/Le fichier a changé depuis sa lecture/);
      expect((await loadState()).data.roster[0].name).toBe('Joueur 1');
      await user.click(screen.getByRole('button', { name: 'Restaurer le fichier' }));
      await screen.findByText('Active : carnet.json');
      expect((await loadState()).data.roster[0].name).toBe('Camille');
    });
  });

  it('requires six players and can start with six selected players', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('Jour de match');
    await user.type(screen.getByLabelText('ÉQUIPE ADVERSE'), 'Lions');
    for (let i = 1; i <= 5; i++) {
      await user.click(screen.getByRole('checkbox', { name: `Joueur ${i}` }));
    }

    await user.click(screen.getByRole('button', { name: /démarrer le match/i }));
    expect(screen.getByRole('alert')).toHaveTextContent('entre 6 et 10 joueurs');

    await user.click(screen.getByRole('checkbox', { name: 'Joueur 6' }));
    await user.click(screen.getByRole('button', { name: /démarrer le match/i }));
    await screen.findByText('Sur le terrain');
    expect((await loadState()).data.matches[0].players).toHaveLength(6);
  });

  it('shows period markers for unplayed, drawn, lost, and won periods', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<App />);
    await screen.findByText('Jour de match');
    await user.type(screen.getByLabelText('ÉQUIPE ADVERSE'), 'Lions');
    for (let i = 1; i <= 6; i++) {
      await user.click(screen.getByRole('checkbox', { name: `Joueur ${i}` }));
    }
    await user.click(screen.getByRole('button', { name: /démarrer le match/i }));
    await screen.findByText('Sur le terrain');

    expect(screen.queryByText('PÉRIODES')).not.toBeInTheDocument();
    expect(screen.queryByText('EN COURS')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Légende des périodes')).not.toBeInTheDocument();
    let progress = screen.getByRole('group', { name: 'Résultat des périodes' });
    expect(within(progress).getByRole('img', { name: 'Période 1 à jouer' })).toHaveAttribute('aria-current', 'step');
    expect(within(progress).getByRole('img', { name: 'Période 8 à jouer' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /clôturer la période/i }));
    await screen.findByRole('img', { name: 'Période 1 nulle' });
    await user.click(within(screen.getByRole('group', { name: 'Actions Lions' })).getByRole('button', { name: /\+1 point/i }));
    await screen.findByText('Lions · +1 point');
    await user.click(screen.getByRole('button', { name: /clôturer la période/i }));
    await screen.findByRole('img', { name: 'Période 2 perdue' });
    await user.click(within(screen.getByRole('group', { name: 'Actions ALM' })).getByRole('button', { name: /\+1 point/i }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Joueur 1$/ }));
    await screen.findByText('Joueur 1 · +1 point');
    await user.click(screen.getByRole('button', { name: /clôturer la période/i }));

    await screen.findByRole('img', { name: 'Période 3 gagnée' });
    progress = screen.getByRole('group', { name: 'Résultat des périodes' });
    expect(within(progress).getByRole('img', { name: 'Période 4 à jouer' })).toHaveAttribute('aria-current', 'step');
  });

  it('edits the roster and enables foul tracking', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('Jour de match');
    await user.click(screen.getByRole('button', { name: /effectif/i }));
    const name = screen.getByLabelText('Prénom du joueur 1');
    await user.clear(name);
    await user.type(name, 'Camille');
    await user.click(screen.getByRole('button', { name: /enregistrer l’effectif/i }));
    await waitFor(async () => expect((await loadState()).data.roster[0].name).toBe('Camille'));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    await user.click(screen.getByLabelText('Suivi des fautes'));
    await waitFor(async () => expect((await loadState()).data.trackFouls).toBe(true));
    expect((await loadState()).data.roster[0].name).toBe('Camille');
  });

  it('reuses saved preferences on the match sheet and requires unique match numbers', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('Jour de match');
    await user.click(screen.getByRole('button', { name: /effectif/i }));
    const name = screen.getByLabelText('Prénom du joueur 1');
    const preferred = screen.getByLabelText('Numéro préféré du joueur 1');
    await user.clear(name);
    await user.type(name, 'Camille');
    await user.type(preferred, '07');
    await user.type(screen.getByLabelText('Numéro préféré du joueur 2'), '7');
    await user.click(screen.getByRole('button', { name: /enregistrer l’effectif/i }));
    await waitFor(async () => expect((await loadState()).data.roster[0]).toMatchObject({ name: 'Camille', preferredNumber: '07' }));

    await user.click(screen.getByRole('button', { name: 'Terrain' }));
    await user.type(screen.getByLabelText('ÉQUIPE ADVERSE'), 'Lions');
    await user.click(screen.getByRole('checkbox', { name: 'Camille' }));
    for (let i = 2; i <= 6; i++) {
      await user.click(screen.getByRole('checkbox', { name: `Joueur ${i}` }));
    }
    const number = screen.getByLabelText('Numéro de Camille');
    expect(number).toHaveValue('07');
    expect(screen.getByRole('alert')).toHaveTextContent('numéros doivent être uniques');
    const start = screen.getByRole('button', { name: /démarrer le match/i });
    await user.click(start);
    expect((await loadState()).data.matches).toHaveLength(0);

    await user.clear(number);
    await user.type(number, '23');
    await user.click(start);
    await screen.findByText('Sur le terrain');
    const { data } = await loadState();
    expect(data.matches[0].players[0]).toEqual({ id: data.roster[0].id, name: 'Camille', number: '23' });
    expect(data.roster[0].preferredNumber).toBe('07');
  });
});
