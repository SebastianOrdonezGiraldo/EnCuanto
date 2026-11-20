import { expect, test, type Page } from '@playwright/test';

/** Datos del seed sintético (`pnpm db:seed`): 3 tiendas ficticias y ~2.400 ofertas. */

const prices = async (page: Page) =>
  await page
    .getByTestId('result-price')
    .evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-price'))));

test('buscar desde la portada muestra fichas agrupadas con su mejor precio', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('searchbox', { name: '¿Qué quieres comprar?' }).fill('nevera no frost');
  await page.getByRole('button', { name: 'Buscar' }).click();

  await expect(page).toHaveURL(/\/buscar\?q=nevera\+no\+frost$/);
  await expect(
    page.getByRole('heading', { name: 'Resultados para «nevera no frost»' }),
  ).toBeVisible();
  const first = page.getByTestId('result').first();
  await expect(first.getByTestId('result-name')).toHaveText(/^Nevera /);
  await expect(first).toContainText(/Desde \$\s?[\d.]+/);
  await expect(first).toContainText(/en \d+ tiendas?/);
  await expect(first).toContainText('Precio verificado');
  await expect(first.getByRole('link', { name: /^Ver en / })).toHaveAttribute(
    'href',
    /^\/go\/[0-9a-f-]{36}$/,
  );
});

test('una consulta sin sentido muestra el estado vacío, sin rellenar', async ({ page }) => {
  await page.goto('/buscar?q=xqzw+kjhv');
  await expect(page.getByTestId('empty')).toContainText(
    'No encontramos productos para «xqzw kjhv»',
  );
  await expect(page.getByTestId('result')).toHaveCount(0);
});

test('filtros, orden y página quedan en la URL y el botón Atrás funciona', async ({ page }) => {
  await page.goto('/buscar?q=celular');
  const totalSinFiltro = await page.getByTestId('total').textContent();

  // Filtro de tienda.
  await page.getByRole('checkbox', { name: /Tienda Aurora/ }).check();
  await page.getByRole('button', { name: 'Aplicar filtros' }).click();
  await expect(page).toHaveURL(/merchants=tienda-aurora/);
  await expect(page.getByTestId('total')).not.toHaveText(totalSinFiltro!);
  for (const merchant of await page.getByTestId('result-merchant').allTextContents()) {
    expect(merchant).toMatch(/^Tienda Aurora/);
  }

  // Orden por menor precio (enlace con el estado actual).
  await page.getByRole('link', { name: 'Menor precio' }).click();
  await expect(page).toHaveURL(
    /merchants=tienda-aurora.*sort=price_asc|sort=price_asc.*merchants=tienda-aurora/,
  );
  const list = await prices(page);
  expect(list.length).toBeGreaterThan(1);
  expect(list).toEqual([...list].sort((a, b) => a - b));

  // Segunda página.
  await page.getByRole('link', { name: 'Siguiente' }).click();
  await expect(page).toHaveURL(/page=2/);
  await expect(page.getByText(/^Página 2 de \d+$/)).toBeVisible();
  expect((await prices(page))[0]).toBeGreaterThanOrEqual(list.at(-1)!);

  // Atrás: vuelve a la página 1 con el mismo orden y filtro.
  await page.goBack();
  await expect(page).not.toHaveURL(/page=2/);
  await expect(page.getByRole('checkbox', { name: /Tienda Aurora/ })).toBeChecked();
  expect(await prices(page)).toEqual(list);
});

test('rango de precio aplicado desde el formulario', async ({ page }) => {
  await page.goto('/buscar?q=licuadora');
  await page.getByLabel('Hasta').fill('400000');
  await page.getByRole('button', { name: 'Aplicar filtros' }).click();
  await expect(page).toHaveURL(/max_price=400000/);
  for (const p of await prices(page)) expect(p).toBeLessThanOrEqual(400_000);
});

test('una URL compartida reproduce la misma búsqueda', async ({ page, context }) => {
  await page.goto('/buscar?q=televisor&brands=Kalora&sort=price_desc');
  const names = await page.getByTestId('result-name').allTextContents();
  expect(names.length).toBeGreaterThan(0);
  for (const n of names) expect(n).toContain('Kalora');
  const other = await context.newPage();
  await other.goto(page.url());
  expect(await other.getByTestId('result-name').allTextContents()).toEqual(names);
});

test('/go redirige a la tienda con 302', async ({ page, request }) => {
  await page.goto('/buscar?q=tablet');
  const href = await page
    .getByRole('link', { name: /^Ver en / })
    .first()
    .getAttribute('href');
  const res = await request.get(href!, { maxRedirects: 0 });
  expect(res.status()).toBe(302);
  expect(res.headers().location).toMatch(/^https:\/\/[a-z-]+\.example\/p\//);

  const missing = await request.get('/go/00000000-0000-4000-8000-000000000000', {
    maxRedirects: 0,
  });
  expect(missing.status()).toBe(303);
  expect(missing.headers().location).toContain('/oferta-no-disponible');
});

test('categoría y tienda se renderizan en el servidor y aparecen en el sitemap', async ({
  page,
  request,
}) => {
  await page.goto('/categoria/portatiles');
  await expect(page.getByRole('heading', { name: 'Portátiles', level: 1 })).toBeVisible();
  await expect(page.getByTestId('result').first()).toBeVisible();

  await page.goto('/tienda/tienda-aurora');
  await expect(page.getByRole('heading', { name: /Tienda Aurora/, level: 1 })).toBeVisible();
  for (const merchant of await page.getByTestId('result-merchant').allTextContents()) {
    expect(merchant).toMatch(/^Tienda Aurora/);
  }

  const sitemap = await (await request.get('/sitemap.xml')).text();
  expect(sitemap).toContain('/categoria/portatiles</loc>');
  expect(sitemap).toContain('/categoria/audifonos</loc>');
  expect(sitemap).toContain('/tienda/tienda-aurora</loc>');

  expect((await request.get('/categoria/no-existe')).status()).toBe(404);
});
