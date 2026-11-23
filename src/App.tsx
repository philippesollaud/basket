import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import {
  activeMatch, addAction, closePeriod, finishMatch, isJerseyNumber, makeBackup, matchPoints, parseBackup,
  periodPoints, periodScore, playerStats, startMatch, undoAction,
  type Action, type Match, type Notebook, type Player,
} from './domain';
import { loadBackupHandle, loadState, RevisionConflictError, saveBackupHandle, saveState } from './storage';
import {
  backupPermission, backupSnapshot, chooseExistingBackup, chooseNewBackup, fileBackupSupported,
  readBackup, readBackupOrEmpty, writeBackup,
} from './file-backup';
import styles from './App.module.css';

type Screen = 'terrain' | 'effectif' | 'historique' | 'sauvegardes';
type Loaded = { data: Notebook; revision: number };
type PendingAction = { kind: 'points' | 'foul'; value: 1 | 2 };
type PeriodOutcome = 'won' | 'draw' | 'lost' | 'unplayed';
type BackupStatus =
  | { kind: 'none' }
  | { kind: 'permission'; handle: FileSystemFileHandle }
  | { kind: 'ready'; handle: FileSystemFileHandle; snapshot: string }
  | { kind: 'conflict'; handle: FileSystemFileHandle; snapshot: string; data: Notebook }
  | { kind: 'error'; handle: FileSystemFileHandle; detail: string };
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const periodOutcomeLabels: Record<PeriodOutcome, string> = {
  won: 'gagnée',
  draw: 'nulle',
  lost: 'perdue',
  unplayed: 'à jouer',
};
const periodOutcomeStyles: Record<PeriodOutcome, string> = {
  won: styles.periodWon,
  draw: styles.periodDraw,
  lost: styles.periodLost,
  unplayed: styles.periodUnplayed,
};
const tabs: { id: Screen; label: string; icon: string }[] = [
  { id: 'terrain', label: 'Terrain', icon: '◉' },
  { id: 'effectif', label: 'Effectif', icon: '♟' },
  { id: 'historique', label: 'Historique', icon: '▤' },
  { id: 'sauvegardes', label: 'Sauvegardes', icon: '⇩' },
];

function message(error: unknown): string {
  return error instanceof RevisionConflictError
    ? 'Le carnet a été modifié dans un autre onglet. Rechargez avant de continuer.'
    : error instanceof Error ? error.message : 'Une erreur est survenue.';
}

export default function App() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [screen, setScreen] = useState<Screen>('terrain');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const writing = useRef(false);
  const [backup, setBackup] = useState<BackupStatus>({ kind: 'none' });
  const backupRef = useRef<BackupStatus>({ kind: 'none' });
  const { needRefresh: [needRefresh], updateServiceWorker } = useRegisterSW();

  function updateBackup(status: BackupStatus) {
    backupRef.current = status;
    setBackup(status);
  }

  async function inspectBackup(handle: FileSystemFileHandle, data: Notebook): Promise<BackupStatus> {
    if (await backupPermission(handle) !== 'granted') return { kind: 'permission', handle };
    const file = await readBackup(handle);
    return file.snapshot === backupSnapshot(data)
      ? { kind: 'ready', handle, snapshot: file.snapshot }
      : { kind: 'conflict', handle, ...file };
  }

  useEffect(() => {
    let mounted = true;
    loadState().then(async (state) => {
      let status: BackupStatus = { kind: 'none' };
      try {
        const handle = await loadBackupHandle();
        if (handle) {
          try {
            status = await inspectBackup(handle, state.data);
          } catch (cause) {
            status = { kind: 'error', handle, detail: message(cause) };
          }
        }
      } catch (cause) {
        if (mounted) setError(`Impossible de retrouver le fichier de sauvegarde : ${message(cause)}`);
      }
      if (mounted) {
        updateBackup(status);
        setLoaded(state);
      }
    })
      .catch((cause: unknown) => { if (mounted) setError(`Impossible de lire le carnet : ${message(cause)}`); });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (loaded && needRefresh && !activeMatch(loaded.data)) void updateServiceWorker(true);
  }, [loaded, needRefresh, updateServiceWorker]);

  async function commit(change: (current: Notebook) => Notebook): Promise<boolean> {
    if (!loaded || writing.current) return false;
    writing.current = true;
    setBusy(true);
    setError('');
    try {
      const saved = await saveState(change(loaded.data), loaded.revision);
      setLoaded(saved);
      const currentBackup = backupRef.current;
      if (currentBackup.kind === 'ready') {
        try {
          const file = await readBackup(currentBackup.handle);
          if (file.snapshot !== currentBackup.snapshot) {
            updateBackup({ kind: 'conflict', handle: currentBackup.handle, ...file });
          } else {
            const snapshot = await writeBackup(currentBackup.handle, saved.data);
            updateBackup({ kind: 'ready', handle: currentBackup.handle, snapshot });
          }
        } catch (cause) {
          updateBackup({ kind: 'error', handle: currentBackup.handle, detail: message(cause) });
        }
      }
      return true;
    } catch (cause) {
      setError(message(cause));
      return false;
    } finally {
      writing.current = false;
      setBusy(false);
    }
  }

  async function connectBackup(create: boolean) {
    if (!loaded || writing.current) return;
    if (create && !window.confirm('Le fichier choisi sera remplacé par le carnet de cet appareil. Continuer ?')) return;
    writing.current = true;
    setBusy(true);
    setError('');
    let operation = 'Sélection du fichier';
    try {
      const handle = create ? await chooseNewBackup() : await chooseExistingBackup();
      operation = 'Initialisation du fichier';
      if (create) {
        const snapshot = await writeBackup(handle, loaded.data);
        operation = 'Mémorisation du lien vers le fichier';
        await saveBackupHandle(handle);
        updateBackup({ kind: 'ready', handle, snapshot });
      } else {
        operation = 'Autorisation du fichier';
        if (await backupPermission(handle, true) !== 'granted') {
          setError('L’accès au fichier a été refusé. La sauvegarde automatique n’est pas activée.');
          return;
        }
        operation = 'Lecture du fichier existant';
        const file = await readBackupOrEmpty(handle);
        let status: BackupStatus;
        if (!file) {
          if (!window.confirm(`Le fichier ${handle.name} est vide. Y enregistrer le carnet de cet appareil et activer la sauvegarde automatique ?`)) return;
          if (await readBackupOrEmpty(handle) !== null) {
            throw new Error('Le fichier a changé depuis sa lecture. Sélectionnez-le à nouveau.');
          }
          operation = 'Initialisation du fichier vide';
          const snapshot = await writeBackup(handle, loaded.data);
          status = { kind: 'ready', handle, snapshot };
        } else {
          status = file.snapshot === backupSnapshot(loaded.data)
            ? { kind: 'ready', handle, snapshot: file.snapshot }
            : { kind: 'conflict', handle, ...file };
        }
        operation = 'Mémorisation du lien vers le fichier';
        await saveBackupHandle(handle);
        updateBackup(status);
      }
    } catch (cause) {
      if (!(operation === 'Sélection du fichier' && cause instanceof DOMException && cause.name === 'AbortError')) {
        const detail = operation === 'Sélection du fichier' && cause instanceof DOMException && cause.name === 'InvalidStateError'
          ? 'Le sélecteur Documents du navigateur a échoué avant de donner accès au fichier. Le carnet local n’a pas été modifié. Utilisez l’export manuel si cette erreur persiste.'
          : message(cause);
        setError(`Impossible de configurer la sauvegarde automatique (${operation}) : ${detail}`);
      }
    } finally {
      writing.current = false;
      setBusy(false);
    }
  }

  async function reconnectBackup() {
    const current = backupRef.current;
    if (!loaded || current.kind === 'none' || writing.current) return;
    writing.current = true;
    setBusy(true);
    try {
      if (await backupPermission(current.handle, true) !== 'granted') {
        updateBackup({ kind: 'permission', handle: current.handle });
        return;
      }
      updateBackup(await inspectBackup(current.handle, loaded.data));
    } catch (cause) {
      updateBackup({ kind: 'error', handle: current.handle, detail: message(cause) });
    } finally {
      writing.current = false;
      setBusy(false);
    }
  }

  async function resolveBackup(restore: boolean) {
    const current = backupRef.current;
    if (!loaded || current.kind !== 'conflict' || writing.current) return;
    const question = restore
      ? 'Remplacer le carnet de cet appareil par la sauvegarde ? Le match actif et les réglages seront aussi remplacés.'
      : 'Remplacer le fichier de sauvegarde par le carnet de cet appareil ?';
    if (!window.confirm(question)) return;
    writing.current = true;
    setBusy(true);
    setError('');
    try {
      const file = await readBackup(current.handle);
      if (file.snapshot !== current.snapshot) {
        updateBackup({ kind: 'conflict', handle: current.handle, ...file });
        setError('Le fichier a changé depuis sa lecture. Vérifiez à nouveau votre choix.');
        return;
      }
      if (restore) {
        const saved = await saveState(file.data, loaded.revision);
        setLoaded(saved);
        updateBackup({ kind: 'ready', handle: current.handle, snapshot: file.snapshot });
      } else {
        const snapshot = await writeBackup(current.handle, loaded.data);
        updateBackup({ kind: 'ready', handle: current.handle, snapshot });
      }
    } catch (cause) {
      setError(`Impossible de résoudre la sauvegarde : ${message(cause)}`);
    } finally {
      writing.current = false;
      setBusy(false);
    }
  }

  if (!loaded) return <main className={styles.loading}><div className={styles.brandMark}>B</div><h1>Le banc</h1><p>{error || 'Ouverture de votre carnet…'}</p>{error && <button onClick={() => location.reload()}>Réessayer</button>}</main>;
  const notebook = loaded.data;
  const match = activeMatch(notebook);
  const updateMatch = (fn: (match: Match) => Match) => commit((current) => {
    const active = activeMatch(current);
    if (!active) throw new Error('Aucun match actif.');
    return { ...current, matches: current.matches.map((item) => item.id === active.id ? fn(item) : item) };
  });

  return <div className={styles.app}>
    <header className={styles.header}>
      <div className={styles.headerInner}><div className={styles.identity}><div className={styles.brandMark}>B<span>.</span></div><div><div className={styles.brandName}>LE BANC <span>U11</span></div><div className={styles.brandSub}>Le carnet du bord de terrain</div></div></div>
        <div className={styles.localBadge}><span /> 100% LOCAL</div></div>
    </header>
    <main className={`${styles.main} ${screen === 'terrain' && match ? styles.mainLive : ''}`}>
      {error && <div className={styles.alert} role="alert">{error}{error.includes('autre onglet') && <button onClick={() => location.reload()}>Recharger</button>}</div>}
      {backup.kind !== 'none' && backup.kind !== 'ready' && <div className={styles.alert} role="alert">La sauvegarde automatique est en pause. Ouvrez Sauvegardes pour {backup.kind === 'permission' ? 'autoriser l’accès au fichier' : backup.kind === 'conflict' ? 'choisir le carnet à conserver' : 'vérifier le fichier'}.</div>}
      {screen === 'terrain' && (match
        ? <LiveMatch match={match} trackFouls={notebook.trackFouls} busy={busy} update={updateMatch} />
        : <Preparation notebook={notebook} busy={busy} commit={commit} />)}
      {screen === 'effectif' && <Roster notebook={notebook} busy={busy} commit={commit} />}
      {screen === 'historique' && <History notebook={notebook} />}
      {screen === 'sauvegardes' && <Backups notebook={notebook} busy={busy} commit={commit} setError={setError} backup={backup} connectBackup={connectBackup} reconnectBackup={reconnectBackup} resolveBackup={resolveBackup} />}
    </main>
    <nav className={styles.nav} aria-label="Navigation principale">
      <div className={styles.navInner}>{tabs.map((tab) => <button key={tab.id} className={screen === tab.id ? styles.navActive : ''} aria-current={screen === tab.id ? 'page' : undefined} onClick={() => { setScreen(tab.id); setError(''); }}><span aria-hidden="true">{tab.icon}</span>{tab.label}</button>)}</div>
    </nav>
  </div>;
}

type Commit = (change: (current: Notebook) => Notebook) => Promise<boolean>;

function Preparation({ notebook, busy, commit }: { notebook: Notebook; busy: boolean; commit: Commit }) {
  const [opponent, setOpponent] = useState('');
  const [home, setHome] = useState(true);
  const [selected, setSelected] = useState<string[]>([]);
  const [numbers, setNumbers] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const duplicateNumberIds = new Set<string>();
  const numberOwners = new Map<number, string>();
  selected.forEach((id) => {
    const number = numbers[id];
    if (!number || !/^\d{1,3}$/.test(number)) return;
    const normalized = Number(number);
    const owner = numberOwners.get(normalized);
    if (owner) {
      duplicateNumberIds.add(owner);
      duplicateNumberIds.add(id);
    } else {
      numberOwners.set(normalized, id);
    }
  });

  function togglePlayer({ id, preferredNumber }: Player, checked: boolean) {
    if (checked) {
      setSelected((previous) => previous.filter((playerId) => playerId !== id));
      setFormError('');
      return;
    }
    if (selected.length >= 10) return;
    const usedNumbers = new Set(selected.map((playerId) => Number(numbers[playerId])));
    let number = selected.length + 4;
    while (usedNumbers.has(number)) number += 1;
    setNumbers((previous) => ({ ...previous, [id]: preferredNumber ?? String(number) }));
    setSelected((previous) => [...previous, id]);
    setFormError('');
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!opponent.trim()) return setFormError('Indiquez le nom de l’équipe adverse.');
    if (selected.length < 6 || selected.length > 10) return setFormError('Sélectionnez entre 6 et 10 joueurs.');
    const chosen = notebook.roster.filter((player) => selected.includes(player.id)).map(({ id, name }) => ({ id, name, number: numbers[id] ?? '' }));
    if (chosen.some((player) => !isJerseyNumber(player.number))) return setFormError('Chaque joueur doit avoir un numéro de 1 à 999.');
    if (duplicateNumberIds.size > 0 || new Set(chosen.map((player) => Number(player.number))).size !== chosen.length) return;
    setFormError('');
    await commit((current) => startMatch(current, opponent, home, chosen));
  }
  return <section>
    <div className={styles.eyebrow}>ESPACE COACH <span> / </span> PRÉPARATION</div>
    <div className={styles.pageHeading}><div><h1>Jour de match<span className={styles.dot}>.</span></h1><p>Tout commence ici. Préparez votre feuille de match.</p></div><span className={styles.basketIcon} aria-hidden="true">◉</span></div>
    <form onSubmit={(event) => void submit(event)}>
      <div className={styles.card}>
        <div className={styles.cardTitle}><span className={styles.step}>01</span><div><h2>La rencontre</h2><p>Les informations du match</p></div></div>
        <label className={styles.fieldLabel} htmlFor="opponent">ÉQUIPE ADVERSE</label>
        <input id="opponent" value={opponent} onChange={(event) => setOpponent(event.target.value)} placeholder="Nom de l’équipe adverse" maxLength={100} />
        <div className={styles.fieldLabel}>LIEU DU MATCH</div>
        <div className={styles.segment} role="group" aria-label="Lieu du match">
          <button type="button" className={home ? styles.segmentActive : ''} aria-pressed={home} onClick={() => setHome(true)}>⌂ &nbsp; À domicile</button>
          <button type="button" className={!home ? styles.segmentActive : ''} aria-pressed={!home} onClick={() => setHome(false)}>↗ &nbsp; À l’extérieur</button>
        </div>
      </div>
      <div className={styles.card}>
        <div className={styles.cardTitle}><span className={styles.step}>02</span><div><h2>La feuille de match</h2><p>Choisissez de 6 à 10 joueurs et leurs numéros</p></div><span className={selected.length >= 6 ? styles.countReady : styles.count}>{selected.length} / 10</span></div>
        <div className={styles.rosterList}>{notebook.roster.map((player) => {
          const checked = selected.includes(player.id);
          return <div className={`${styles.selectRow} ${checked ? styles.selectedRow : ''}`} key={player.id}>
            <label className={styles.selectLabel}><input type="checkbox" checked={checked} onChange={() => togglePlayer(player, checked)} /><span aria-hidden="true" className={styles.avatar}>{player.name.charAt(0).toUpperCase()}</span><span>{player.name}</span></label>
            {checked && <label className={styles.numberLabel}><span className={styles.srOnly}>Numéro de {player.name}</span><input inputMode="numeric" pattern="[0-9]*" maxLength={3} value={numbers[player.id] ?? ''} aria-invalid={duplicateNumberIds.has(player.id)} onChange={(event) => { setNumbers({ ...numbers, [player.id]: event.target.value }); setFormError(''); }} placeholder="N°" /></label>}
          </div>;
        })}</div>
        {duplicateNumberIds.size > 0 && <p className={styles.numberError} role="alert">Les numéros doivent être uniques (04 et 4 sont identiques).</p>}
      </div>
      {formError && <p className={styles.alert} role="alert">{formError}</p>}
      <button className={styles.primary} disabled={busy} type="submit">Démarrer le match <span>→</span></button>
      <p className={styles.footnote}>Vos données restent sur cet appareil.</p>
    </form>
  </section>;
}

interface LiveMatchProps {
  match: Match;
  trackFouls: boolean;
  busy: boolean;
  update: (fn: (match: Match) => Match) => Promise<boolean>;
}

function LiveMatch({ match, trackFouls, busy, update }: LiveMatchProps) {
  const [pending, setPending] = useState<PendingAction | null>(null);
  const index = match.periods.findIndex((period) => !period.closed);
  const readyToFinish = index === -1;
  const period = match.periods[readyToFinish ? match.periods.length - 1 : index];
  const score = periodScore(period);
  const points = matchPoints(match);
  const actionTeams: ('alm' | 'opponent')[] = match.home ? ['alm', 'opponent'] : ['opponent', 'alm'];
  const periodOutcomes: PeriodOutcome[] = match.periods.map((item) => {
    if (!item.closed) return 'unplayed';
    const result = periodScore(item);
    if (result.alm === result.opponent) return 'draw';
    return result.alm > result.opponent ? 'won' : 'lost';
  });
  const record = (team: Action['team'], kind: Action['kind'], value: 1 | 2, playerId: string | null) => {
    void update((current) => addAction(current, { id: crypto.randomUUID(), team, kind, value, playerId }));
    setPending(null);
  };
  const last = period.actions.at(-1);
  const describeAction = (action: Action) => {
    const player = match.players.find((item) => item.id === action.playerId);
    return `${action.team === 'opponent' ? match.opponent : player?.name ?? 'ALM'} · ${action.kind === 'foul' ? 'Faute' : `+${action.value} point${action.value > 1 ? 's' : ''}`}`;
  };
  return <section className={styles.liveMatch}>
    <div className={styles.eyebrow}>ESPACE COACH <span> / </span> MATCH EN COURS</div>
    <div className={styles.liveHeading}><div><h1>Sur le terrain<span className={styles.dot}>.</span></h1><p>{match.home ? 'À domicile' : 'À l’extérieur'} · {match.opponent}</p></div>{!readyToFinish && <span className={styles.liveBadge}><i /> EN DIRECT</span>}</div>
    <div className={styles.matchControls} role="group" aria-label="Contrôles du match">
      <div className={styles.scoreCard}>
        <div className={styles.periodProgress} role="group" aria-label="Résultat des périodes">
          {periodOutcomes.map((outcome, periodIndex) => (
            <span
              aria-current={periodIndex === index ? 'step' : undefined}
              aria-label={`Période ${periodIndex + 1} ${periodOutcomeLabels[outcome]}`}
              className={`${styles.periodPill} ${periodOutcomeStyles[outcome]} ${periodIndex === index ? styles.periodCurrent : ''}`}
              key={periodIndex}
              role="img"
              title={`Période ${periodIndex + 1} ${periodOutcomeLabels[outcome]}`}
            >
              {periodIndex + 1}
            </span>
          ))}
        </div>
        <div className={styles.scoreBoard} role="group" aria-label="Score de la période">
          {match.home
            ? <><div><span>ALM</span><strong>{score.alm}</strong></div><div className={styles.scoreDash}>:</div><div><span>{match.opponent}</span><strong>{score.opponent}</strong></div></>
            : <><div><span>{match.opponent}</span><strong>{score.opponent}</strong></div><div className={styles.scoreDash}>:</div><div><span>ALM</span><strong>{score.alm}</strong></div></>}
        </div>
        <div className={styles.matchPoints}>POINTS DE MATCH <strong>{points.alm} <span>–</span> {points.opponent}</strong><small>Périodes terminées</small></div>
      </div>
      {!readyToFinish && <><div className={styles.actionGrid}>
        {actionTeams.map((team) => {
          const isAlm = team === 'alm';
          return <div className={`${styles.actionCard} ${isAlm ? styles.almActionCard : styles.opponentActionCard}`} role="group" aria-label={`Actions ${isAlm ? 'ALM' : match.opponent}`} key={team}>
            <div className={styles.teamLabel}><span className={isAlm ? styles.teamDot : styles.opponentDot} /> {isAlm ? 'ALM' : match.opponent}</div>
            <div className={styles.scoreButtons}>
              <button disabled={busy} onClick={() => isAlm ? setPending({ kind: 'points', value: 1 }) : record('opponent', 'points', 1, null)}>+1 <small>point</small></button>
              <button disabled={busy} onClick={() => isAlm ? setPending({ kind: 'points', value: 2 }) : record('opponent', 'points', 2, null)}>+2 <small>points</small></button>
            </div>
            {isAlm && trackFouls && <button className={styles.foulButton} disabled={busy} onClick={() => setPending({ kind: 'foul', value: 1 })}>+ Faute</button>}
          </div>;
        })}
      </div>
      <div className={styles.lastAction}><div><span>DERNIÈRE ACTION</span><strong>{last ? describeAction(last) : 'Aucune action pour le moment'}</strong></div><button disabled={!last || busy} onClick={() => void update(undoAction)}>↶ Annuler</button></div></>}
      <button className={styles.primary} disabled={busy} onClick={() => {
        const label = readyToFinish ? 'Clôturer le match ? Cette action est irréversible.' : `Clôturer la période ${index + 1} ? Cette action est irréversible.`;
        if (window.confirm(label)) void update(readyToFinish ? finishMatch : closePeriod);
      }}>{readyToFinish ? 'Clôturer le match' : 'Clôturer la période'} <span>→</span></button>
      <p className={styles.footnote}>La clôture est définitive.</p>
    </div>
    <div className={styles.card}><div className={styles.sectionHeading}><div><h2>Le banc ALM</h2><p>Statistiques du match</p></div></div><PlayerStats match={match} trackFouls={trackFouls} /></div>
    {!readyToFinish && pending && <div className={styles.overlay} onClick={() => setPending(null)}><div className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="dialog-title" onClick={(event) => event.stopPropagation()}>
      <div className={styles.dialogTop}><div><div className={styles.eyebrow}>ACTION ALM</div><h2 id="dialog-title">{pending.kind === 'foul' ? 'Qui a fait la faute ?' : `Qui marque ${pending.value} point${pending.value > 1 ? 's' : ''} ?`}</h2><p>Sélectionnez un joueur.</p></div><button className={styles.close} aria-label="Fermer" onClick={() => setPending(null)}>×</button></div>
      <div className={styles.playerChoices}>{[...match.players].sort((a, b) => Number(a.number) - Number(b.number)).map((player) => <button aria-label={`Numéro ${player.number}, ${player.name}`} disabled={busy} key={player.id} onClick={() => record('alm', pending.kind, pending.value, player.id)}><span className={styles.jersey}>{player.number}</span><span className={styles.playerChoiceName}>{player.name}</span></button>)}</div>
    </div></div>}
  </section>;
}

function PlayerStats({ match, trackFouls }: { match: Match; trackFouls: boolean }) {
  return <div className={styles.stats}><div className={styles.statsHead}><span>JOUEUR</span><span>PTS</span>{trackFouls && <span>FT</span>}</div>{match.players.map((player) => {
    const stats = playerStats(match, player.id);
    return <div className={styles.statsRow} key={player.id}><span><b className={styles.jersey}>{player.number}</b> {player.name}</span><strong>{stats.points}</strong>{trackFouls && <strong>{stats.fouls}</strong>}</div>;
  })}</div>;
}

function Roster({ notebook, busy, commit }: { notebook: Notebook; busy: boolean; commit: Commit }) {
  const [players, setPlayers] = useState(() => notebook.roster.map(({ id, name, preferredNumber }) => ({ id, name, preferredNumber: preferredNumber ?? '' })));
  const [formError, setFormError] = useState('');
  function editPlayer(id: string, field: 'name' | 'preferredNumber', value: string) {
    setPlayers((previous) => previous.map((player) => player.id === id ? { ...player, [field]: value } : player));
    setFormError('');
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    const roster = players.map(({ id, name, preferredNumber }) => ({
      id, name: name.trim(), ...(preferredNumber.trim() ? { preferredNumber: preferredNumber.trim() } : {}),
    }));
    if (roster.some(({ name }) => !name)) return setFormError('Tous les joueurs doivent avoir un prénom.');
    const invalidPlayer = roster.find(({ preferredNumber }) => preferredNumber !== undefined && !isJerseyNumber(preferredNumber));
    if (invalidPlayer) return setFormError(`Le numéro préféré de ${invalidPlayer.name} doit être compris entre 1 et 999.`);
    setFormError('');
    await commit((current) => ({ ...current, roster }));
  }
  return <section><div className={styles.eyebrow}>LE CLUB <span> / </span> EFFECTIF</div><div className={styles.pageHeading}><div><h1>Notre effectif<span className={styles.dot}>.</span></h1><p>Enregistrez les prénoms et les numéros préférés pour les prochains matchs.</p></div></div>
    <form onSubmit={(event) => void save(event)}><div className={styles.card}><div className={styles.cardTitle}><span className={styles.step}>14</span><div><h2>Joueurs ALM</h2><p>Les anciens matchs gardent leurs noms d’origine.</p></div></div>
      <div className={styles.editList}>
        <div className={styles.editHeading} aria-hidden="true"><span /><span>Prénom</span><span>N° préféré</span></div>
        {players.map((player, index) => <div className={styles.editRow} key={player.id}>
          <span aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
          <input aria-label={`Prénom du joueur ${index + 1}`} maxLength={100} value={player.name} onChange={(event) => editPlayer(player.id, 'name', event.target.value)} />
          <input aria-label={`Numéro préféré du joueur ${index + 1}`} inputMode="numeric" maxLength={3} placeholder="—" value={player.preferredNumber} onChange={(event) => editPlayer(player.id, 'preferredNumber', event.target.value)} />
        </div>)}
      </div>
    </div>{formError && <p className={styles.alert} role="alert">{formError}</p>}<button className={styles.primary} disabled={busy}>Enregistrer l’effectif <span>→</span></button></form>
    <div className={styles.card}><div className={styles.switchRow}><div><h2>Suivi des fautes</h2><p>Afficher et enregistrer les fautes ALM.</p></div><label className={styles.switch}><input type="checkbox" aria-label="Suivi des fautes" checked={notebook.trackFouls} disabled={busy} onChange={(event) => void commit((current) => ({ ...current, trackFouls: event.target.checked }))} /><span /></label></div><p className={styles.smallText}>Désactiver ce suivi ne supprime pas les fautes déjà enregistrées.</p></div>
  </section>;
}

function History({ notebook }: { notebook: Notebook }) {
  const matches = notebook.matches.filter((match) => match.finishedAt).sort ( (a, b) => (b.finishedAt ?? '').localeCompare(a.finishedAt ?? ''));
  return <section><div className={styles.eyebrow}>LE CARNET <span> / </span> HISTORIQUE</div><div className={styles.pageHeading}><div><h1>Les rencontres<span className={styles.dot}>.</span></h1><p>Les matchs joués et leurs souvenirs.</p></div><span className={styles.count}>{matches.length} MATCH{matches.length !== 1 ? 'S' : ''}</span></div>
    {matches.length === 0 ? <div className={styles.empty}><div>▤</div><h2>La saison commence ici</h2><p>Vos matchs terminés apparaîtront dans cet espace.</p></div> : <div className={styles.historyList}>{matches.map((match) => {
      const total = matchPoints(match);
      return <details className={styles.historyCard} key={match.id}><summary><div><span className={styles.historyDate}>{new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long' }).format(new Date(match.startedAt))} · {match.home ? 'DOMICILE' : 'EXTÉRIEUR'}</span><h2>ALM <span>vs</span> {match.opponent}</h2><p>{total.alm === total.opponent ? 'Match nul' : total.alm > total.opponent ? 'Victoire' : 'Défaite'} · Points de match</p></div><div className={styles.historyScore}>{total.alm} <span>–</span> {total.opponent}<small>Voir le détail ⌄</small></div></summary>
        <div className={styles.historyDetail}><h3>Résultats par période</h3><div className={styles.periodTable}><div><span>PÉRIODE</span><span>PANIERS</span><span>PTS MATCH</span></div>{match.periods.map((period, index) => { const score = periodScore(period); const points = periodPoints(period); return <div key={index}><span>Période {index + 1}</span><strong>{score.alm} – {score.opponent}</strong><strong>{points.alm} – {points.opponent}</strong></div>; })}</div><h3>Statistiques ALM</h3><PlayerStats match={match} trackFouls={notebook.trackFouls} /></div></details>;
    })}</div>}
  </section>;
}

function Backups({ notebook, busy, commit, setError, backup, connectBackup, reconnectBackup, resolveBackup }: {
  notebook: Notebook; busy: boolean; commit: Commit; setError: (message: string) => void;
  backup: BackupStatus; connectBackup: (create: boolean) => Promise<void>;
  reconnectBackup: () => Promise<void>; resolveBackup: (restore: boolean) => Promise<void>;
}) {
  function exportFile() {
    const blob = new Blob([JSON.stringify(makeBackup(notebook), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `le-banc-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function importFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setError('');
    if (file.size > MAX_FILE_SIZE) return setError('Le fichier dépasse la limite de 10 Mo.');
    try {
      const imported = parseBackup(JSON.parse(await file.text()) as unknown);
      const summary = `${imported.roster.length} joueurs, ${imported.matches.filter((match) => match.finishedAt).length} match(s) terminé(s)${activeMatch(imported) ? ' et un match actif' : ''}.`;
      if (window.confirm(`Sauvegarde valide : ${summary}\n\nRemplacer tout le carnet de cet appareil, y compris le match actif et les réglages ? Cette action est irréversible.`)) {
        await commit(() => imported);
      }
    } catch {
      setError('Fichier invalide ou version non prise en charge. Le carnet n’a pas été modifié.');
    }
  }
  async function persist() {
    if (!navigator.storage?.persist) return setError('La protection du stockage n’est pas disponible dans ce navigateur.');
    try {
      await navigator.storage.persist();
    } catch { setError('Impossible de demander la protection du stockage.'); }
  }
  return <section><div className={styles.eyebrow}>LE CARNET <span> / </span> SAUVEGARDES</div><div className={styles.pageHeading}><div><h1>À l’abri<span className={styles.dot}>.</span></h1><p>Votre carnet vous appartient. Gardez-en une copie.</p></div></div>
    <div className={styles.infoBox}><strong>Vos données restent ici.</strong><p>Aucun compte, aucun cloud. Si vous changez d’appareil ou effacez les données du navigateur, utilisez une sauvegarde pour retrouver votre carnet.</p></div>
    <div className={styles.card}><div className={styles.cardTitle}><span className={styles.step}>↻</span><div><h2>Sauvegarde automatique</h2><p>Une copie du carnet est mise à jour dans un fichier choisi sur cet appareil.</p></div></div>
      {!fileBackupSupported() ? <p>Cette fonction n’est pas disponible dans ce navigateur. Utilisez l’export manuel.</p> : <>
        {backup.kind === 'none' && <p>Aucun fichier configuré.</p>}
        {backup.kind === 'ready' && <p>Active : {backup.handle.name}</p>}
        {backup.kind === 'permission' && <p>Autorisez à nouveau l’accès à {backup.handle.name}.</p>}
        {backup.kind === 'error' && <p>Impossible d’accéder à {backup.handle.name} : {backup.detail}</p>}
        {backup.kind === 'conflict' && <p>Le fichier {backup.handle.name} et le carnet de cet appareil sont différents. Choisissez lequel conserver avant de reprendre la sauvegarde.</p>}
        {(backup.kind === 'permission' || backup.kind === 'error') && <button className={styles.secondary} disabled={busy} onClick={() => void reconnectBackup()}>Vérifier l’accès au fichier</button>}
        {backup.kind === 'conflict' && <><button className={styles.secondary} disabled={busy} onClick={() => void resolveBackup(true)}>Restaurer le fichier</button><button className={styles.secondary} disabled={busy} onClick={() => void resolveBackup(false)}>Conserver le carnet de cet appareil</button></>}
        <button className={styles.secondary} disabled={busy} onClick={() => void connectBackup(true)}>Créer un fichier de sauvegarde</button>
        <button className={styles.secondary} disabled={busy} onClick={() => void connectBackup(false)}>Choisir un fichier existant</button>
        <p className={styles.smallText}>Sélecteur Documents : la création et l’ouverture utilisent des emplacements mémorisés distincts.</p>
        <p className={styles.smallText}>Si la création échoue sur Android, choisissez à nouveau le fichier créé. Un fichier vide peut être initialisé après confirmation. Si l’écriture reste impossible, utilisez l’export manuel.</p>
        <p className={styles.smallText}>Le navigateur peut redemander l’autorisation. Conservez aussi une copie hors du téléphone.</p>
      </>}
    </div>
    <div className={styles.card}><div className={styles.cardTitle}><span className={styles.step}>↓</span><div><h2>Exporter le carnet</h2><p>Créez une copie JSON de toutes vos données.</p></div></div><button className={styles.secondary} onClick={exportFile}>Exporter une sauvegarde <span>↗</span></button></div>
    <div className={styles.card}><div className={styles.cardTitle}><span className={styles.step}>↑</span><div><h2>Importer un carnet</h2><p>Restaurez une sauvegarde v1 ou v2 (10 Mo max).</p></div></div><label className={`${styles.secondary} ${styles.fileButton}`}>Choisir un fichier JSON <span>→</span><input type="file" accept=".json,application/json" disabled={busy} onChange={(event) => void importFile(event)} /></label><p className={styles.smallText}>L’import remplace toutes les données après confirmation.</p></div>
    <div className={styles.card}><div className={styles.cardTitle}><span className={styles.step}>◇</span><div><h2>Protéger le stockage</h2><p>Demander au navigateur de conserver les données.</p></div></div><button className={styles.secondary} onClick={() => void persist()}>Demander la protection <span>→</span></button><p className={styles.smallText}>Ce n’est pas une sauvegarde : exportez régulièrement votre carnet.</p></div>
  </section>;
}
