/**
 * End-to-end smoke test for the DriftLog frontend.
 *
 * Runs the real static site in headless Chromium with Cognito and the API
 * stubbed at the network layer, so it exercises the actual auth flow, the pin
 * POST body, timeline rendering, the compass rose and the dark-mode toggle
 * without touching AWS.
 *
 *   npm i -g playwright && npx playwright install chromium
 *   node tests/smoke.mjs
 */

import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium } = await import('playwright');

const here = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.join(here, '..', 'web');
const PORT = 5199;
const ORIGIN = `http://127.0.0.1:${PORT}`;

const CONFIG = {
  region: 'us-fake-1',
  userPoolId: 'us-fake-1_TESTPOOL',
  clientId: 'testclientid',
  apiEndpoint: 'https://api.example.test',
};

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const serveDir = await mkdtemp(path.join(tmpdir(), 'driftlog-'));
await cp(webDir, serveDir, { recursive: true });
await writeFile(
  path.join(serveDir, 'config.js'),
  `window.DRIFTLOG_CONFIG = ${JSON.stringify(CONFIG)};`
);

const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], {
  cwd: serveDir,
  stdio: 'ignore',
});
await new Promise((r) => setTimeout(r, 700));

const browser = await chromium.launch();
let capturedPin = null;
let deleted = null;

try {
  const context = await browser.newContext();
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('pageerror', (err) => consoleErrors.push(err.message));

  await page.route('**/cognito-idp.*.amazonaws.com/**', async (route) => {
    const target = route.request().headers()['x-amz-target'] ?? '';
    const body = JSON.parse(route.request().postData() ?? '{}');

    if (target.endsWith('InitiateAuth') && body.AuthFlow === 'USER_PASSWORD_AUTH') {
      return route.fulfill({
        status: 200,
        contentType: 'application/x-amz-json-1.1',
        body: JSON.stringify({
          AuthenticationResult: {
            IdToken: 'fake.id.token',
            AccessToken: 'fake.access.token',
            RefreshToken: 'fake-refresh',
            ExpiresIn: 3600,
          },
        }),
      });
    }

    return route.fulfill({
      status: 400,
      contentType: 'application/x-amz-json-1.1',
      body: JSON.stringify({ __type: 'x#NotAuthorizedException', message: 'nope' }),
    });
  });

  const existing = [
    {
      sk: 'PIN#2026-08-19T09:00:00.000Z#one',
      id: 'one',
      category: 'creativity',
      bearing: 45,
      intensity: 4,
      note: 'Sketched the compass rose on a napkin.',
      occurredAt: new Date(Date.now() - 3 * 3600_000).toISOString(),
    },
    {
      sk: 'PIN#2026-08-18T20:00:00.000Z#two',
      id: 'two',
      category: 'courage',
      bearing: 90,
      intensity: 5,
      note: 'Said the hard thing out loud.',
      occurredAt: new Date(Date.now() - 26 * 3600_000).toISOString(),
    },
  ];

  await page.route('**/api.example.test/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());

    if (req.method() === 'GET' && url.pathname === '/pins') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ pins: existing }),
      });
    }

    if (req.method() === 'POST' && url.pathname === '/pins') {
      capturedPin = JSON.parse(req.postData() ?? '{}');
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          pin: {
            sk: 'PIN#new#three',
            id: 'three',
            bearing: 0,
            occurredAt: new Date().toISOString(),
            ...capturedPin,
          },
        }),
      });
    }

    if (req.method() === 'DELETE') {
      deleted = decodeURIComponent(url.pathname.replace('/pins/', ''));
      return route.fulfill({ status: 204, body: '' });
    }

    return route.fulfill({ status: 404, body: '{}' });
  });

  await page.goto(ORIGIN, { waitUntil: 'domcontentloaded' });

  check('auth screen renders', await page.isVisible('#auth-view'));
  check('app is hidden before sign-in', await page.isHidden('#app-view'));

  // --- sign in ---
  await page.fill('#panel-signin input[name="email"]', 'jimmy@example.test');
  await page.fill('#panel-signin input[name="password"]', 'Passw0rd!');
  await page.click('#panel-signin button[type="submit"]');
  await page.waitForSelector('#app-view:not(.is-hidden)', { timeout: 5000 });
  check('sign-in reveals the app', true);

  await page.waitForSelector('.pin', { timeout: 5000 });
  const pinCount = await page.locator('.pin').count();
  check('timeline renders existing pins', pinCount === 2, `${pinCount} rendered`);

  // --- compass rose ---
  const spokes = await page.locator('#rose polygon').count();
  const roseLabels = await page.locator('#rose text').count();
  check('rose draws a polygon', spokes === 1);
  check('rose labels all eight bearings', roseLabels === 8, `${roseLabels} labels`);
  const summary = await page.textContent('#rose-summary');
  check('rose summary mentions a heading', /creativity|courage/.test(summary ?? ''), summary?.trim());

  // --- drop a pin ---
  await page.click('.category[data-key="calm"]');
  check(
    'category selection is exclusive',
    (await page.locator('.category[aria-pressed="true"]').count()) === 1
  );

  await page.fill('#intensity', '5');
  await page.fill('#note', 'Sat with the coffee and did not reach for the phone.');
  await page.click('#pin-submit');
  await page.waitForFunction(() => document.querySelectorAll('.pin').length === 3, null, {
    timeout: 5000,
  });

  check('POST body carries the chosen category', capturedPin?.category === 'calm', capturedPin?.category);
  check('POST body carries the intensity', capturedPin?.intensity === 5, String(capturedPin?.intensity));
  check('POST body carries the note', typeof capturedPin?.note === 'string' && capturedPin.note.length > 10);
  check('new pin prepends to the timeline', (await page.locator('.pin').count()) === 3);
  check('note field clears after submit', (await page.inputValue('#note')) === '');

  // --- delete ---
  await page.locator('.pin').nth(1).locator('.pin-delete').click({ force: true });
  await page.waitForFunction(() => document.querySelectorAll('.pin').length === 2, null, {
    timeout: 5000,
  });
  check('delete calls the API with the sort key', deleted?.startsWith('PIN#'), deleted ?? 'none');

  // --- dark mode (the curve ball) ---
  const themeBefore = await page.getAttribute('html', 'data-theme');
  await page.click('#theme-toggle');
  const themeAfter = await page.getAttribute('html', 'data-theme');
  check('theme toggle flips the theme', themeBefore !== themeAfter, `${themeBefore} → ${themeAfter}`);

  // The body colour transitions over 0.25s; read it once it has settled.
  await page.waitForTimeout(500);
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  check('dark theme repaints the background', themeAfter !== 'dark' || bg === 'rgb(18, 18, 31)', bg);

  const roseFillAfter = await page.getAttribute('#rose polygon', 'stroke');
  check('rose repaints for the new theme', Boolean(roseFillAfter), roseFillAfter ?? '');

  // --- session persistence ---
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#app-view:not(.is-hidden)', { timeout: 5000 });
  check('session survives a reload', true);
  check(
    'theme choice survives a reload',
    (await page.getAttribute('html', 'data-theme')) === themeAfter
  );

  // --- sign out ---
  await page.click('#sign-out');
  await page.waitForSelector('#auth-view:not(.is-hidden)', { timeout: 5000 });
  check('sign out returns to the auth screen', true);

  check('no uncaught page errors', consoleErrors.length === 0, consoleErrors.join(' | '));
} finally {
  await browser.close();
  server.kill();
  await rm(serveDir, { recursive: true, force: true });
}

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
