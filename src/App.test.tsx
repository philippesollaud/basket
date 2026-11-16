import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'
import { database } from './storage'
import { emptyData, finishPeriod } from './domain'
import { withAlmMatch } from './test/fixtures'

const pwa = vi.hoisted(() => ({ needRefresh: false, update: vi.fn() }))
vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({ needRefresh: [pwa.needRefresh], offlineReady: [true], updateServiceWorker: pwa.update }),
}))

beforeEach(async () => {
  await database.delete()
  await database.open()
  pwa.needRefresh = false
  pwa.update.mockReset()
})

async function seed() {
  await database.commit(0, () => withAlmMatch())
}

async function scoreAlm(user: ReturnType<typeof userEvent.setup>, points = 2) {
  await user.click(await screen.findByRole('button', { name: `${points} point${points > 1 ? 's' : ''} pour ALM` }))
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Numéro 4, Guillaume' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
}

describe('parcours ALM', () => {
  it('préconfigure les 14 noms sans numéro fixe et permet de modifier l’effectif', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: /Effectif ALM/ }))
    for (const player of emptyData().almRoster) expect(screen.getByText(player.name, { exact: true })).toBeVisible()
    expect(screen.queryByLabelText(/Numéro/)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Modifier l’effectif' }))
    await user.clear(screen.getByLabelText('Joueur 1', { exact: true }))
    await user.type(screen.getByLabelText('Joueur 1', { exact: true }), 'Nom modifié')
    await user.click(screen.getByRole('button', { name: 'Enregistrer l’effectif' }))
    expect(await screen.findByText('Nom modifié')).toBeVisible()
    expect((await database.read()).data.almRoster[0].name).toBe('Nom modifié')
    await user.click(screen.getByRole('button', { name: 'Terrain' }))
    expect(screen.getByRole('checkbox', { name: 'Nom modifié' })).toBeVisible()
  })

  it('sélectionne exactement dix joueurs et attribue leurs numéros pour ce match', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.type(await screen.findByLabelText('Nom de l’équipe adverse'), 'Les Lions')
    await user.selectOptions(screen.getByLabelText('ALM joue'), 'away')
    const start = screen.getByRole('button', { name: /C’est parti/ })
    expect(start).toBeDisabled()
    for (const [index, player] of emptyData().almRoster.slice(0, 10).entries()) {
      await user.click(screen.getByRole('checkbox', { name: player.name }))
      await user.type(screen.getByLabelText(`Numéro de ${player.name}`), String(index + 4))
      if (index < 9) expect(start).toBeDisabled()
    }
    expect(screen.getByRole('checkbox', { name: 'Oscar' })).toBeDisabled()
    expect(start).toBeEnabled()
    await user.click(start)
    expect(await screen.findByRole('region', { name: 'Tableau des scores' })).toBeVisible()
    const data = (await database.read()).data
    expect(data.matches[0].away.name).toBe('ALM')
    expect(data.matches[0].away.players).toHaveLength(10)
    expect(data.matches[0].home.players).toHaveLength(0)
    expect(data.almRoster.every((player) => !('number' in player))).toBe(true)
  })

  it('signale les numéros dupliqués avant de démarrer', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.type(await screen.findByLabelText('Nom de l’équipe adverse'), 'Les Lions')
    for (const player of emptyData().almRoster.slice(0, 10)) {
      await user.click(screen.getByRole('checkbox', { name: player.name }))
      await user.type(screen.getByLabelText(`Numéro de ${player.name}`), '7')
    }
    await user.click(screen.getByRole('button', { name: /C’est parti/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('numéro différent')
    expect((await database.read()).data.matches).toHaveLength(0)
  })

  it('demande le numéro après les points, sans enregistrer une sélection annulée', async () => {
    await seed()
    const user = userEvent.setup()
    render(<App />)
    expect(await screen.findByRole('button', { name: '2 points pour ALM' })).toBeEnabled()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Faute pour/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '2 points pour ALM' }))
    const dialog = screen.getByRole('dialog', { name: '+2 points ALM : quel numéro ?' })
    expect(within(dialog).getAllByRole('button', { name: /^Numéro/ })).toHaveLength(10)
    expect(screen.getByLabelText('ALM : 0 points de paniers')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Annuler' }))
    expect((await database.read()).data.matches[0].periods[0]).toHaveLength(0)
    await scoreAlm(user)
    expect(screen.getByLabelText('ALM : 2 points de paniers')).toBeVisible()
    await user.click(screen.getByText('La feuille des joueurs · points cumulés'))
    const stats = screen.getByRole('table', { name: 'Statistiques ALM' })
    expect(within(stats).getByRole('row', { name: '#4 Guillaume 2' })).toBeVisible()
    expect(within(stats).queryByRole('columnheader', { name: 'Fautes' })).not.toBeInTheDocument()
  })

  it('enregistre et annule le score adverse sans jamais demander de joueur', async () => {
    await seed()
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: '2 points pour Les Lions' }))
    expect(await screen.findByLabelText('Les Lions : 2 points de paniers')).toBeVisible()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect((await database.read()).data.matches[0].periods[0][0].playerId).toBeNull()
    expect(screen.getByText('Dernière : Les Lions, +2')).toBeVisible()
    await user.click(screen.getByRole('button', { name: /Annuler la dernière action/ }))
    expect(await screen.findByLabelText('Les Lions : 0 points de paniers')).toBeVisible()
  })

  it('redemande un numéro pour chaque panier à un ou deux points', async () => {
    await seed()
    const user = userEvent.setup()
    render(<App />)
    await scoreAlm(user, 1)
    await user.click(screen.getByRole('button', { name: '2 points pour ALM' }))
    const dialog = screen.getByRole('dialog', { name: '+2 points ALM : quel numéro ?' })
    expect(screen.getByLabelText('ALM : 1 points de paniers')).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: /Oscar/ })).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Numéro 5, Jawed' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByLabelText('ALM : 3 points de paniers')).toBeVisible()
    const data = (await database.read()).data
    expect(data.matches[0].periods[0].map((event) => [event.playerId, event.kind])).toEqual([
      [data.almRoster[0].id, 'one'], [data.almRoster[1].id, 'two'],
    ])
  })

  it('active les fautes à la demande puis les masque sans perdre les comptes', async () => {
    await seed()
    const user = userEvent.setup()
    const app = render(<App />)
    const toggle = await screen.findByRole('checkbox', { name: 'Activer le suivi des fautes' })
    expect(toggle).not.toBeChecked()
    await user.click(toggle)
    await user.click(await screen.findByRole('button', { name: 'Faute pour ALM' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Numéro 4, Guillaume' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'Faute pour Les Lions' })).not.toBeInTheDocument()
    await user.click(screen.getByText('La feuille des joueurs · points et fautes cumulés'))
    expect(within(screen.getByRole('table', { name: 'Statistiques ALM' })).getByRole('row', { name: '#4 Guillaume 0 1' })).toBeVisible()
    await user.click(toggle)
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Faute pour ALM' })).not.toBeInTheDocument())
    expect((await database.read()).data.matches[0].periods[0][0].kind).toBe('foul')
    app.unmount()
    render(<App />)
    expect(await screen.findByRole('checkbox', { name: 'Activer le suivi des fautes' })).not.toBeChecked()
    await user.click(screen.getByRole('checkbox', { name: 'Activer le suivi des fautes' }))
    await user.click(await screen.findByText('La feuille des joueurs · points et fautes cumulés'))
    expect(within(screen.getByRole('table', { name: 'Statistiques ALM' })).getByRole('row', { name: '#4 Guillaume 0 1' })).toBeVisible()
  })

  it('confirme la clôture, remet le score à zéro et interdit l’annulation de la période précédente', async () => {
    await seed()
    const user = userEvent.setup()
    render(<App />)
    await scoreAlm(user)
    await user.click(screen.getByRole('button', { name: /Terminer la période/ }))
    expect(within(screen.getByRole('dialog')).getByText(/Cette clôture est définitive/)).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Revenir' }))
    expect((await database.read()).data.matches[0].periods).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: /Terminer la période/ }))
    await user.click(screen.getByRole('button', { name: 'Confirmer la fin de période' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByLabelText('ALM : 0 points de paniers')).toBeVisible()
    expect(screen.getByRole('button', { name: /Annuler la dernière action/ })).toBeDisabled()
    expect((await database.read()).data.matches[0].periods).toHaveLength(2)
  })

  it('retrouve le match après un remontage de l’application', async () => {
    await seed()
    const first = render(<App />)
    await screen.findByRole('region', { name: 'Tableau des scores' })
    first.unmount()
    render(<App />)
    expect(await screen.findByRole('region', { name: 'Tableau des scores' })).toBeVisible()
  })

  it('conserve un match terminé dans l’historique, avec son résultat nul', async () => {
    let data = withAlmMatch()
    const id = data.matches[0].id
    for (let i = 0; i < 8; i++) data = finishPeriod(data, id)
    await database.commit(0, () => data)
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: /Historique/ }))
    expect(await screen.findByText('Match nul · points de match')).toBeVisible()
    await user.click(screen.getByText('Voir la feuille de match'))
    expect(screen.getByText('Total match')).toBeVisible()
  })

  it('diffère la mise à jour pendant un match actif', async () => {
    await seed()
    pwa.needRefresh = true
    render(<App />)
    expect(await screen.findByText(/Elle attendra la fin du match/)).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Mettre à jour' })).not.toBeInTheDocument()
    expect(pwa.update).not.toHaveBeenCalled()
  })

  it('applique une mise à jour demandée lorsqu’aucun match n’est actif', async () => {
    pwa.needRefresh = true
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Mettre à jour' }))
    await waitFor(() => expect(pwa.update).toHaveBeenCalledWith(true))
  })

  it('garde la confirmation ouverte et y signale une erreur de clôture', async () => {
    await seed()
    vi.spyOn(database, 'commit').mockRejectedValueOnce(new Error('Stockage indisponible'))
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: /Terminer la période/ }))
    await user.click(screen.getByRole('button', { name: 'Confirmer la fin de période' }))
    await waitFor(() => expect(within(screen.getByRole('dialog')).getByRole('alert')).toHaveTextContent('Stockage indisponible'))
    expect((await database.read()).data.matches[0].periods).toHaveLength(1)
  })

  it('garde les numéros disponibles pour réessayer après une panne d’enregistrement', async () => {
    await seed()
    vi.spyOn(database, 'commit').mockRejectedValueOnce(new Error('Espace disque insuffisant'))
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: '2 points pour ALM' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Numéro 4, Guillaume' }))
    expect(await within(screen.getByRole('dialog')).findByRole('alert')).toHaveTextContent('Espace disque insuffisant')
    expect(screen.getByLabelText('ALM : 0 points de paniers')).toBeInTheDocument()
    expect((await database.read()).data.matches[0].periods[0]).toHaveLength(0)
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Numéro 4, Guillaume' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByLabelText('ALM : 2 points de paniers')).toBeVisible()
  })
})
