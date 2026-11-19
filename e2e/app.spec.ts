import { expect, test } from '@playwright/test';

test('records a match, reloads it and retains an eight-period history offline', async ({ page, context }) => {
  await page.goto('/');
  await expect(page.getByText('Jour de match')).toBeVisible();
  await page.getByLabel('ÉQUIPE ADVERSE').fill('Lions');
  await page.getByRole('button', { name: /À l’extérieur/ }).click();
  for (let i = 1; i <= 10; i++) {
    await page.getByRole('checkbox', { name: `Joueur ${i}`, exact: true }).check();
    await expect(page.getByLabel(`Numéro de Joueur ${i}`, { exact: true })).toHaveValue(String(i + 3));
  }
  await page.getByLabel('Numéro de Joueur 1', { exact: true }).fill('24');
  await page.getByRole('button', { name: /Démarrer le match/ }).click();
  await expect(page.getByText('Sur le terrain')).toBeVisible();
  await expect(page.getByRole('group', { name: 'Score de la période' })).toContainText('Lions');
  await expect(page.getByRole('group', { name: 'Actions Lions' })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Actions ALM' })).toBeVisible();
  const controlBounds = await page.getByRole('group', { name: 'Contrôles du match' }).evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return { top: bounds.top, bottom: bounds.bottom };
  });
  const headerBottom = (await page.getByRole('banner').boundingBox())!.y + (await page.getByRole('banner').boundingBox())!.height;
  const navTop = (await page.getByRole('navigation', { name: 'Navigation principale' }).boundingBox())!.y;
  expect(controlBounds.top).toBeGreaterThanOrEqual(headerBottom);
  expect(controlBounds.bottom).toBeLessThanOrEqual(navTop);
  await page.getByRole('group', { name: 'Actions ALM' }).getByRole('button', { name: '+2 points' }).click();
  const playerButtons = page.getByRole('dialog').getByRole('button', { name: /^Numéro / });
  await expect(playerButtons).toHaveCount(10);
  const tiles = await playerButtons.evaluateAll((elements) => elements.map((element) => {
    const { y, width, height } = element.getBoundingClientRect();
    return { label: element.getAttribute('aria-label'), y, width, height };
  }));
  expect(tiles.map(({ label }) => Number(label?.match(/^Numéro (\d+)/)?.[1]))).toEqual([5, 6, 7, 8, 9, 10, 11, 12, 13, 24]);
  const rows = [...new Set(tiles.map(({ y }) => y))];
  expect(rows.map((y) => tiles.filter((tile) => tile.y === y).length)).toEqual([3, 3, 3, 1]);
  for (const { width, height } of tiles) expect(Math.abs(width - height)).toBeLessThan(1);
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Annuler' })).toHaveCount(0);
  await page.getByRole('dialog').getByRole('button', { name: /Joueur 1$/ }).click();
  await expect(page.getByText('Joueur 1 · +2 points')).toBeVisible();
  await page.reload();
  await expect(page.getByText('Joueur 1 · +2 points')).toBeVisible();
  for (let i = 1; i <= 8; i++) {
    if (i === 8) await page.getByRole('group', { name: 'Actions Lions' }).getByRole('button', { name: '+2 points' }).click();
    page.once('dialog', (dialog) => void dialog.accept());
    await page.getByRole('button', { name: /Clôturer la période/ }).click();
    if (i < 8) await expect(page.getByRole('group', { name: 'Résultat des périodes' }).getByRole('img', { name: `Période ${i + 1} à jouer` })).toBeVisible();
  }
  const finish = page.getByRole('button', { name: /Clôturer le match/ });
  await expect(finish).toBeVisible();
  await expect(page.getByRole('img', { name: 'Période 8 perdue' })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Score de la période' })).toContainText('Lions2');
  await expect(page.getByRole('group', { name: 'Actions Lions' })).toHaveCount(0);
  await page.reload();
  await expect(finish).toBeVisible();
  page.once('dialog', (dialog) => void dialog.dismiss());
  await finish.click();
  await expect(finish).toBeVisible();
  await page.getByRole('button', { name: 'Historique' }).click();
  await expect(page.getByText('ALM vs Lions')).toHaveCount(0);
  await page.getByRole('button', { name: 'Terrain' }).click();
  page.once('dialog', (dialog) => void dialog.accept());
  await finish.click();
  await expect(page.getByText('Jour de match')).toBeVisible();
  await page.getByRole('button', { name: 'Historique' }).click();
  await page.getByText('ALM vs Lions').click();
  await expect(page.getByText('Période 8')).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByText('Jour de match')).toBeVisible();
  await page.getByRole('button', { name: 'Historique' }).click();
  await expect(page.getByText('ALM vs Lions')).toBeVisible();
  await context.setOffline(false);
});

test('rejects invalid imports and restores a validated backup only after confirmation', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Jour de match')).toBeVisible();
  const notebook = await page.evaluate(async () => {
    const request = indexedDB.open('basket-u11');
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const get = db.transaction('state').objectStore('state').get('main');
    return await new Promise<unknown>((resolve, reject) => {
      get.onsuccess = () => resolve(get.result.data);
      get.onerror = () => reject(get.error);
    });
  });
  await page.getByRole('button', { name: 'Effectif' }).click();
  await page.getByLabel('Prénom du joueur 1', { exact: true }).fill('Camille');
  await page.getByLabel('Numéro préféré du joueur 1', { exact: true }).fill('12');
  await page.getByRole('button', { name: /Enregistrer l’effectif/ }).click();
  await page.getByRole('button', { name: 'Sauvegardes' }).click();
  const input = page.locator('input[type=file]');
  await input.setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"version":2,"notebook":{}}') });
  await expect(page.getByRole('alert')).toContainText('Fichier invalide');
  const backup = { name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ version: 2, notebook })) };
  page.once('dialog', (dialog) => void dialog.dismiss());
  await input.setInputFiles(backup);
  await page.getByRole('button', { name: 'Effectif' }).click();
  await expect(page.getByLabel('Prénom du joueur 1', { exact: true })).toHaveValue('Camille');
  await expect(page.getByLabel('Numéro préféré du joueur 1', { exact: true })).toHaveValue('12');
  await page.getByRole('button', { name: 'Sauvegardes' }).click();
  page.once('dialog', (dialog) => void dialog.accept());
  await input.setInputFiles(backup);
  await page.getByRole('button', { name: 'Effectif' }).click();
  await expect(page.getByLabel('Prénom du joueur 1', { exact: true })).toHaveValue('Joueur 1');
  await expect(page.getByLabel('Numéro préféré du joueur 1', { exact: true })).toHaveValue('');
});
