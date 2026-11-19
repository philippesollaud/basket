import { expect, test } from '@playwright/test'

test('prépare une rencontre et conserve le match actif après rechargement', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Préparer le match' })).toBeVisible()

  await page.getByLabel('Équipe adverse').fill('Les Panthères')
  for (let index = 0; index < 10; index += 1) {
    await page.getByRole('checkbox').nth(index).check()
  }
  await page.getByRole('button', { name: 'Démarrer le match' }).click()

  await expect(page.getByRole('heading', { name: /ALM vs Les Panthères/ })).toBeVisible()
  await page.reload()
  await expect(page.getByText('Match en cours')).toBeVisible()
  await expect(page.getByText('Période 1 / 8')).toBeVisible()

  await page.waitForFunction(() => Boolean(navigator.serviceWorker?.controller))
  await page.context().setOffline(true)
  await page.reload()
  await expect(page.getByText('Match en cours')).toBeVisible()
})

test('enregistre un panier ALM après sélection du joueur et clôture une période', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('Équipe adverse').fill('Les Panthères')
  for (let index = 0; index < 10; index += 1) {
    await page.getByRole('checkbox').nth(index).check()
  }
  await page.getByRole('button', { name: 'Démarrer le match' }).click()

  await page.getByText('ALM · choisir un joueur').locator('..').getByRole('button').first().click()
  await page.getByRole('dialog').getByRole('button').nth(1).click()
  await expect(page.getByTestId('period-score').locator('strong').first()).toHaveText('1')

  page.on('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: 'Clôturer la période' }).click()
  await expect(page.getByText('Période 2 / 8')).toBeVisible()
  await expect(page.getByTestId('period-score').locator('strong').first()).toHaveText('0')
})
