/**
 * DriftLog frontend — vanilla ES2022, zero dependencies, no build step.
 *
 * Auth talks to Cognito's JSON API directly (application/x-amz-json-1.1), which
 * is why there is no SDK bundle here: the whole app is three static files that
 * Terraform uploads to S3.
 */

(() => {
  'use strict';

  const CONFIG = window.DRIFTLOG_CONFIG;

  /** The eight bearings. Must stay in sync with backend/src/index.mjs. */
  const CATEGORIES = [
    { key: 'clarity', bearing: 0, compass: 'N', blurb: 'something got simple' },
    { key: 'creativity', bearing: 45, compass: 'NE', blurb: 'a spark, a making' },
    { key: 'courage', bearing: 90, compass: 'E', blurb: 'you did the scary thing' },
    { key: 'connection', bearing: 135, compass: 'SE', blurb: 'someone reached you' },
    { key: 'calm', bearing: 180, compass: 'S', blurb: 'the noise dropped' },
    { key: 'care', bearing: 225, compass: 'SW', blurb: 'tending, yours or theirs' },
    { key: 'curiosity', bearing: 270, compass: 'W', blurb: 'a pull toward something' },
    { key: 'challenge', bearing: 315, compass: 'NW', blurb: 'friction worth naming' },
  ];

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const STORAGE_KEY = 'driftlog.session.v1';
  const THEME_KEY = 'driftlog.theme.v1';

  const $ = (id) => document.getElementById(id);

  const el = {
    authView: $('auth-view'),
    appView: $('app-view'),
    bootError: $('boot-error'),
    themeToggle: $('theme-toggle'),
    themeIcon: $('theme-icon'),
    themeLabel: $('theme-label'),
    signOut: $('sign-out'),
    tabSignin: $('tab-signin'),
    tabSignup: $('tab-signup'),
    panelSignin: $('panel-signin'),
    panelSignup: $('panel-signup'),
    panelConfirm: $('panel-confirm'),
    confirmEmail: $('confirm-email'),
    resendCode: $('resend-code'),
    authMessage: $('auth-message'),
    categoryGrid: $('category-grid'),
    intensity: $('intensity'),
    intensityOut: $('intensity-out'),
    note: $('note'),
    noteCount: $('note-count'),
    pinForm: $('pin-form'),
    pinSubmit: $('pin-submit'),
    pinMessage: $('pin-message'),
    timeline: $('timeline'),
    timelineEmpty: $('timeline-empty'),
    refresh: $('refresh'),
    rose: $('rose'),
    roseSummary: $('rose-summary'),
  };

  /* ----------------------------- tiny storage ---------------------------- */
  // Private browsing and locked-down browsers throw on localStorage. A failure
  // here should cost you persistence, never the app.

  const store = {
    get(key) {
      try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch {
        /* ignore */
      }
    },
    remove(key) {
      try {
        localStorage.removeItem(key);
      } catch {
        /* ignore */
      }
    },
  };

  /* -------------------------------- theme -------------------------------- */

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    const goingTo = theme === 'dark' ? 'day' : 'night';
    el.themeIcon.textContent = theme === 'dark' ? '☀' : '☾';
    el.themeLabel.textContent = `Switch to ${goingTo}`;
    el.themeToggle.setAttribute('title', `Switch to ${goingTo}`);
    el.themeToggle.setAttribute('aria-label', `Switch to ${goingTo}`);
    if (state.pins) drawRose(state.pins);
  }

  function initTheme() {
    const saved = store.get(THEME_KEY);
    const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
    applyTheme(saved ?? (prefersDark ? 'dark' : 'light'));

    el.themeToggle.addEventListener('click', () => {
      const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      store.set(THEME_KEY, next);
      applyTheme(next);
    });

    // Follow the OS only while the user has never chosen for themselves.
    window
      .matchMedia?.('(prefers-color-scheme: dark)')
      .addEventListener?.('change', (event) => {
        if (store.get(THEME_KEY) === null) applyTheme(event.matches ? 'dark' : 'light');
      });
  }

  /* -------------------------------- cognito ------------------------------ */

  const cognitoUrl = () => `https://cognito-idp.${CONFIG.region}.amazonaws.com/`;

  async function cognito(action, payload) {
    const res = await fetch(cognitoUrl(), {
      method: 'POST',
      headers: {
        'content-type': 'application/x-amz-json-1.1',
        'x-amz-target': `AWSCognitoIdentityProviderService.${action}`,
      },
      body: JSON.stringify(payload),
    });

    const text = await res.text();
    const data = text ? JSON.parse(text) : {};

    if (!res.ok) {
      const type = (data.__type ?? '').split('#').pop();
      const err = new Error(data.message || type || 'Cognito request failed');
      err.code = type;
      throw err;
    }
    return data;
  }

  const state = {
    session: null, // { idToken, refreshToken, expiresAt, email }
    pins: null,
    category: 'courage',
  };

  function saveSession(authResult, email) {
    const session = {
      idToken: authResult.IdToken,
      // A refresh response omits RefreshToken; keep the one we already hold.
      refreshToken: authResult.RefreshToken ?? state.session?.refreshToken ?? null,
      expiresAt: Date.now() + (authResult.ExpiresIn ?? 3600) * 1000,
      email: email ?? state.session?.email ?? null,
    };
    state.session = session;
    store.set(STORAGE_KEY, session);
    return session;
  }

  function clearSession() {
    state.session = null;
    state.pins = null;
    store.remove(STORAGE_KEY);
  }

  /** Returns a valid ID token, refreshing it when it is close to expiry. */
  async function getToken() {
    const session = state.session;
    if (!session) throw new Error('Not signed in');

    const stillFresh = session.expiresAt - Date.now() > 60_000;
    if (stillFresh) return session.idToken;

    if (!session.refreshToken) throw new Error('Session expired');

    const out = await cognito('InitiateAuth', {
      AuthFlow: 'REFRESH_TOKEN_AUTH',
      ClientId: CONFIG.clientId,
      AuthParameters: { REFRESH_TOKEN: session.refreshToken },
    });
    return saveSession(out.AuthenticationResult, session.email).idToken;
  }

  /* ---------------------------------- api -------------------------------- */

  async function api(path, options = {}) {
    const token = await getToken();
    const res = await fetch(`${CONFIG.apiEndpoint.replace(/\/$/, '')}${path}`, {
      ...options,
      headers: {
        ...(options.body ? { 'content-type': 'application/json' } : {}),
        authorization: token,
        ...(options.headers ?? {}),
      },
    });

    if (res.status === 401) {
      clearSession();
      showAuth();
      throw new Error('Your session ended. Sign in again.');
    }

    if (res.status === 204) return null;

    const text = await res.text();
    const data = text ? JSON.parse(text) : null;

    if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
    return data;
  }

  /* -------------------------------- messages ----------------------------- */

  function say(node, text, kind) {
    node.textContent = text ?? '';
    node.classList.toggle('is-error', kind === 'error');
    node.classList.toggle('is-ok', kind === 'ok');
  }

  /** Cognito error codes are precise but unfriendly. Translate the common ones. */
  function humanise(err) {
    switch (err.code) {
      case 'NotAuthorizedException':
        return 'That email and password do not match.';
      case 'UserNotConfirmedException':
        return 'This account still needs confirming. Check your email for the code.';
      case 'UsernameExistsException':
        return 'There is already an account with that email. Try signing in.';
      case 'CodeMismatchException':
        return 'That code is not right. Check the digits and try again.';
      case 'ExpiredCodeException':
        return 'That code has expired. Send yourself a fresh one.';
      case 'InvalidPasswordException':
        return 'Password needs 8+ characters, an uppercase letter and a number.';
      case 'LimitExceededException':
      case 'TooManyRequestsException':
        return 'Too many attempts. Give it a minute.';
      default:
        return err.message || 'Something went wrong. Try again.';
    }
  }

  /* ------------------------------ auth screens --------------------------- */

  function showAuth() {
    el.authView.classList.remove('is-hidden');
    el.appView.classList.add('is-hidden');
    el.signOut.classList.add('is-hidden');
  }

  function showApp() {
    el.authView.classList.add('is-hidden');
    el.appView.classList.remove('is-hidden');
    el.signOut.classList.remove('is-hidden');
  }

  function selectAuthTab(which) {
    const signin = which === 'signin';
    el.tabSignin.classList.toggle('is-active', signin);
    el.tabSignup.classList.toggle('is-active', !signin);
    el.tabSignin.setAttribute('aria-selected', String(signin));
    el.tabSignup.setAttribute('aria-selected', String(!signin));
    el.panelSignin.classList.toggle('is-hidden', !signin);
    el.panelSignup.classList.toggle('is-hidden', signin);
    el.panelConfirm.classList.add('is-hidden');
    say(el.authMessage, '');
  }

  let pendingSignup = null; // { email, password }

  function showConfirm(email) {
    pendingSignup = { ...pendingSignup, email };
    el.confirmEmail.textContent = email;
    el.panelSignin.classList.add('is-hidden');
    el.panelSignup.classList.add('is-hidden');
    el.panelConfirm.classList.remove('is-hidden');
  }

  function wireAuth() {
    el.tabSignin.addEventListener('click', () => selectAuthTab('signin'));
    el.tabSignup.addEventListener('click', () => selectAuthTab('signup'));

    el.panelSignin.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = new FormData(el.panelSignin);
      const email = String(form.get('email')).trim().toLowerCase();
      const password = String(form.get('password'));
      await withBusy(el.panelSignin, async () => {
        try {
          say(el.authMessage, 'Taking a bearing…');
          await signIn(email, password);
        } catch (err) {
          if (err.code === 'UserNotConfirmedException') {
            pendingSignup = { email, password };
            showConfirm(email);
          }
          say(el.authMessage, humanise(err), 'error');
        }
      });
    });

    el.panelSignup.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = new FormData(el.panelSignup);
      const email = String(form.get('email')).trim().toLowerCase();
      const password = String(form.get('password'));
      await withBusy(el.panelSignup, async () => {
        try {
          say(el.authMessage, 'Creating your map…');
          await cognito('SignUp', {
            ClientId: CONFIG.clientId,
            Username: email,
            Password: password,
            UserAttributes: [{ Name: 'email', Value: email }],
          });
          pendingSignup = { email, password };
          showConfirm(email);
          say(el.authMessage, 'Check your inbox for a six-digit code.', 'ok');
        } catch (err) {
          say(el.authMessage, humanise(err), 'error');
        }
      });
    });

    el.panelConfirm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const code = String(new FormData(el.panelConfirm).get('code')).trim();
      await withBusy(el.panelConfirm, async () => {
        try {
          say(el.authMessage, 'Confirming…');
          await cognito('ConfirmSignUp', {
            ClientId: CONFIG.clientId,
            Username: pendingSignup.email,
            ConfirmationCode: code,
          });
          if (pendingSignup.password) {
            await signIn(pendingSignup.email, pendingSignup.password);
          } else {
            selectAuthTab('signin');
            say(el.authMessage, 'Confirmed. Sign in to begin.', 'ok');
          }
        } catch (err) {
          say(el.authMessage, humanise(err), 'error');
        }
      });
    });

    el.resendCode.addEventListener('click', async () => {
      try {
        await cognito('ResendConfirmationCode', {
          ClientId: CONFIG.clientId,
          Username: pendingSignup.email,
        });
        say(el.authMessage, 'Sent. It can take a minute to arrive.', 'ok');
      } catch (err) {
        say(el.authMessage, humanise(err), 'error');
      }
    });

    el.signOut.addEventListener('click', () => {
      clearSession();
      pendingSignup = null;
      el.panelSignin.reset();
      selectAuthTab('signin');
      showAuth();
    });
  }

  async function signIn(email, password) {
    const out = await cognito('InitiateAuth', {
      AuthFlow: 'USER_PASSWORD_AUTH',
      ClientId: CONFIG.clientId,
      AuthParameters: { USERNAME: email, PASSWORD: password },
    });

    if (!out.AuthenticationResult) {
      throw new Error('This account needs extra setup before it can sign in.');
    }

    saveSession(out.AuthenticationResult, email);
    pendingSignup = null;
    say(el.authMessage, '');
    showApp();
    await loadPins();
  }

  /** Disables a form's controls while an async submit is in flight. */
  async function withBusy(form, fn) {
    const controls = [...form.querySelectorAll('button, input')];
    controls.forEach((c) => (c.disabled = true));
    try {
      await fn();
    } finally {
      controls.forEach((c) => (c.disabled = false));
    }
  }

  /* ------------------------------ pin drop ui ---------------------------- */

  function renderCategories() {
    el.categoryGrid.replaceChildren(
      ...CATEGORIES.map((cat) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'category';
        button.dataset.key = cat.key;
        button.setAttribute('aria-pressed', String(cat.key === state.category));
        button.title = cat.blurb;

        const name = document.createElement('span');
        name.className = 'category-name';
        name.textContent = cat.key;

        const bearing = document.createElement('span');
        bearing.className = 'category-bearing';
        bearing.textContent = `${cat.compass} · ${cat.bearing}°`;

        button.append(name, bearing);
        button.addEventListener('click', () => {
          state.category = cat.key;
          for (const other of el.categoryGrid.children) {
            other.setAttribute('aria-pressed', String(other.dataset.key === cat.key));
          }
        });
        return button;
      })
    );
  }

  function wirePinForm() {
    el.intensity.addEventListener('input', () => {
      el.intensityOut.textContent = el.intensity.value;
    });

    const updateCount = () => {
      const left = 280 - el.note.value.length;
      el.noteCount.textContent = `${left} left`;
    };
    el.note.addEventListener('input', updateCount);
    updateCount();

    // Cmd/Ctrl+Enter submits — this is meant to take ten seconds.
    el.note.addEventListener('keydown', (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        el.pinForm.requestSubmit();
      }
    });

    el.pinForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const note = el.note.value.trim();
      if (!note) {
        say(el.pinMessage, 'Two sentences, even rough ones.', 'error');
        return;
      }

      el.pinSubmit.disabled = true;
      try {
        say(el.pinMessage, 'Setting your bearing…');
        const { pin } = await api('/pins', {
          method: 'POST',
          body: JSON.stringify({
            category: state.category,
            intensity: Number(el.intensity.value),
            note,
            occurredAt: new Date().toISOString(),
          }),
        });
        state.pins = [pin, ...(state.pins ?? [])];
        renderTimeline(state.pins);
        drawRose(state.pins);
        el.note.value = '';
        updateCount();
        say(el.pinMessage, 'Pinned. That is the whole ritual.', 'ok');
      } catch (err) {
        say(el.pinMessage, err.message, 'error');
      } finally {
        el.pinSubmit.disabled = false;
      }
    });

    el.refresh.addEventListener('click', () => loadPins());
  }

  /* ------------------------------- timeline ------------------------------ */

  async function loadPins() {
    try {
      const { pins } = await api('/pins?limit=100');
      state.pins = pins;
      renderTimeline(pins);
      drawRose(pins);
    } catch (err) {
      say(el.pinMessage, err.message, 'error');
    }
  }

  function renderTimeline(pins) {
    el.timelineEmpty.classList.toggle('is-hidden', pins.length > 0);
    el.timeline.replaceChildren(...pins.map(renderPin));
  }

  function renderPin(pin) {
    const item = document.createElement('li');
    item.className = 'pin';

    const head = document.createElement('div');
    head.className = 'pin-head';

    const category = document.createElement('span');
    category.className = 'pin-category';
    category.textContent = pin.category;

    const dots = document.createElement('span');
    dots.className = 'pin-dots';
    dots.textContent = '●'.repeat(pin.intensity) + '○'.repeat(5 - pin.intensity);
    dots.title = `Intensity ${pin.intensity} of 5`;

    const meta = document.createElement('span');
    meta.className = 'pin-meta';
    meta.textContent = formatWhen(pin.occurredAt);
    meta.title = new Date(pin.occurredAt).toLocaleString();

    head.append(category, dots, meta);

    const note = document.createElement('p');
    note.className = 'pin-note';
    note.textContent = pin.note;

    const remove = document.createElement('button');
    remove.className = 'pin-delete';
    remove.type = 'button';
    remove.textContent = '×';
    remove.setAttribute('aria-label', `Delete this ${pin.category} pin`);
    remove.addEventListener('click', async () => {
      remove.disabled = true;
      try {
        await api(`/pins/${encodeURIComponent(pin.sk)}`, { method: 'DELETE' });
        state.pins = state.pins.filter((p) => p.sk !== pin.sk);
        renderTimeline(state.pins);
        drawRose(state.pins);
      } catch (err) {
        remove.disabled = false;
        say(el.pinMessage, err.message, 'error');
      }
    });

    item.append(head, note, remove);
    return item;
  }

  function formatWhen(iso) {
    const then = new Date(iso);
    const mins = Math.round((Date.now() - then.getTime()) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.round(hours / 24);
    if (days < 7) return `${days}d ago`;
    return then.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  /* --------------------------------- rose -------------------------------- */

  // The viewBox is wider than it is tall so the east/west labels have room.
  const CX = 160;
  const CY = 126;
  const R_MIN = 24;
  const R_MAX = 86;
  const R_LABEL = R_MAX + 16;

  const point = (bearing, radius) => {
    const rad = (bearing * Math.PI) / 180;
    return [CX + radius * Math.sin(rad), CY - radius * Math.cos(rad)];
  };

  function svg(tag, attrs) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
    return node;
  }

  function drawRose(pins) {
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const recent = (pins ?? []).filter((p) => new Date(p.occurredAt).getTime() >= weekAgo);

    const counts = Object.fromEntries(CATEGORIES.map((c) => [c.key, 0]));
    for (const pin of recent) {
      if (pin.category in counts) counts[pin.category] += 1;
    }
    const max = Math.max(1, ...Object.values(counts));

    // Read the live theme colours so the rose repaints correctly on toggle.
    const css = getComputedStyle(document.documentElement);
    const accent = css.getPropertyValue('--accent').trim() || '#2c5f5d';
    const bearingColor = css.getPropertyValue('--bearing').trim() || '#d4845a';
    const soft = css.getPropertyValue('--text-soft').trim() || '#666';

    const parts = [];

    for (const r of [R_MAX, (R_MAX + R_MIN) / 2]) {
      parts.push(
        svg('circle', {
          cx: CX,
          cy: CY,
          r,
          fill: 'none',
          stroke: accent,
          'stroke-opacity': 0.22,
          'stroke-dasharray': r === R_MAX ? 'none' : '3 5',
        })
      );
    }

    const polygon = [];

    for (const cat of CATEGORIES) {
      const value = counts[cat.key];
      const radius = R_MIN + (value / max) * (R_MAX - R_MIN);
      const [x, y] = point(cat.bearing, radius);
      polygon.push(`${x.toFixed(1)},${y.toFixed(1)}`);

      const [sx, sy] = point(cat.bearing, R_MAX);
      parts.push(
        svg('line', {
          x1: CX,
          y1: CY,
          x2: sx,
          y2: sy,
          stroke: accent,
          'stroke-opacity': 0.16,
        })
      );

      if (value > 0) {
        parts.push(
          svg('circle', { cx: x, cy: y, r: 3.5, fill: bearingColor })
        );
      }

      const [lx, ly] = point(cat.bearing, R_LABEL);
      const label = svg('text', {
        x: lx,
        y: ly,
        fill: value > 0 ? bearingColor : soft,
        'font-size': 9.5,
        'font-family': 'ui-sans-serif, system-ui, sans-serif',
        'letter-spacing': 0.6,
        'text-anchor': lx > CX + 4 ? 'start' : lx < CX - 4 ? 'end' : 'middle',
        'dominant-baseline': 'middle',
      });
      label.textContent = cat.key;
      parts.push(label);
    }

    parts.push(
      svg('polygon', {
        points: polygon.join(' '),
        fill: bearingColor,
        'fill-opacity': 0.2,
        stroke: bearingColor,
        'stroke-width': 1.6,
        'stroke-linejoin': 'round',
      })
    );

    parts.push(svg('circle', { cx: CX, cy: CY, r: 2.5, fill: accent }));

    // Keep <title>/<desc> (the first two children) for screen readers.
    const keep = [...el.rose.children].filter((c) =>
      ['title', 'desc'].includes(c.tagName.toLowerCase())
    );
    el.rose.replaceChildren(...keep, ...parts);

    renderRoseSummary(recent, counts);
  }

  function renderRoseSummary(recent, counts) {
    if (recent.length === 0) {
      el.roseSummary.textContent = 'Nothing in the last seven days. The rose is waiting.';
      return;
    }

    const [topKey, topCount] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    const avg = recent.reduce((sum, p) => sum + p.intensity, 0) / recent.length;

    const byDay = {};
    for (const pin of recent) {
      const day = new Date(pin.occurredAt).toLocaleDateString(undefined, { weekday: 'long' });
      byDay[day] = (byDay[day] ?? 0) + 1;
    }
    const [topDay, topDayCount] = Object.entries(byDay).sort((a, b) => b[1] - a[1])[0];

    el.roseSummary.replaceChildren();
    el.roseSummary.append(
      `${recent.length} pin${recent.length === 1 ? '' : 's'} this week, averaging `,
      strong(avg.toFixed(1)),
      ' in intensity. You have been heading ',
      strong(topKey),
      ` (${topCount}), and `,
      strong(topDay),
      ` was your loudest day (${topDayCount}).`
    );
  }

  function strong(text) {
    const node = document.createElement('strong');
    node.textContent = text;
    return node;
  }

  /* --------------------------------- boot -------------------------------- */

  async function boot() {
    if (!CONFIG?.clientId || !CONFIG?.apiEndpoint) {
      el.bootError.textContent =
        'config.js is missing or incomplete. Run `terraform apply` in infra/, or generate a local config (see the README).';
      el.bootError.classList.remove('is-hidden');
      return;
    }

    initTheme();
    wireAuth();
    renderCategories();
    wirePinForm();

    const saved = store.get(STORAGE_KEY);
    if (saved?.refreshToken) {
      state.session = saved;
      try {
        await getToken(); // refreshes if needed and proves the session is live
        showApp();
        await loadPins();
        return;
      } catch {
        clearSession();
      }
    }

    selectAuthTab('signin');
    showAuth();
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
