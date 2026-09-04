import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const publicPaths = ['/', '/directory', '/marketplace', '/exchange', '/search', '/about', '/pricing', '/economics', '/terms', '/privacy'];
const expectedLaunchPhase = process.env.PLAYWRIGHT_EXPECT_LAUNCH_PHASE ?? 'discovery';

test('public pages render and local navigation is not broken', async ({ page, request }, testInfo) => {
  const localHrefs = new Set<string>();
  await page.route('**/*', async (route) => {
    if (route.request().resourceType() === 'document') await route.continue();
    else await route.abort();
  });

  for (const path of publicPaths) {
    const response = await page.goto(path);
    expect(response?.status()).toBeLessThan(400);
    await expect(page.locator('main')).toBeVisible();
    const hrefs = await page.locator('a[href^="/"]').evaluateAll((links) => [...new Set(links.map((link) => link.getAttribute('href')).filter(Boolean))] as string[]);
    for (const href of hrefs) localHrefs.add(href);
  }

  if (testInfo.project.name === 'desktop-1440') {
    for (const href of localHrefs) expect((await request.get(href)).status(), href).toBeLessThan(400);
  }
});

test('primary navigation matches the responsive breakpoint', async ({ page }) => {
  await page.goto('/');
  const menuButton = page.locator('.nav-toggle');
  const navigation = page.locator('#primary-navigation');
  const viewport = page.viewportSize();

  if (viewport && viewport.width <= 768) {
    await expect(menuButton).toBeVisible();
    await expect(menuButton).toHaveAttribute('aria-expanded', 'false');
    await expect(navigation).toBeHidden();
    await menuButton.click();
    await expect(menuButton).toHaveAttribute('aria-expanded', 'true');
    await expect(navigation).toBeVisible();
    return;
  }

  await expect(menuButton).toBeHidden();
  await expect(navigation).toBeVisible();
});

test('home has no serious accessibility violations', async ({ page }) => {
  await page.goto('/');
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(results.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact ?? ''))).toEqual([]);
});

test('launch phase matches the expected public commerce boundary', async ({ page, request }) => {
  const healthResponse = await request.get('/health');
  expect(healthResponse.status()).toBe(200);
  const health = await healthResponse.json() as { launchPhase: string; commerceEnabled: boolean };
  expect(health.launchPhase).toBe(expectedLaunchPhase);

  await page.goto('/');
  if (expectedLaunchPhase === 'discovery') {
    expect(health.commerceEnabled).toBe(false);
    await expect(page.locator('a[href="/cart"]')).toHaveCount(0);
    expect((await request.get('/cart')).status()).toBe(404);
    await page.goto('/marketplace');
    await expect(page.locator('.launch-notice')).toContainText('Seedexchange does not take payment in this phase.');
  }
});
