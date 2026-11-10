const app = document.getElementById('app');
const TOKEN = 'nlpps_token';

const state = { token: sessionStorage.getItem(TOKEN), guardian: null, children: [], child: null, change: null, error: null, busy: false };

const el = (tag, props = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') node.className = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (value !== undefined && value !== null) node.setAttribute(key, value);
  }
  for (const child of children.flat()) {
    if (child !== null && child !== undefined) node.append(child);
  }
  return node;
};

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Something went wrong (${res.status})`);
  return json;
}

// The signing key is created on this device and can never be read out of the
// browser. The server only ever sees its public half.
const DB = 'nlpps-device';

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('keys');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function deviceKey() {
  if (!crypto.subtle) throw new Error('Open this page over https (or on localhost) so this device can approve rules.');
  const db = await openDb();
  const name = `guardian:${state.guardian.id}`;
  const existing = await new Promise((resolve, reject) => {
    const request = db.transaction('keys').objectStore('keys').get(name);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  if (existing) return existing;

  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
  const { kty, crv, x, y } = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const { kid } = await api('POST', '/api/me/keys', { jwk: { kty, crv, x, y } });
  const record = { kid, privateKey: pair.privateKey };
  await new Promise((resolve, reject) => {
    const request = db.transaction('keys', 'readwrite').objectStore('keys').put(record, name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
  return record;
}

function base64url(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

async function approve(message) {
  const { kid, privateKey } = await deviceKey();
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, new TextEncoder().encode(message));
  return { kid, signature: base64url(signature) };
}

const run = (action) => async (event) => {
  event?.preventDefault?.();
  state.busy = true;
  state.error = null;
  render();
  try {
    await action();
  } catch (error) {
    state.error = error.message;
  }
  state.busy = false;
  render();
};

async function loadHome() {
  const me = await api('GET', '/api/me');
  state.guardian = me.guardian;
  state.children = me.children;
  await deviceKey();
}

async function openChild(id) {
  state.child = await api('GET', `/api/children/${id}`);
  state.child.requests = (await api('GET', `/api/children/${id}/requests`)).requests;
  state.child.versions = (await api('GET', `/api/children/${id}/versions`)).versions;
  state.change = null;
}

function signIn() {
  const email = el('input', { type: 'email', autocomplete: 'username', required: 'true' });
  const password = el('input', { type: 'password', autocomplete: 'current-password', required: 'true', minlength: '10' });
  const name = el('input', { autocomplete: 'name' });

  const go = (path, body) =>
    run(async () => {
      const result = await api('POST', path, body());
      state.token = result.token;
      sessionStorage.setItem(TOKEN, result.token);
      await loadHome();
    });

  return el(
    'div',
    {},
    el('h1', {}, 'Family Rules'),
    el(
      'div',
      { class: 'card' },
      el('p', { class: 'muted' }, 'Write the rules for your child in plain words. Nothing changes until you approve it on this device.'),
      el('label', {}, 'Email', email),
      el('label', {}, 'Password (10 characters or more)', password),
      el('label', {}, 'Your name (new accounts only)', name),
      el('button', { onclick: go('/api/auth/login', () => ({ email: email.value, password: password.value })) }, 'Sign in'),
      el('button', { class: 'quiet', onclick: go('/api/auth/register', () => ({ email: email.value, password: password.value, name: name.value || 'Parent' })) }, 'Create account'),
    ),
  );
}

function home() {
  const name = el('input', { placeholder: 'A name or nickname' });
  const age = el('select', {}, ['0_5:Up to 5', '6_11:6 to 11', '12_17:12 to 17'].map((option) => el('option', { value: option.split(':')[0] }, option.split(':')[1])));

  return el(
    'div',
    {},
    el('h1', {}, 'Your children'),
    state.children.length === 0 ? el('p', { class: 'muted' }, 'Add a child to get started.') : null,
    state.children.map((child) => el('div', { class: 'card row' }, el('strong', {}, child.name), el('button', { class: 'quiet', onclick: run(() => openChild(child.id)) }, 'Open'))),
    el(
      'div',
      { class: 'card' },
      el('h2', {}, 'Add a child'),
      el('label', {}, 'Name', name),
      el('label', {}, 'Age group', age),
      el(
        'button',
        {
          onclick: run(async () => {
            const { child, change } = await api('POST', '/api/children', { name: name.value, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, age_band: age.value });
            state.child = await api('GET', `/api/children/${child.id}`);
            state.child.requests = [];
            state.child.versions = [];
            state.change = change;
          }),
        },
        'Add',
      ),
    ),
    el('button', {
      class: 'link',
      onclick: run(async () => {
        await api('POST', '/api/auth/logout');
        sessionStorage.removeItem(TOKEN);
        Object.assign(state, { token: null, guardian: null, children: [] });
      }),
    }, 'Sign out'),
  );
}

function changeCard() {
  const change = state.change;
  const childId = state.child.child.id;

  const finish = async () => {
    await openChild(childId);
    state.notice = 'Done. Your child\'s phone picks this up the next time it checks.';
  };

  if (change.state === 'clarify') {
    const answer = el('input', { placeholder: 'Your answer' });
    const send = (text) => run(async () => (state.change = await api('POST', `/api/changes/${change.id}/clarify`, { answer: text() })));
    return el(
      'div',
      { class: 'card' },
      el('h2', {}, change.question),
      (change.options ?? []).map((option) => el('button', { class: 'quiet', onclick: send(() => option) }, option)),
      el('label', {}, 'Or type your own answer', answer),
      el('button', { onclick: send(() => answer.value) }, 'Send'),
    );
  }

  if (change.state === 'unsupported' || change.state === 'failed') {
    return el('div', { class: 'card' }, el('h2', {}, change.state === 'unsupported' ? 'This can\'t be a rule yet' : 'That didn\'t work'), el('p', {}, change.reason), el('button', { class: 'quiet', onclick: () => ((state.change = null), render()) }, 'OK'));
  }

  if (change.state === 'preview') {
    const preview = change.preview;
    return el(
      'div',
      { class: 'card' },
      el('h2', {}, change.kind === 'create' ? 'These protections will apply' : 'Please check this'),
      el('ul', {}, (preview.changes.length ? preview.changes : ['No change to the rules.']).map((line) => el('li', {}, line))),
      preview.no_effect ? el('div', { class: 'note' }, 'This won\'t change what your child sees, because other rules already cover it.') : null,
      preview.notes.map((note) => el('div', { class: 'note' }, note)),
      preview.examples.length ? el('div', {}, el('p', { class: 'muted' }, 'For example:'), el('ul', { class: 'muted' }, preview.examples.map((example) => el('li', {}, example)))) : null,
      el(
        'button',
        {
          onclick: run(async () => {
            const signature = await approve(change.sign_message);
            const result = await api('POST', `/api/changes/${change.id}/confirm`, signature);
            if (result.state === 'live') await finish();
            else state.change = result;
          }),
        },
        'Approve on this device',
      ),
      el('button', { class: 'quiet', onclick: run(async () => { await api('POST', `/api/changes/${change.id}/cancel`); state.change = null; }) }, 'Cancel'),
    );
  }

  return null;
}

function childPage() {
  const { child, policy, devices, requests = [], versions = [] } = state.child;
  const text = el('textarea', { placeholder: 'For example: no war news after 9 pm on Sunday to Thursday, but science is fine', maxlength: '1000' });

  const family = (policy?.rules ?? []).filter((rule) => rule.layer === 'family');
  const seen = new Set();
  const built = (policy?.rules ?? []).filter((rule) => rule.layer !== 'family');
  const pending = requests.filter((request) => request.status === 'pending');

  return el(
    'div',
    {},
    el('button', { class: 'link', onclick: () => ((state.child = null), (state.change = null), render()) }, '← All children'),
    el('h1', {}, child.name),
    state.notice ? el('div', { class: 'note' }, state.notice) : null,
    state.change ? changeCard() : el(
      'div',
      { class: 'card' },
      el('h2', {}, 'Add a rule in your own words'),
      text,
      el('p', {}, el('button', { onclick: run(async () => { state.notice = null; state.change = await api('POST', `/api/children/${child.id}/changes`, { text: text.value }); }) }, 'Continue')),
    ),
    pending.length
      ? el(
          'div',
          { class: 'card' },
          el('h2', {}, `${child.name} is asking`),
          pending.map((request) =>
            el(
              'div',
              {},
              el('p', {}, el('strong', {}, request.content.title || request.content.content_id), request.note ? ` — "${request.note}"` : ''),
              [['1h', '1 hour'], ['today', 'Today'], ['week', 'A week'], ['always', 'Always']].map(([duration, label]) =>
                el('button', { class: 'quiet', onclick: run(async () => { state.change = await api('POST', `/api/children/${child.id}/requests/${request.id}/decide`, { approve: true, duration }); }) }, label),
              ),
              el('button', { class: 'link', onclick: run(async () => { await api('POST', `/api/children/${child.id}/requests/${request.id}/decide`, { approve: false }); await openChild(child.id); }) }, 'Say no'),
            ),
          ),
        )
      : null,
    el(
      'div',
      { class: 'card' },
      el('h2', {}, 'Your rules'),
      family.length === 0 ? el('p', { class: 'muted' }, 'None yet.') : null,
      family.map((rule) => {
        const first = !seen.has(rule.instruction_id);
        seen.add(rule.instruction_id);
        return el(
          'div',
          { class: 'row' },
          el('span', {}, rule.text),
          first ? el('button', { class: 'link', onclick: run(async () => { state.change = await api('POST', `/api/children/${child.id}/remove`, { instruction_id: rule.instruction_id }); }) }, 'Remove') : null,
        );
      }),
    ),
    el('div', { class: 'card' }, el('h2', {}, 'Always on'), el('ul', { class: 'muted' }, built.map((rule) => el('li', {}, rule.text)))),
    el(
      'div',
      { class: 'card' },
      el('h2', {}, 'Child\'s phone'),
      devices.filter((device) => !device.revoked_at).map((device) =>
        el(
          'div',
          { class: 'row' },
          el('span', {}, device.label, el('span', { class: 'tag' }, device.last_seen ? ` · last checked ${new Date(device.last_seen).toLocaleString()}` : ' · not checked yet')),
          el('button', { class: 'link', onclick: run(async () => { await api('DELETE', `/api/children/${child.id}/devices/${device.id}`); await openChild(child.id); }) }, 'Unlink'),
        ),
      ),
      el('div', { id: 'qr' }),
      el(
        'button',
        {
          class: 'quiet',
          onclick: run(async () => {
            const code = await api('POST', `/api/children/${child.id}/pairing-codes`, {});
            state.pairing = code;
          }),
        },
        'Link a phone',
      ),
    ),
    versions.length > 1
      ? el(
          'div',
          { class: 'card' },
          el('h2', {}, 'History'),
          versions.slice(0, 8).map((version) =>
            el(
              'div',
              { class: 'row' },
              el('span', {}, `Version ${version.version}`, el('span', { class: 'tag' }, ` · ${new Date(version.created_at).toLocaleString()}`)),
              version.version !== policy.version ? el('button', { class: 'link', onclick: run(async () => { state.change = await api('POST', `/api/children/${child.id}/rollback`, { version: version.version }); }) }, 'Go back') : null,
            ),
          ),
        )
      : null,
  );
}

function render() {
  const page = !state.token || !state.guardian ? signIn() : state.child ? childPage() : home();
  app.replaceChildren(page);

  if (state.error) app.prepend(el('p', { class: 'error' }, state.error));
  if (state.busy) app.prepend(el('p', { class: 'muted' }, 'Working…'));

  const target = document.getElementById('qr');
  if (target && state.pairing) {
    const qr = window.qrcode(0, 'M');
    qr.addData(state.pairing.pair_url);
    qr.make();
    const image = el('img', { src: qr.createDataURL(6), alt: 'Pairing code' });
    target.append(image, el('p', { class: 'code' }, state.pairing.code), el('p', { class: 'muted' }, 'Scan this with the child\'s phone camera. The code works once, for 10 minutes.'));
  }
}

if (state.token) {
  run(loadHome)().catch(() => {});
} else {
  render();
}
