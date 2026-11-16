import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useRegisterSW } from 'virtual:pwa-register/react'
import {
  addEvent, completedPeriods, exportBackup, finishPeriod, importBackup,
  matchPoints, periodPoints, periodScore, playerStats, saveAlmRoster, setTrackFouls, startAlmMatch,
  undoEvent, type AppData, type EventKind, type Match, type RosterPlayer, type Side,
} from './domain'
import { database, errorMessage } from './storage'
import styles from './App.module.css'

type View = 'court' | 'teams' | 'history' | 'backup'
type Commit = (change: (data: AppData) => AppData, message: string) => Promise<boolean>

const date = (value: string) => new Date(value).toLocaleDateString('fr-FR', {
  day: 'numeric', month: 'short', year: 'numeric',
})

export default function App() {
  const stored = useLiveQuery(() => database.read())
  const [view, setView] = useState<View>('court')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [online, setOnline] = useState(navigator.onLine)
  const writing = useRef(false)
  const { needRefresh: [needRefresh], offlineReady: [offlineReady], updateServiceWorker } = useRegisterSW({
    onRegisterError: (reason: unknown) => setError(`Mode hors ligne indisponible : ${errorMessage(reason)}`),
  })

  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])

  const active = stored?.data.matches.find((match) => match.status === 'active')
  const commit: Commit = async (change, success) => {
    if (!stored || writing.current) return false
    writing.current = true
    setBusy(true)
    setError('')
    try {
      await database.commit(stored.revision, change)
      setMessage(success)
      return true
    } catch (reason) {
      setError(`Enregistrement impossible : ${errorMessage(reason)} L’action n’a pas été enregistrée.`)
      return false
    } finally {
      writing.current = false
      setBusy(false)
    }
  }

  async function applyUpdate() {
    try {
      const current = await database.read()
      if (current.data.matches.some((match) => match.status === 'active')) {
        throw new Error('Terminez le match avant de mettre à jour.')
      }
      await updateServiceWorker(true)
    } catch (reason) {
      setError(errorMessage(reason))
    }
  }

  return (
    <div className={styles.app}>
      <header className={styles.header}>
        <a className={styles.brand} href="#main" onClick={() => setView('court')}>
          <img src="/icon.svg" width="38" height="38" alt="" />
          <span>le banc<span className={styles.brandSub}>BASKET U11</span></span>
        </a>
        <span className={styles.connection}>
          <span className={online ? styles.dot : styles.offlineDot} />
          {!online ? 'Hors ligne' : offlineReady || navigator.serviceWorker?.controller ? 'Prêt hors ligne' : 'Sur cet appareil'}
        </span>
      </header>

      <main id="main" className={styles.main}>
        {error && <div role="alert" className={styles.error}>{error}<button onClick={() => setError('')} aria-label="Fermer l’erreur">×</button></div>}
        <div role="status" className={styles.status}>{busy ? 'Enregistrement…' : message}</div>
        {needRefresh && <div className={styles.notice}>
          <span>{active ? 'Mise à jour disponible. Elle attendra la fin du match.' : 'Une nouvelle version est disponible.'}</span>
          {!active && <button className={styles.smallButton} disabled={busy} onClick={() => void applyUpdate()}>Mettre à jour</button>}
        </div>}
        {!stored ? <p>Ouverture du carnet local…</p> : <>
          {view === 'court' && (active
            ? <LiveMatch key={active.id} match={active} trackFouls={stored.data.settings.trackFouls} busy={busy} commit={commit} error={error} />
            : <Home data={stored.data} busy={busy} commit={commit} onTeams={() => setView('teams')} />)}
          {view === 'teams' && <AlmRoster roster={stored.data.almRoster} busy={busy} commit={commit} />}
          {view === 'history' && <History matches={stored.data.matches} trackFouls={stored.data.settings.trackFouls} />}
          {view === 'backup' && <Backups data={stored.data} busy={busy} commit={commit} error={error} onError={setError} onMessage={setMessage} />}
        </>}
        <footer className={styles.footer}>Votre match. Votre téléphone. Aucune donnée envoyée.</footer>
      </main>

      <nav className={styles.nav} aria-label="Navigation principale">
        {([
          ['court', '◎', active ? 'Match en cours' : 'Terrain'],
          ['teams', '♧', 'Effectif ALM'],
          ['history', '▤', 'Historique'],
          ['backup', '⇩', 'Sauvegardes'],
        ] as const).map(([id, icon, label]) => <button
          key={id} onClick={() => setView(id)} aria-current={view === id ? 'page' : undefined}
        ><span aria-hidden="true">{icon}</span>{label}{id === 'court' && active && <i className={styles.liveDot} />}</button>)}
      </nav>
    </div>
  )
}

interface PageHeadingProps { eyebrow: string; title: string; children?: ReactNode }
function PageHeading({ eyebrow, title, children }: PageHeadingProps) {
  return <div className={styles.heading}>
    <p className={styles.eyebrow}>{eyebrow}</p>
    <h1>{title}</h1>
    {children && <p className={styles.subtitle}>{children}</p>}
  </div>
}

interface HomeProps { data: AppData; busy: boolean; commit: Commit; onTeams: () => void }
function Home({ data, busy, commit, onTeams }: HomeProps) {
  const [opponent, setOpponent] = useState('')
  const [almSide, setAlmSide] = useState<Side>('home')
  const [selection, setSelection] = useState<Record<string, string>>({})
  const [validation, setValidation] = useState('')
  const selectedCount = Object.keys(selection).length
  const last = data.matches.filter((match) => match.status === 'finished').at(-1)
  function submit(event: FormEvent) {
    event.preventDefault()
    const numbers = Object.values(selection).map(Number)
    if (new Set(numbers).size !== numbers.length) {
      setValidation('Chaque joueur sélectionné doit avoir un numéro différent.')
      return
    }
    setValidation('')
    void commit((current) => startAlmMatch(current, opponent, Object.entries(selection).map(([playerId, number]) => ({ playerId, number })), almSide), 'Match démarré. À vous de jouer !')
  }
  return <>
    <PageHeading eyebrow="AU PLUS PRÈS DU JEU" title="Place au match.">
      Les yeux sur le terrain. Le score au bout des doigts.
    </PageHeading>
    <section className={styles.hero}>
      <div>
        <span className={styles.lightEyebrow}>LE CARNET DU BANC</span>
        <h2>Petits joueurs.<br />Grands moments.</h2>
        <p>8 périodes. Une équipe à encourager.<br />Et rien à perdre, même sans réseau.</p>
        <span className={styles.heroTag}>100 % local · 100 % dans le match</span>
      </div>
      <div className={styles.courtArt} aria-hidden="true"><div className={styles.ball}>✳</div></div>
    </section>
    <section className={styles.card}>
      <div className={styles.sectionTitle}><h2>Nouveau match</h2><span className={styles.pill}>U11 · 8 périodes</span></div>
      <p className={styles.muted}>ALM est prête. Sélectionnez les 10 joueurs du match parmi les 14 de l’effectif, puis attribuez leurs numéros.</p>
      <button className={styles.smallButton} onClick={onTeams}>Voir ou modifier l’effectif ALM</button>
      <form onSubmit={submit}>
        <fieldset className={styles.formFields} disabled={busy}>
          <legend className={styles.srOnly}>Préparation du match ALM</legend>
          <div className={styles.versusForm}>
            <label>ALM joue<select value={almSide} onChange={(event) => setAlmSide(event.target.value === 'home' ? 'home' : 'away')}>
              <option value="home">À domicile</option><option value="away">À l’extérieur</option>
            </select></label>
            <span className={styles.vs}>VS</span>
            <label>Nom de l’équipe adverse<input required maxLength={80} pattern=".*\S.*" value={opponent} onChange={(event) => setOpponent(event.target.value)} placeholder="Nom du club adverse" /></label>
          </div>
          <div className={styles.sectionTitle}><h3>La sélection du match</h3><span className={styles.pill} role="status">{selectedCount} / 10 sélectionnés</span></div>
          {validation && <p role="alert" className={styles.error}>{validation}</p>}
          <div className={styles.selectionGrid}>{data.almRoster.map((player) => {
            const selected = Object.hasOwn(selection, player.id)
            return <div key={player.id} className={selected ? styles.selectedPlayer : styles.selectionPlayer}>
              <label className={styles.checkLabel}><input type="checkbox" checked={selected} disabled={!selected && selectedCount >= 10} onChange={(event) => {
                if (event.target.checked) setSelection({ ...selection, [player.id]: '' })
                else setSelection(Object.fromEntries(Object.entries(selection).filter(([id]) => id !== player.id)))
              }} />{player.name}</label>
              {selected && <label className={styles.jerseyInput}><span className={styles.srOnly}>Numéro de {player.name}</span><input
                required inputMode="numeric" pattern="[0-9]{1,3}" maxLength={3}
                value={selection[player.id]} placeholder="N°"
                onChange={(event) => setSelection({ ...selection, [player.id]: event.target.value })}
              /></label>}
            </div>
          })}</div>
          <p className={styles.hint}>Les numéros sont propres à ce match et doivent être distincts. Aucun joueur ni numéro n’est demandé pour l’adversaire.</p>
          <div className={styles.actions}><button className={styles.primary} disabled={selectedCount !== 10 || !opponent.trim() || Object.values(selection).some((number) => !/^\d{1,3}$/.test(number))}>C’est parti <span aria-hidden="true">→</span></button></div>
        </fieldset>
      </form>
    </section>
    <FoulSetting enabled={data.settings.trackFouls} busy={busy} commit={commit} />
    {last && <section className={styles.card}>
      <p className={styles.eyebrow}>DERNIER COUP DE SIFFLET · {date(last.createdAt)}</p>
      <MatchResult match={last} />
    </section>}
    <Rules />
  </>
}

function Rules() {
  return <details className={styles.rules}>
    <summary>Le mémo des règles</summary>
    <p>8 périodes, chacune repartant à 0–0. Pour ALM : touchez +1 ou +2, puis le numéro du joueur. Le score adverse est enregistré directement, sans joueur.</p>
    <p>Points de match par période : victoire <strong>3</strong>, égalité <strong>2</strong>, défaite <strong>1</strong>. Le résultat final est la somme de ces points ; un match nul reste nul.</p>
    <p>Le suivi des fautes est facultatif et désactivé par défaut. S’il est activé, les fautes ALM se cumulent sur tout le match, sans exclusion automatique. Pas de chronomètre.</p>
    <p>Vous pouvez annuler les points et fautes de la période en cours, du plus récent au plus ancien. Une clôture confirmée est définitive.</p>
    <p>Règles personnelles fournies pour cet usage U11, non vérifiées contre un règlement officiel.</p>
  </details>
}

interface AlmRosterProps { roster: RosterPlayer[]; busy: boolean; commit: Commit }
function AlmRoster({ roster, busy, commit }: AlmRosterProps) {
  const [editing, setEditing] = useState(false)
  return <>
    <PageHeading eyebrow="NOTRE ÉQUIPE" title="ALM, toujours au rendez-vous.">14 joueurs enregistrés, 10 sélectionnés pour chaque match.</PageHeading>
    {editing ? <RosterEditor roster={roster} busy={busy} onCancel={() => setEditing(false)} onSave={async (players) => {
      if (await commit((data) => saveAlmRoster(data, players), 'Effectif ALM enregistré.')) setEditing(false)
    }} /> : <>
      <section className={styles.card}>
        <div className={styles.sectionTitle}><h2>Effectif permanent ALM</h2><button className={styles.smallButton} onClick={() => setEditing(true)}>Modifier l’effectif</button></div>
        <div className={styles.roster}>{roster.map((player) => <span key={player.id}>{player.name}</span>)}</div>
        <p className={styles.hint}>Pas de numéro fixe : les maillots sont attribués lors de la sélection du match.</p>
      </section>
      <p className={styles.hint}>Modifier l’effectif ne change pas les noms et numéros des matchs déjà démarrés.</p>
    </>}
  </>
}

interface RosterEditorProps {
  roster: RosterPlayer[]; busy: boolean; onSave: (roster: RosterPlayer[]) => Promise<void>; onCancel: () => void
}
function RosterEditor({ roster, busy, onSave, onCancel }: RosterEditorProps) {
  const [players, setPlayers] = useState(roster.map((player) => ({ ...player })))
  return <form className={styles.card} onSubmit={(event) => {
    event.preventDefault()
    void onSave(players.map((player) => ({ ...player, name: player.name.trim() })))
  }}>
    <h2>Modifier les 14 joueurs ALM</h2>
    <fieldset className={styles.formFields} disabled={busy}><legend className={styles.srOnly}>Noms de l’effectif permanent</legend>
      <div className={styles.selectionGrid}>{players.map((player, index) => <label key={player.id}>Joueur {index + 1}<input required maxLength={80} pattern=".*\S.*" value={player.name} onChange={(event) => setPlayers(players.map((item) => item.id === player.id ? { ...item, name: event.target.value } : item))} /></label>)}</div>
      <div className={styles.actions}><button type="button" className={styles.secondary} onClick={onCancel}>Annuler</button><button className={styles.primary}>Enregistrer l’effectif</button></div>
    </fieldset>
  </form>
}

interface FoulSettingProps { enabled: boolean; busy: boolean; commit: Commit }
function FoulSetting({ enabled, busy, commit }: FoulSettingProps) {
  return <div className={styles.card}>
    <label className={styles.checkLabel}><input type="checkbox" checked={enabled} disabled={busy} onChange={(event) => {
      const checked = event.target.checked
      void commit((data) => setTrackFouls(data, checked), checked ? 'Suivi des fautes activé.' : 'Suivi des fautes désactivé.')
    }} />Activer le suivi des fautes</label>
    <p className={styles.hint}>Désactivé par défaut. Ce réglage est conservé sur cet appareil. Désactiver masque les fautes sans effacer celles déjà enregistrées.</p>
  </div>
}

interface MatchProps { match: Match; trackFouls: boolean; busy: boolean; commit: Commit; error: string }
function LiveMatch({ match, trackFouls, busy, commit, error }: MatchProps) {
  const [confirm, setConfirm] = useState(false)
  const [pending, setPending] = useState<{ side: Side; kind: EventKind; period: number } | null>(null)
  const current = match.periods.at(-1)!
  const score = periodScore(current)
  const total = matchPoints(match)
  const last = current.at(-1)
  const lastPlayer = last && match[last.side].players.find((player) => player.id === last.playerId)
  async function record(side: Side, kind: EventKind, playerId: string | null) {
    const player = match[side].players.find((item) => item.id === playerId)
    const success = await commit((data) => addEvent(data, match.id, side, playerId, kind),
      `${match[side].name}${player ? ` · #${player.number} ${player.name}` : ''} : ${kind === 'foul' ? 'faute' : kind === 'one' ? '+1 point' : '+2 points'}.`)
    if (success) setPending(null)
  }
  function chooseAction(side: Side, kind: EventKind) {
    if (match.almSide !== null && side !== match.almSide) void record(side, kind, null)
    else setPending({ side, kind, period: match.periods.length })
  }
  return <>
    <PageHeading eyebrow="LE MATCH EST À VOUS" title="On ne lâche rien.">
      <span className={styles.pill}><i className={styles.liveDot} /> EN COURS</span> <span>Enregistré après chaque action</span>
    </PageHeading>
    <section className={styles.scoreboard} aria-label="Tableau des scores">
      <div className={styles.scoreTop}><span>PÉRIODE <b>{match.periods.length}</b> / 8</span><span>POINTS DE PANIERS</span></div>
      <div className={styles.scoreLine}>
        <div><span className={styles.sideLabel}>DOMICILE</span><h2>{match.home.name}</h2><strong aria-label={`${match.home.name} : ${score.home} points de paniers`}>{score.home}</strong></div>
        <span className={styles.scoreDash}>:</span>
        <div><span className={styles.sideLabel}>EXTÉRIEUR</span><h2>{match.away.name}</h2><strong aria-label={`${match.away.name} : ${score.away} points de paniers`}>{score.away}</strong></div>
      </div>
      <div className={styles.matchTotal}><span>POINTS DE MATCH <small>Périodes terminées</small></span><b>{total.home} <span>–</span> {total.away}</b></div>
    </section>
    <div className={styles.scoringGrid}>{(['home', 'away'] as const).map((side) => <section key={side} className={styles.card} aria-label={`Actions ${match[side].name}`}>
      <div className={styles.sectionTitle}><h2>{match[side].name}</h2><span className={side === 'home' ? styles.homeBadge : styles.awayBadge}>{side === 'home' ? 'DOM.' : 'EXT.'}</span></div>
      <div className={styles.scoreActions}>
        <button className={styles.pointButton} disabled={busy} onClick={() => chooseAction(side, 'one')} aria-label={`1 point pour ${match[side].name}`}><b>+1</b><span>point</span></button>
        <button className={styles.pointButton} disabled={busy} onClick={() => chooseAction(side, 'two')} aria-label={`2 points pour ${match[side].name}`}><b>+2</b><span>points</span></button>
        {trackFouls && (match.almSide === null || side === match.almSide) && <button className={styles.foulButton} disabled={busy} onClick={() => chooseAction(side, 'foul')} aria-label={`Faute pour ${match[side].name}`}><b>F</b><span>faute</span></button>}
      </div>
      <p className={styles.hint}>{match.almSide !== null && side !== match.almSide ? 'Score direct, sans joueur adverse.' : 'Touchez +1 ou +2, puis le numéro du joueur.'}</p>
    </section>)}</div>
    <div className={styles.matchControls}>
      <div><button className={styles.secondary} disabled={busy || !last} onClick={() => void commit((data) => undoEvent(data, match.id), 'Dernière action annulée.')}>↶ Annuler la dernière action</button>
        <p className={styles.hint}>{last ? `Dernière : ${lastPlayer ? `#${lastPlayer.number} ${lastPlayer.name} · ` : ''}${match[last.side].name}, ${last.kind === 'foul' ? 'faute' : last.kind === 'one' ? '+1' : '+2'}` : 'Aucune action dans cette période.'}</p>
      </div>
      <button className={styles.primary} disabled={busy} onClick={() => setConfirm(true)}>{match.periods.length === 8 ? 'Terminer le match' : 'Terminer la période'} →</button>
    </div>
    <PeriodTable match={match} />
    <Stats match={match} trackFouls={trackFouls} />
    <FoulSetting enabled={trackFouls} busy={busy} commit={commit} />
    <Rules />
    {pending && pending.period === match.periods.length && (pending.kind !== 'foul' || trackFouls) && <Dialog
      title={pending.kind === 'foul' ? `Faute ${match[pending.side].name} : quel numéro ?` : `${pending.kind === 'one' ? '+1 point' : '+2 points'} ${match[pending.side].name} : quel numéro ?`}
      busy={busy} onCancel={() => setPending(null)}
    >
      <p className={styles.muted}>Le score sera enregistré après le choix du joueur.</p>
      {error && <p role="alert" className={styles.error}>{error}</p>}
      <div className={styles.numberGrid}>{[...match[pending.side].players].sort((a, b) => Number(a.number) - Number(b.number)).map((player) => <button
        key={player.id} className={styles.numberButton} disabled={busy}
        onClick={() => void record(pending.side, pending.kind, player.id)}
        aria-label={`Numéro ${player.number}, ${player.name}`}
      ><strong>{player.number}</strong><span>{player.name}</span></button>)}</div>
      <div className={styles.actions}><button className={styles.secondary} disabled={busy} onClick={() => setPending(null)}>Annuler</button></div>
    </Dialog>}
    {confirm && <Confirm
      title={match.periods.length === 8 ? 'Le dernier coup de sifflet ?' : `Clôturer la période ${match.periods.length} ?`}
      confirmLabel={match.periods.length === 8 ? 'Confirmer la fin du match' : 'Confirmer la fin de période'}
      busy={busy}
      error={error}
      onCancel={() => setConfirm(false)}
      onConfirm={async () => {
        if (await commit((data) => finishPeriod(data, match.id), match.periods.length === 8 ? 'Match terminé et conservé dans l’historique.' : 'Période terminée. Les paniers repartent à zéro.')) setConfirm(false)
      }}
    ><p><strong>{match.home.name} {score.home} – {score.away} {match.away.name}</strong></p>
      <p>Points de match attribués : {periodPoints(score).home} – {periodPoints(score).away}.</p>
      <p>Cette clôture est définitive. Les actions de cette période ne pourront plus être annulées.</p>
    </Confirm>}
  </>
}

interface ConfirmProps {
  title: string; children: ReactNode; confirmLabel: string; busy: boolean; error: string
  onCancel: () => void; onConfirm: () => Promise<void>
}
function Confirm({ title, children, confirmLabel, busy, error, onCancel, onConfirm }: ConfirmProps) {
  return <Dialog title={title} busy={busy} onCancel={onCancel}>
    {children}
    {error && <p role="alert" className={styles.error}>{error}</p>}
    <div className={styles.actions}><button autoFocus className={styles.secondary} disabled={busy} onClick={onCancel}>Revenir</button><button className={styles.primary} disabled={busy} onClick={() => void onConfirm()}>{confirmLabel}</button></div>
  </Dialog>
}

interface DialogProps { title: string; children: ReactNode; busy: boolean; onCancel: () => void }
function Dialog({ title, children, busy, onCancel }: DialogProps) {
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  useEffect(() => {
    const element = dialog.current!
    element.showModal()
    return () => element.close()
  }, [])
  return <dialog ref={dialog} className={styles.dialog} aria-labelledby={titleId} onCancel={(event) => {
    event.preventDefault()
    if (!busy) onCancel()
  }}>
    <h2 id={titleId}>{title}</h2>
    {children}
  </dialog>
}

interface MatchReadProps { match: Match }
function PeriodTable({ match }: MatchReadProps) {
  const periods = completedPeriods(match)
  if (!periods.length) return null
  return <section className={styles.card}>
    <h2>Le fil du match</h2>
    <div className={styles.tableWrap}><table>
      <caption className={styles.srOnly}>Résultats des périodes terminées</caption>
      <thead><tr><th>Période</th><th>Paniers<br /><small>Dom. – Ext.</small></th><th>Points de match<br /><small>Dom. – Ext.</small></th></tr></thead>
      <tbody>{periods.map((events, index) => {
        const score = periodScore(events)
        const points = periodPoints(score)
        return <tr key={index}><th scope="row">{String(index + 1).padStart(2, '0')}</th><td>{score.home} – {score.away}</td><td><strong>{points.home} – {points.away}</strong></td></tr>
      })}</tbody>
      <tfoot><tr><th>Total match</th><td>—</td><td>{matchPoints(match).home} – {matchPoints(match).away}</td></tr></tfoot>
    </table></div>
  </section>
}

interface StatsProps extends MatchReadProps { trackFouls: boolean }
function Stats({ match, trackFouls }: StatsProps) {
  return <details className={styles.rules}>
    <summary>La feuille des joueurs · {trackFouls ? 'points et fautes cumulés' : 'points cumulés'}</summary>
    <div className={styles.scoringGrid}>{(['home', 'away'] as const).filter((side) => match[side].players.length > 0).map((side) => <div key={side}>
      <h3>{match[side].name}</h3>
      <table><caption className={styles.srOnly}>Statistiques {match[side].name}</caption><thead><tr><th>Joueur</th><th>Pts</th>{trackFouls && <th>Fautes</th>}</tr></thead>
        <tbody>{match[side].players.map((player) => {
          const stats = playerStats(match, side, player.id)
          return <tr key={player.id}><th scope="row">#{player.number} {player.name}</th><td>{stats.points}</td>{trackFouls && <td>{stats.fouls}</td>}</tr>
        })}</tbody>
      </table>
    </div>)}</div>
  </details>
}

function MatchResult({ match }: MatchReadProps) {
  const points = matchPoints(match)
  return <>
    <div className={styles.result}><span>{match.home.name}</span><strong>{points.home} <span>–</span> {points.away}</strong><span>{match.away.name}</span></div>
    <p className={styles.resultCaption}>{points.home === points.away ? 'Match nul' : `Victoire ${points.home > points.away ? match.home.name : match.away.name}`} · points de match</p>
  </>
}

interface HistoryProps { matches: Match[]; trackFouls: boolean }
function History({ matches, trackFouls }: HistoryProps) {
  const finished = matches.filter((match) => match.status === 'finished').toReversed()
  return <>
    <PageHeading eyebrow="LES SOUVENIRS DU TERRAIN" title="Chaque match compte.">Les résultats et les feuilles de vos rencontres terminées.</PageHeading>
    {!finished.length && <div className={styles.empty}><span aria-hidden="true">▤</span><h2>L’histoire reste à écrire.</h2><p>Vos matchs terminés apparaîtront ici.</p></div>}
    {finished.map((match) => <section key={match.id} className={styles.card}>
      <div className={styles.sectionTitle}><span className={styles.eyebrow}>{date(match.createdAt)}</span><span className={styles.pill}>TERMINÉ · 8 / 8</span></div>
      <MatchResult match={match} />
      <details className={styles.historyDetails}><summary>Voir la feuille de match</summary><PeriodTable match={match} /><Stats match={match} trackFouls={trackFouls} /></details>
    </section>)}
  </>
}

interface BackupsProps { data: AppData; busy: boolean; commit: Commit; error: string; onError: (message: string) => void; onMessage: (message: string) => void }
function Backups({ data, busy, commit, error, onError, onMessage }: BackupsProps) {
  const [pending, setPending] = useState<AppData | null>(null)
  const [reading, setReading] = useState(false)
  const [durability, setDurability] = useState('')
  function download() {
    try {
      const url = URL.createObjectURL(new Blob([exportBackup(data)], { type: 'application/json' }))
      const link = document.createElement('a')
      link.href = url
      link.download = `basket-u11-${new Date().toISOString().slice(0, 10)}.json`
      document.body.append(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      onMessage('Export déclenché. Vérifiez le fichier dans vos téléchargements.')
    } catch (reason) {
      onError(`Export impossible : ${errorMessage(reason)}`)
    }
  }
  async function load(file: File) {
    setReading(true)
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error('Le fichier dépasse la limite de 10 Mo.')
      setPending(importBackup(await file.text()))
    } catch (reason) {
      onError(errorMessage(reason))
    } finally {
      setReading(false)
    }
  }
  async function protect() {
    try {
      if (!navigator.storage?.persist) {
        setDurability('Ce navigateur ne permet pas de demander le stockage persistant. Continuez à exporter vos données.')
        return
      }
      const granted = await navigator.storage.persist()
      setDurability(granted ? 'Stockage persistant accordé. Les exports restent indispensables.' : 'Protection non accordée par le navigateur. Exportez régulièrement vos données.')
    } catch (reason) {
      onError(`Protection du stockage impossible : ${errorMessage(reason)}`)
    }
  }
  return <>
    <PageHeading eyebrow="ON GARDE UNE TRACE" title="Un carnet à garder.">Vos données restent ici. Les sauvegardes voyagent avec vous.</PageHeading>
    <div className={styles.notice}>Vider les données du navigateur, désinstaller l’application ou perdre ce téléphone peut effacer votre carnet. Exportez-le régulièrement.</div>
    <div className={styles.teamGrid}>
      <section className={styles.card}><span className={styles.featureIcon}>↗</span><h2>Mettre de côté</h2><p className={styles.muted}>Un fichier JSON avec l’effectif ALM, les sélections et numéros de chaque match, les réglages, l’historique et le match en cours. Les anciens carnets restent compatibles.</p><p>{data.almRoster.length} joueurs ALM · {data.matches.length} match{data.matches.length > 1 ? 's' : ''}</p><button className={styles.primary} disabled={busy} onClick={download}>Exporter mes données</button></section>
      <section className={styles.card}><span className={styles.featureIcon}>↙</span><h2>Reprendre un carnet</h2><p className={styles.muted}>Choisissez une sauvegarde de cette application. Elle sera vérifiée avant tout remplacement.</p><label>Fichier de sauvegarde (10 Mo max.)<input type="file" accept=".json,application/json" disabled={busy || reading} onChange={(event) => {
        const file = event.target.files?.[0]
        if (file) void load(file)
        event.target.value = ''
      }} /></label>{reading && <p role="status">Vérification du fichier…</p>}</section>
    </div>
    <section className={styles.card}><h2>Un peu plus de sécurité</h2><p className={styles.muted}>Demandez au navigateur de protéger le stockage local contre l’effacement automatique. Cela ne remplace pas un export.</p><button className={styles.secondary} onClick={() => void protect()}>Protéger le stockage local</button>{durability && <p role="status">{durability}</p>}</section>
    <section className={styles.card}><h2>Sur votre écran d’accueil</h2><p>Sur Android, ouvrez ce site en HTTPS dans Chrome, puis choisissez « Installer l’application » ou « Ajouter à l’écran d’accueil » dans le menu ⋮.</p><p className={styles.muted}>Après le premier chargement et la mise en cache, le carnet fonctionne sans réseau. Les mises à jour proposées attendent la fin du match. Aucun rechargement automatique n’est déclenché pendant un match actif.</p></section>
    {pending && <Confirm title="Remplacer le carnet de ce téléphone ?" confirmLabel="Remplacer toutes les données" busy={busy} error={error} onCancel={() => setPending(null)} onConfirm={async () => {
      if (await commit(() => pending, 'Sauvegarde restaurée.')) setPending(null)
    }}><p>Le fichier contient {pending.almRoster.length} joueurs ALM et {pending.matches.length} match{pending.matches.length > 1 ? 's' : ''}.</p><p>Toutes les données actuelles, y compris l’effectif ALM, les réglages et un éventuel match actif, seront remplacées. Exportez d’abord votre carnet si vous souhaitez le conserver.</p></Confirm>}
  </>
}
