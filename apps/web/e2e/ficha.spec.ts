import { expect, test } from '@playwright/test';

/** Ficha de producto (H3) con los datos del seed sintético (`pnpm db:seed`). */

test('desde un resultado se llega a la ficha con sus versiones y ofertas', async ({ page }) => {
  await page.goto('/buscar?q=celular&sort=price_asc');
  const first = page.getByTestId('result').first();
  const name = (await first.getByTestId('result-name').textContent())!.trim();
  const minPrice = await first.getByTestId('result-price').getAttribute('data-price');
  await first.getByTestId('result-link').click();

  await expect(page).toHaveURL(/\/producto\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId('product-name')).toHaveText(name);
  await expect(page.getByTestId('product-min-price')).toContainText(/Desde \$\s?[\d.]+/);
  const offers = page.getByTestId('offer');
  await expect(offers.first()).toBeVisible();
  await expect(offers.first()).toContainText('Precio verificado');
  await expect(offers.first().getByRole('link', { name: /^Ir a / })).toHaveAttribute(
    'href',
    /^\/go\/[0-9a-f-]{36}$/,
  );
  // El precio de la ficha es el del resultado del listado.
  const shown = await page
    .getByTestId('offer-price')
    .evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-price'))));
  expect(Math.min(...shown)).toBeGreaterThanOrEqual(Number(minPrice));
});

test('el selector de versión cambia las ofertas y queda en la URL', async ({ page }) => {
  // Un celular del seed con varias capacidades.
  await page.goto('/buscar?q=celular');
  const cards = page.getByTestId('result').filter({ hasText: 'versiones' });
  await cards.first().getByTestId('result-link').click();
  const variants = page.getByTestId('variant');
  expect(await variants.count()).toBeGreaterThan(1);
  await expect(variants.first()).toHaveAttribute('aria-current', 'true');

  const second = variants.nth(1);
  const label = (await second.locator('span').first().textContent())!;
  await second.click();
  await expect(page).toHaveURL(/\?variante=[0-9a-f-]{36}$/);
  await expect(page.getByTestId('variant').nth(1)).toHaveAttribute('aria-current', 'true');
  await expect(page.getByTestId('variant-heading')).toContainText(label);
});

test('una ficha que no existe responde 404', async ({ page }) => {
  const res = await page.goto('/producto/00000000-0000-4000-8000-000000000000');
  expect(res?.status()).toBe(404);
  await expect(page.getByRole('heading', { name: 'Esta página no existe' })).toBeVisible();
});
