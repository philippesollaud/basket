import { expect, test, type Page } from '@playwright/test'

const players = ['Guillaume', 'Jawed', 'Alexandre', 'Alexis', 'Antonin', 'Rafael', 'Liam', 'Paul', 'Nail', 'Medhi']

async function prepareMatch(page: Page, almSide = 'home') {
  await page.goto('/')
  await page.getByLabel('Nom de l’équipe adverse', { exact: true }).fill('Lions')
  await page.getByRole('combobox', { name: 'ALM joue', exact: true }).selectOption(almSide)
  for (const [index, player] of players.entries()) {
    await page.getByRole('checkbox', { name: player, exact: true }).check()
    await page.getByLabel(`Numéro de ${player}`, { exact: true }).fill(String(index + 4))
  }
  await expect(page.getByRole('checkbox', { name: 'Oscar', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: /C’est parti/ }).click()
  await expect(page.getByRole('region', { name: 'Tableau des scores' })).toBeVisible()
}

async function recordAlm(page: Page, kind: 'two' | 'foul') {
  await page.getByRole('button', { name: kind === 'two' ? '2 points pour ALM' : 'Faute pour ALM', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('button', { name: /^Numéro/ })).toHaveCount(10)
  await dialog.getByRole('button', { name: 'Numéro 4, Guillaume', exact: true }).click()
  await expect(dialog).not.toBeVisible()
}

test('match hors ligne, reprise, huit périodes et historique', async ({ page, context }) => {
  await prepareMatch(page)
  await expect(page.getByRole('button', { name: 'Faute pour ALM', exact: true })).toHaveCount(0)
  await expect(page.getByRole('combobox')).toHaveCount(0)
  await page.getByRole('button', { name: '2 points pour ALM', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Annuler', exact: true }).click()
  await expect(page.getByLabel('ALM : 0 points de paniers', { exact: true })).toBeVisible()
  await recordAlm(page, 'two')
  await expect(page.getByLabel('ALM : 2 points de paniers', { exact: true })).toBeVisible()
  await page.getByRole('checkbox', { name: 'Activer le suivi des fautes', exact: true }).click()
  await expect(page.getByRole('checkbox', { name: 'Activer le suivi des fautes', exact: true })).toBeChecked()
  await recordAlm(page, 'foul')
  await page.getByText('La feuille des joueurs · points et fautes cumulés', { exact: true }).click()
  await expect(page.getByRole('table', { name: 'Statistiques ALM' }).getByRole('row', { name: '#4 Guillaume 2 1', exact: true })).toBeVisible()
  await page.getByRole('button', { name: /Annuler la dernière action/ }).click()
  await expect(page.getByRole('table', { name: 'Statistiques ALM' }).getByRole('row', { name: '#4 Guillaume 2 0', exact: true })).toBeVisible()
  await recordAlm(page, 'foul')
  await page.getByRole('checkbox', { name: 'Activer le suivi des fautes', exact: true }).click()
  await expect(page.getByRole('checkbox', { name: 'Activer le suivi des fautes', exact: true })).not.toBeChecked()
  await expect(page.getByRole('button', { name: 'Faute pour ALM', exact: true })).toHaveCount(0)
  await expect(page.getByRole('columnheader', { name: 'Fautes', exact: true })).toHaveCount(0)
  await page.evaluate(async () => { await navigator.serviceWorker.ready })
  await page.reload()
  await expect(page.getByLabel('ALM : 2 points de paniers', { exact: true })).toBeVisible()
  await expect(page.getByRole('checkbox', { name: 'Activer le suivi des fautes', exact: true })).not.toBeChecked()
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true)
  await context.setOffline(true)
  await page.reload()
  await expect(page.getByLabel('ALM : 2 points de paniers', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '1 point pour Lions', exact: true }).click()
  await expect(page.getByLabel('Lions : 1 points de paniers', { exact: true })).toBeVisible()
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await page.reload()
  await expect(page.getByLabel('Lions : 1 points de paniers', { exact: true })).toBeVisible()
  await context.setOffline(false)
  for (let period = 1; period <= 8; period++) {
    await page.getByRole('button', { name: period === 8 ? /Terminer le match/ : /Terminer la période/ }).click()
    await page.getByRole('button', { name: period === 8 ? 'Confirmer la fin du match' : 'Confirmer la fin de période', exact: true }).click()
    await expect(page.getByRole('dialog')).not.toBeVisible()
    if (period < 8) {
      await expect(page.getByRole('button', { name: /Annuler la dernière action/ })).toBeDisabled()
      await expect(page.getByLabel('ALM : 0 points de paniers', { exact: true })).toBeVisible()
    }
  }
  await page.getByRole('button', { name: /Historique/ }).click()
  await expect(page.getByText('Victoire ALM · points de match', { exact: true })).toBeVisible()
  await page.getByText('Voir la feuille de match', { exact: true }).click()
  await expect(page.getByRole('table', { name: 'Résultats des périodes terminées' }).getByRole('row')).toHaveCount(10)
  await expect(page.getByRole('cell', { name: '17 – 15', exact: true })).toBeVisible()
  await page.getByText('La feuille des joueurs · points cumulés', { exact: true }).click()
  await expect(page.getByRole('table', { name: 'Statistiques ALM' }).getByRole('row', { name: '#4 Guillaume 2', exact: true })).toBeVisible()
  await expect(page.getByRole('table', { name: 'Statistiques Lions' })).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('export téléchargeable, import confirmé et rejet d’un fichier incohérent', async ({ page }) => {
  await prepareMatch(page)
  await recordAlm(page, 'two')
  await page.getByRole('button', { name: /Sauvegardes/ }).click()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Exporter mes données', exact: true }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(/^basket-u11-\d{4}-\d{2}-\d{2}\.json$/)
  expect(await download.failure()).toBeNull()
  const file = await download.path()
  if (!file) throw new Error('Le téléchargement n’a pas produit de fichier.')
  await page.getByLabel('Fichier de sauvegarde (10 Mo max.)').setInputFiles(file)
  await expect(page.getByRole('dialog')).toContainText('14 joueurs ALM et 1 match')
  await page.getByRole('button', { name: 'Revenir', exact: true }).click()
  await page.getByLabel('Fichier de sauvegarde (10 Mo max.)').setInputFiles(file)
  await page.getByRole('button', { name: 'Remplacer toutes les données', exact: true }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await page.getByLabel('Fichier de sauvegarde (10 Mo max.)').setInputFiles({
    name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{"version":99}'),
  })
  await expect(page.getByRole('alert')).toContainText('Sauvegarde incompatible')
  await page.getByRole('button', { name: /Match en cours/ }).click()
  await expect(page.getByLabel('ALM : 2 points de paniers', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '2 points pour ALM', exact: true }).click()
  await expect(page.getByRole('dialog').getByRole('button', { name: /^Numéro/ })).toHaveCount(10)
})

test('ALM à l’extérieur : points puis numéro, adversaire direct et effectif inchangé', async ({ page }) => {
  await prepareMatch(page, 'away')
  await recordAlm(page, 'two')
  await page.getByRole('button', { name: '2 points pour Lions', exact: true }).click()
  await expect(page.getByLabel('Lions : 2 points de paniers', { exact: true })).toBeVisible()
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await page.getByRole('button', { name: /Annuler la dernière action/ }).click()
  await expect(page.getByLabel('Lions : 0 points de paniers', { exact: true })).toBeVisible()
  await expect(page.getByLabel('ALM : 2 points de paniers', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: /Effectif ALM/ }).click()
  await expect(page.getByText('Effectif permanent ALM', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Modifier l’effectif', exact: true }).click()
  await expect(page.getByRole('textbox')).toHaveCount(14)
  await page.getByLabel('Joueur 1', { exact: true }).fill('Nouveau prénom')
  await page.getByRole('button', { name: 'Enregistrer l’effectif', exact: true }).click()
  await expect(page.getByText('Nouveau prénom', { exact: true })).toBeVisible()
  await page.reload()
  await page.getByRole('button', { name: '2 points pour ALM', exact: true }).click()
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Numéro 4, Guillaume', exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('aucune requête tierce ni erreur JavaScript au chargement', async ({ page }) => {
  const failures: string[] = []
  page.on('pageerror', (error) => failures.push(error.message))
  const thirdParties: string[] = []
  page.on('request', (request) => {
    if (!request.url().startsWith('http://127.0.0.1:4174/') && !request.url().startsWith('blob:')) thirdParties.push(request.url())
  })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Place au match.' })).toBeVisible()
  await page.evaluate(async () => { await navigator.serviceWorker.ready })
  expect(failures).toEqual([])
  expect(thirdParties).toEqual([])
  const manifest = await page.request.get('/manifest.webmanifest')
  const content = await manifest.json()
  expect(content.display).toBe('standalone')
  for (const icon of content.icons) {
    expect((await page.request.get(`/${icon.src}`)).status()).toBe(200)
  }
})
