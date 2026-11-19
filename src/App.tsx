import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { registerSW } from 'virtual:pwa-register'
import {
  closeCurrentPeriod,
  createBackup,
  parseBackup,
  matchPoints,
  periodScore,
  playerStats,
  recordAction,
  startMatch,
  undoLastAction,
  type Match,
  type NotebookState,
  type Player,
} from './domain'
import {
  readNotebook,
  replaceNotebook,
  RevisionConflictError,
  requestPersistentStorage,
  writeNotebook,
} from './storage'
import styles from './App.module.css'

type Screen = 'terrain' | 'effectif' | 'historique' | 'sauvegardes'
type PendingAction = { kind: 'score'; points: 1 | 2 } | { kind: 'foul' }
type Selection = { id: string; number: string }

const screens: Array<{ id: Screen; label: string; icon: string }> = [
  { id: 'terrain', label: 'Terrain', icon: '◉' },
  { id: 'effectif', label: 'Effectif', icon: '♟' },
  { id: 'historique', label: 'Historique', icon: '▤' },
  { id: 'sauvegardes', label: 'Sauvegardes', icon: '⇧' },
]

export default function App() {
  const [state, setState] = useState<NotebookState | null>(null)
  const [revision, setRevision] = useState(0)
  const [screen, setScreen] = useState<Screen>('terrain')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null)
  const [waitingUpdate, setWaitingUpdate] = useState<(() => void) | null>(null)
  const [updateReady, setUpdateReady] = useState(false)
  const importInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let active = true
    readNotebook()
      .then(({ state: loaded, revision: loadedRevision }) => {
        if (active) {
          setState(loaded)
          setRevision(loadedRevision)
        }
      })
      .catch((cause: unknown) => {
        if (active) setError(`Impossible de charger le carnet : ${messageOf(cause)}`)
      })
    const updateSW = registerSW({
      immediate: true,
      onNeedRefresh() {
        setWaitingUpdate(() => () => updateSW(true))
      },
      onOfflineReady() {
        setNotice('L’application est prête à fonctionner hors ligne.')
      },
    })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (waitingUpdate && !state?.activeMatch) setUpdateReady(true)
    else setUpdateReady(false)
  }, [waitingUpdate, state?.activeMatch])

  const persist = async (next: NotebookState) => {
    try {
      const nextRevision = await writeNotebook(next, revision)
      setState(next)
      setRevision(nextRevision)
      setError('')
      return true
    } catch (cause) {
      if (cause instanceof RevisionConflictError) {
        try {
          const current = await readNotebook()
          setState(current.state)
          setRevision(current.revision)
        } catch (reloadError) {
          setError(`Conflit de modification. ${messageOf(reloadError)}`)
          return false
        }
      }
      setError(messageOf(cause))
      return false
    }
  }

  const updateRoster = (id: string, name: string) => {
    if (!state) return
    const players = state.players.map((player) => player.id === id ? { ...player, name } : player)
    void persist({ ...state, players })
  }

  const toggleFouls = () => {
    if (!state) return
    const trackFouls = !state.trackFouls
    const activeMatch = state.activeMatch ? { ...state.activeMatch, trackFouls } : null
    void persist({ ...state, trackFouls, activeMatch })
  }

  const handleExport = () => {
    if (!state) return
    const blob = new Blob([createBackup(state)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `le-banc-${new Date().toISOString().slice(0, 10)}.json`
    anchor.click()
    URL.revokeObjectURL(url)
    setNotice('Sauvegarde exportée.')
  }

  const handleImport = async (file?: File) => {
    if (!file || !state) return
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error('Le fichier dépasse la limite de 10 Mo.')
      const imported = parseBackup(await file.text())
      const confirmed = window.confirm(
        `Remplacer le carnet actuel par cette sauvegarde ?\n${imported.matches.length} match(s) terminé(s)${imported.activeMatch ? ' et un match en cours' : ''}.`,
      )
      if (!confirmed) return
      const nextRevision = await replaceNotebook(imported)
      setState(imported)
      setRevision(nextRevision)
      setError('')
      setNotice('Sauvegarde importée.')
    } catch (cause) {
      setError(`Import impossible : ${messageOf(cause)}`)
    } finally {
      if (importInput.current) importInput.current.value = ''
    }
  }

  const requestPersistence = async () => {
    try {
      const persisted = await requestPersistentStorage()
      setNotice(persisted
        ? 'Le navigateur a accepté de protéger le stockage local.'
        : 'Le navigateur n’a pas accordé la protection du stockage local.')
    } catch (cause) {
      setError(messageOf(cause))
    }
  }

  if (!state) {
    return (
      <main className={styles.loading}>
        {error ? <div role="alert">{error}</div> : <p>Ouverture du carnet…</p>}
      </main>
    )
  }

  return (
    <div className={styles.appShell}>
      <header className={styles.topbar}>
        <a className={styles.brand} href="#" onClick={(event) => { event.preventDefault(); setScreen('terrain') }}>
          <span className={styles.brandMark}>B</span>
          <span><strong>Le banc</strong><small>Basket U11 · ALM</small></span>
        </a>
        <div className={styles.localStatus}><span /> Carnet local</div>
      </header>

      <main className={styles.main}>
        <div className={styles.pageHeading}>
          <div>
            <p className={styles.eyebrow}>SAISON · CARNET DE MATCH</p>
            <h1>{screenTitle(screen)}</h1>
          </div>
          {state.activeMatch && <span className={styles.liveBadge}><i /> Match en cours</span>}
        </div>

        {error && <div className={styles.errorBanner} role="alert">{error}<button onClick={() => setError('')} aria-label="Fermer">×</button></div>}
        {notice && <div className={styles.noticeBanner} role="status">{notice}<button onClick={() => setNotice('')} aria-label="Fermer">×</button></div>}
        {updateReady && waitingUpdate && (
          <div className={styles.noticeBanner} role="status">
            Une mise à jour est prête à installer.
            <button className={styles.inlineAction} onClick={waitingUpdate}>Mettre à jour</button>
          </div>
        )}

        {screen === 'terrain' && (
          <Terrain
            state={state}
            onChange={persist}
            pendingAction={pendingAction}
            setPendingAction={setPendingAction}
          />
        )}
        {screen === 'effectif' && (
          <Roster
            players={state.players}
            trackFouls={state.trackFouls}
            onRename={updateRoster}
            onToggleFouls={toggleFouls}
          />
        )}
        {screen === 'historique' && <History matches={state.matches} />}
        {screen === 'sauvegardes' && (
          <section className={styles.panel}>
            <div className={styles.panelHeader}>
              <div><p className={styles.eyebrow}>VOS DONNÉES RESTENT SUR CET APPAREIL</p><h2>Sauvegardes</h2></div>
              <span className={styles.panelIcon}>⇧</span>
            </div>
            <p className={styles.muted}>Exportez régulièrement le carnet pour le conserver ou le transférer vers un autre appareil. L’import remplace aussi un éventuel match en cours.</p>
            <div className={styles.backupActions}>
              <button className={styles.primaryButton} onClick={handleExport}>Exporter le carnet JSON</button>
              <button className={styles.secondaryButton} onClick={() => importInput.current?.click()}>Importer une sauvegarde</button>
              <input
                ref={importInput}
                className={styles.hidden}
                type="file"
                accept="application/json,.json"
                onChange={(event) => void handleImport(event.currentTarget.files?.[0])}
              />
            </div>
            <div className={styles.storageCard}>
              <div><strong>Protection du stockage</strong><p>Demandez au navigateur de limiter l’effacement automatique des données.</p></div>
              <button className={styles.textButton} onClick={() => void requestPersistence()}>Demander</button>
            </div>
            <p className={styles.privacyNote}>Les données ne sont pas synchronisées. Une sauvegarde hors de l’appareil reste nécessaire.</p>
          </section>
        )}
      </main>

      <nav className={styles.bottomNav} aria-label="Navigation principale">
        {screens.map((item) => (
          <button
            key={item.id}
            className={screen === item.id ? styles.navItemActive : styles.navItem}
            onClick={() => setScreen(item.id)}
            aria-current={screen === item.id ? 'page' : undefined}
          >
            <span aria-hidden="true">{item.icon}</span>{item.label}
          </button>
        ))}
      </nav>
    </div>
  )
}

function Terrain({
  state,
  onChange,
  pendingAction,
  setPendingAction,
}: {
  state: NotebookState
  onChange: (next: NotebookState) => Promise<boolean>
  pendingAction: PendingAction | null
  setPendingAction: (action: PendingAction | null) => void
}) {
  const [opponent, setOpponent] = useState('')
  const [location, setLocation] = useState<Match['location']>('home')
  const [selection, setSelection] = useState<Selection[]>([])
  const [setupError, setSetupError] = useState('')
  const [busy, setBusy] = useState(false)
  const match = state.activeMatch
  const currentPeriod = match?.periods.find((period) => !period.closed)
  const score = currentPeriod ? periodScore(currentPeriod) : { alm: 0, opponent: 0 }
  const points = match ? matchPoints(match) : { alm: 0, opponent: 0 }
  const teamLabel = 'ALM'

  const start = async (event: FormEvent) => {
    event.preventDefault()
    setSetupError('')
    try {
      const next = startMatch(state, opponent, location, selection)
      setBusy(true)
      const saved = await onChange(next)
      if (saved) {
        setSelection([])
        setOpponent('')
      }
    } catch (cause) {
      setSetupError(messageOf(cause))
    } finally {
      setBusy(false)
    }
  }

  const addAction = async (action: Parameters<typeof recordAction>[1]) => {
    try {
      setBusy(true)
      const saved = await onChange(recordAction(state, action))
      if (saved) setPendingAction(null)
    } catch (cause) {
      setSetupError(messageOf(cause))
    } finally {
      setBusy(false)
    }
  }

  const closePeriod = async () => {
    if (!match || !currentPeriod) return
    const final = currentPeriod.number === 8
    if (!window.confirm(final ? 'Clôturer le match ? Cette action est irréversible.' : `Clôturer la période ${currentPeriod.number} ? Cette action est irréversible.`)) return
    try {
      setBusy(true)
      await onChange(closeCurrentPeriod(state))
    } catch (cause) {
      setSetupError(messageOf(cause))
    } finally {
      setBusy(false)
    }
  }

  if (!match) {
    return (
      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <div><p className={styles.eyebrow}>AVANT LE COUP D’ENVOI</p><h2>Préparer le match</h2></div>
          <span className={styles.panelIcon}>＋</span>
        </div>
        <form onSubmit={(event) => void start(event)} className={styles.setupForm}>
          <label className={styles.fieldLabel}>
            Équipe adverse
            <input value={opponent} onChange={(event) => setOpponent(event.target.value)} placeholder="Nom de l’équipe" required />
          </label>
          <fieldset className={styles.locationField}>
            <legend>Lieu du match</legend>
            <label><input type="radio" name="location" checked={location === 'home'} onChange={() => setLocation('home')} /> À domicile</label>
            <label><input type="radio" name="location" checked={location === 'away'} onChange={() => setLocation('away')} /> À l’extérieur</label>
          </fieldset>
          <div className={styles.sectionLabel}>
            <div><strong>Feuille de match</strong><span>Choisissez 10 joueurs parmi les 14</span></div>
            <b>{selection.length}<small> / 10</small></b>
          </div>
          <div className={styles.playerPicker}>
            {state.players.map((player) => {
              const selected = selection.find((entry) => entry.id === player.id)
              return (
                <div className={selected ? styles.pickerRowSelected : styles.pickerRow} key={player.id}>
                  <label>
                    <input
                      type="checkbox"
                      checked={Boolean(selected)}
                      onChange={() => setSelection((current) => selected
                        ? current.filter((entry) => entry.id !== player.id)
                        : current.length < 10
                          ? [...current, {
                              id: player.id,
                              number: String(Array.from({ length: 10 }, (_, index) => String(index + 1))
                                .find((number) => !current.some((entry) => Number(entry.number) === Number(number))) ?? current.length + 1),
                            }]
                          : current)}
                    />
                    <span className={styles.playerAvatar}>{initials(player.name)}</span>
                    <span>{player.name}</span>
                  </label>
                  {selected && (
                    <label className={styles.jerseyInput}>
                      N°
                      <input
                        inputMode="numeric"
                        aria-label={`Numéro de ${player.name}`}
                        value={selected.number}
                        onChange={(event) => setSelection((current) => current.map((entry) => entry.id === player.id ? { ...entry, number: event.target.value } : entry))}
                      />
                    </label>
                  )}
                </div>
              )
            })}
          </div>
          {setupError && <p className={styles.formError} role="alert">{setupError}</p>}
          <button className={styles.primaryButton} type="submit" disabled={busy || selection.length !== 10}>
            Démarrer le match <span>→</span>
          </button>
          <p className={styles.helperText}>Les numéros sont propres à ce match et ne modifient pas l’effectif.</p>
        </form>
      </section>
    )
  }

  return (
    <div className={styles.matchLayout}>
      <section className={styles.scorePanel}>
        <div className={styles.matchMeta}>
          <div><p className={styles.eyebrow}>{match.location === 'home' ? 'À DOMICILE' : 'À L’EXTÉRIEUR'}</p><h2>ALM <span>vs</span> {match.opponent}</h2></div>
          <span className={styles.periodPill}>Période {currentPeriod?.number ?? 8} / 8</span>
        </div>
        <div className={styles.scoreboard} data-testid="period-score">
          <div><span className={styles.scoreTeam}>{teamLabel}</span><strong>{score.alm}</strong><small>{points.alm} pts de match</small></div>
          <span className={styles.scoreDivider}>:</span>
          <div><span className={styles.scoreTeam}>{match.opponent}</span><strong>{score.opponent}</strong><small>{points.opponent} pts de match</small></div>
        </div>
        <div className={styles.periodProgress}>
          {match.periods.map((period) => <span key={period.number} className={period.closed ? styles.periodDone : period.number === currentPeriod?.number ? styles.periodCurrent : styles.periodPending}>{period.number}</span>)}
        </div>
        <div className={styles.actionGrid}>
          <div className={styles.teamActions}>
            <p>ALM · choisir un joueur</p>
            <div><button onClick={() => setPendingAction({ kind: 'score', points: 1 })} disabled={busy}>+1</button><button onClick={() => setPendingAction({ kind: 'score', points: 2 })} disabled={busy}>+2</button></div>
            {match.trackFouls && <button className={styles.foulButton} onClick={() => setPendingAction({ kind: 'foul' })} disabled={busy}>＋ Faute</button>}
          </div>
          <div className={styles.opponentActions}>
            <p>{match.opponent} · direct</p>
            <div><button onClick={() => void addAction({ team: 'opponent', kind: 'score', points: 1, playerId: null })} disabled={busy}>+1</button><button onClick={() => void addAction({ team: 'opponent', kind: 'score', points: 2, playerId: null })} disabled={busy}>+2</button></div>
          </div>
        </div>
        {pendingAction && (
          <div className={styles.playerModal} role="dialog" aria-modal="true" aria-label="Choisir le joueur">
            <div className={styles.modalCard}>
              <div className={styles.modalHeading}><div><p className={styles.eyebrow}>ACTION ALM</p><h3>{pendingAction.kind === 'foul' ? 'Attribuer une faute' : `Attribuer ${pendingAction.points} point${pendingAction.points > 1 ? 's' : ''}`}</h3></div><button onClick={() => setPendingAction(null)} aria-label="Annuler">×</button></div>
              <div className={styles.modalPlayers}>
                {match.players.map((player) => (
                  <button key={player.id} onClick={() => void addAction(pendingAction.kind === 'foul'
                    ? { team: 'alm', kind: 'foul', points: 0, playerId: player.id }
                    : { team: 'alm', kind: 'score', points: pendingAction.points, playerId: player.id })}>
                    <b>{player.number}</b><span>{player.name}</span><i>→</i>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
        <div className={styles.matchFooter}>
          <button className={styles.secondaryButton} onClick={() => void onChange(undoLastAction(state))} disabled={busy || !currentPeriod?.actions.length}>↶ Annuler la dernière action</button>
          <button className={styles.primaryButton} onClick={() => void closePeriod()} disabled={busy}>Clôturer {currentPeriod?.number === 8 ? 'le match' : 'la période'} <span>→</span></button>
        </div>
      </section>
      <section className={styles.panel}>
        <div className={styles.panelHeader}><div><p className={styles.eyebrow}>PÉRIODE {currentPeriod?.number}</p><h2>Actions récentes</h2></div></div>
        {!currentPeriod?.actions.length ? <p className={styles.muted}>Les actions de la période apparaîtront ici.</p> : (
          <ol className={styles.actionList}>
            {[...currentPeriod.actions].reverse().map((action) => {
              const player = action.playerId ? match.players.find((candidate) => candidate.id === action.playerId) : null
              return <li key={action.id}><span className={action.team === 'alm' ? styles.actionDotAlm : styles.actionDotOpponent} /><strong>{action.kind === 'foul' ? 'Faute' : `+${action.points}`}</strong><span>{action.team === 'alm' ? player?.name : match.opponent}</span><small>{action.team === 'alm' ? 'ALM' : 'ADV.'}</small></li>
            })}
          </ol>
        )}
      </section>
    </div>
  )
}

function Roster({
  players,
  trackFouls,
  onRename,
  onToggleFouls,
}: {
  players: Player[]
  trackFouls: boolean
  onRename: (id: string, name: string) => void
  onToggleFouls: () => void
}) {
  const [drafts, setDrafts] = useState(() => Object.fromEntries(players.map((player) => [player.id, player.name])))
  return (
    <section className={styles.panel}>
      <div className={styles.panelHeader}><div><p className={styles.eyebrow}>14 JOUEURS · ALM</p><h2>Effectif permanent</h2></div><span className={styles.panelIcon}>♟</span></div>
      <p className={styles.muted}>Modifiez les noms ici. Les matchs déjà joués conservent leurs propres feuilles de match.</p>
      <div className={styles.rosterList}>
        {players.map((player, index) => (
          <label className={styles.rosterRow} key={player.id}>
            <span className={styles.rosterNumber}>{String(index + 1).padStart(2, '0')}</span>
            <input
              value={drafts[player.id] ?? player.name}
              aria-label={`Nom du joueur ${index + 1}`}
              onChange={(event) => setDrafts((current) => ({ ...current, [player.id]: event.target.value }))}
              onBlur={() => {
                const name = drafts[player.id]?.trim()
                if (name && name !== player.name) onRename(player.id, name)
                else if (!name) setDrafts((current) => ({ ...current, [player.id]: player.name }))
              }}
            />
            <span className={styles.editIcon}>✎</span>
          </label>
        ))}
      </div>
      <div className={styles.settingRow}>
        <div><strong>Suivi des fautes</strong><p>Attribuer les fautes aux joueurs ALM pendant le match.</p></div>
        <button
          type="button"
          role="switch"
          aria-checked={trackFouls}
          className={trackFouls ? styles.switchOn : styles.switchOff}
          onClick={onToggleFouls}
        ><span /></button>
      </div>
      <p className={styles.helperText}>Le réglage s’applique aux nouveaux matchs. Les fautes déjà enregistrées ne sont jamais effacées.</p>
    </section>
  )
}

function History({ matches }: { matches: Match[] }) {
  const sorted = useMemo(() => [...matches].sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? '')), [matches])
  if (!sorted.length) {
    return <section className={styles.emptyState}><span>▤</span><h2>Pas encore de match terminé</h2><p>Les résultats et statistiques apparaîtront ici après le huitième quart-temps.</p></section>
  }
  return (
    <div className={styles.historyList}>
      {sorted.map((match) => <HistoryMatch key={match.id} match={match} />)}
    </div>
  )
}

function HistoryMatch({ match }: { match: Match }) {
  const [expanded, setExpanded] = useState(false)
  const points = matchPoints(match)
  const stats = playerStats(match)
  const finalScore = match.periods.reduce((sum, period) => {
    const score = periodScore(period)
    return { alm: sum.alm + score.alm, opponent: sum.opponent + score.opponent }
  }, { alm: 0, opponent: 0 })
  return (
    <article className={styles.historyCard}>
      <button className={styles.historySummary} onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>
        <div><p className={styles.eyebrow}>{formatDate(match.completedAt)} · {match.location === 'home' ? 'DOMICILE' : 'EXTÉRIEUR'}</p><h2>ALM <span>vs</span> {match.opponent}</h2><small>{finalScore.alm} – {finalScore.opponent} paniers cumulés</small></div>
        <div className={styles.historyResult}><strong>{points.alm} – {points.opponent}</strong><small>points de match</small><span>{expanded ? '−' : '+'}</span></div>
      </button>
      {expanded && (
        <div className={styles.historyDetails}>
          <div className={styles.periodResults}><strong>Résultats par période</strong><div>{match.periods.map((period) => <span key={period.number}><small>P{period.number}</small><b>{period.awardedAlm}–{period.awardedOpponent}</b></span>)}</div></div>
          <div className={styles.statsTable}>
            <div className={styles.statsHeader}><strong>Joueur</strong><strong>Points</strong>{match.trackFouls && <strong>Fautes</strong>}</div>
            {stats.map((entry) => <div key={entry.player.id}><span><b>{entry.player.number}</b> {entry.player.name}</span><span>{entry.points}</span>{match.trackFouls && <span>{entry.fouls}</span>}</div>)}
          </div>
        </div>
      )}
    </article>
  )
}

function screenTitle(screen: Screen) {
  return { terrain: 'Le terrain', effectif: 'Les joueurs', historique: 'Les matchs', sauvegardes: 'Votre carnet' }[screen]
}

function initials(name: string) {
  return name.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join('')
}

function formatDate(value: string | null) {
  return value ? new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' }).format(new Date(value)) : ''
}

function messageOf(cause: unknown) {
  return cause instanceof Error ? cause.message : 'Une erreur inattendue est survenue.'
}
