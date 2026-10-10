// Shared helpers for the profile README automations. Zero dependencies (Node 20+).
export const TOKEN = process.env.GITHUB_TOKEN || '';
export const REPO = process.env.GITHUB_REPOSITORY || 'ogradyliam5/ogradyliam5';
export const USER = process.env.USERNAME || REPO.split('/')[0];
const API = 'https://api.github.com';

function headers(extra = {}) {
  return {
    Authorization: `Bearer ${TOKEN}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'ogradyliam5-profile-bot',
    ...extra,
  };
}

export async function gh(path, { method = 'GET', body } = {}) {
  const res = await fetch(path.startsWith('http') ? path : API + path, {
    method,
    headers: headers(body ? { 'Content-Type': 'application/json' } : {}),
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.status === 204 ? null : res.json();
}

export async function graphql(query, variables = {}) {
  const res = await fetch(`${API}/graphql`, {
    method: 'POST',
    headers: headers({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.errors) throw new Error(`GraphQL ${res.status}: ${JSON.stringify(json.errors || json).slice(0, 400)}`);
  return json.data;
}

export function readSection(md, name) {
  const start = `<!-- ${name}:START -->`;
  const end = `<!-- ${name}:END -->`;
  const i = md.indexOf(start);
  const j = md.indexOf(end);
  if (i < 0 || j < i) return null;
  return md.slice(i + start.length, j);
}

export function replaceSection(md, name, content) {
  const start = `<!-- ${name}:START -->`;
  const end = `<!-- ${name}:END -->`;
  const i = md.indexOf(start);
  const j = md.indexOf(end);
  if (i < 0 || j < i) throw new Error(`README markers for ${name} not found`);
  return `${md.slice(0, i + start.length)}\n${content.trim()}\n${md.slice(j)}`;
}

export const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const ukDate = (d) =>
  new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/London' }).format(d);

export const safeLogin = (s) => (/^[A-Za-z0-9-]{1,39}(\[bot\])?$/.test(String(s)) ? String(s) : 'someone');
