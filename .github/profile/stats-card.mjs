// Builds dist/stats.svg: a Fluent-style "By the numbers" card from public GitHub data.
// Usage: node stats-card.mjs            (live, needs GITHUB_TOKEN)
//        node stats-card.mjs --mock f.json   (offline test with a saved GraphQL "user" object)
import fs from 'node:fs';
import path from 'node:path';
import { graphql, USER, esc, ukDate } from './lib.mjs';

const OUT_DIR = process.env.OUT_DIR || 'dist';
const SANS = "'Segoe UI Variable Display','Segoe UI',system-ui,-apple-system,BlinkMacSystemFont,'Helvetica Neue',Arial,sans-serif";

const QUERY = `query($login:String!){
  user(login:$login){
    followers{ totalCount }
    repositories(ownerAffiliations: OWNER, privacy: PUBLIC, isFork: false, first: 100){
      totalCount
      nodes{ name stargazerCount languages(first: 10, orderBy: {field: SIZE, direction: DESC}){ edges{ size node{ name color } } } }
    }
    contributionsCollection{
      totalCommitContributions totalPullRequestContributions restrictedContributionsCount
      contributionCalendar{ totalContributions weeks{ contributionDays{ date contributionCount weekday } } }
    }
  }
}`;

const mockAt = process.argv.indexOf('--mock');
const user = mockAt > -1
  ? JSON.parse(fs.readFileSync(process.argv[mockAt + 1], 'utf8'))
  : (await graphql(QUERY, { login: USER })).user;

// ---------- numbers
const cal = user.contributionsCollection.contributionCalendar;
const days = cal.weeks.flatMap((w) => w.contributionDays).sort((a, b) => a.date.localeCompare(b.date));
const total = cal.totalContributions;
let i = days.length - 1;
if (i >= 0 && days[i].contributionCount === 0) i--; // today isn't over yet
let current = 0;
while (i >= 0 && days[i].contributionCount > 0) { current++; i--; }
let longest = 0;
let run = 0;
for (const d of days) { run = d.contributionCount > 0 ? run + 1 : 0; longest = Math.max(longest, run); }
const activeDays = days.filter((d) => d.contributionCount > 0).length;
const byWeekday = Array(7).fill(0);
for (const d of days) byWeekday[d.weekday] += d.contributionCount;
const WD = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const busiest = total > 0 ? WD[byWeekday.indexOf(Math.max(...byWeekday))] : 'TBC';
const repos = user.repositories.totalCount;
const stars = user.repositories.nodes.reduce((s, r) => s + r.stargazerCount, 0);

const langMap = new Map();
for (const r of user.repositories.nodes) {
  for (const e of r.languages.edges) {
    const cur = langMap.get(e.node.name) || { size: 0, color: e.node.color };
    cur.size += e.size;
    langMap.set(e.node.name, cur);
  }
}
const langTotal = [...langMap.values()].reduce((s, v) => s + v.size, 0) || 1;
const FALLBACK = ['#50E6FF', '#2899F5', '#0F6CBD', '#8661C5', '#4CC2FF'];
// GitHub's colours for some languages (PowerShell navy, for one) vanish on a dark card, so swap those out
const luminance = (hex) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return 0;
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const visible = (hex, k) => (luminance(hex) < 0.06 ? FALLBACK[k % FALLBACK.length] : hex);
const langs = [...langMap.entries()]
  .sort((a, b) => b[1].size - a[1].size)
  .slice(0, 5)
  .map(([name, v], k) => ({ name, pct: (v.size / langTotal) * 100, color: visible(v.color, k) }));
const weeks = cal.weeks.map((w) => w.contributionDays.reduce((s, d) => s + d.contributionCount, 0));

// ---------- drawing helpers
const fmt = (n) => Number(n).toLocaleString('en-GB');
const W = 1200;
const H = 380;
const out = [];
const A = (s) => out.push(s);
// fade/slide in from t=0 so nothing flickers; static renderers just see the final state
const fadeIn = (delay, dur = 0.7) => {
  const total = delay + dur;
  const k = (delay / total).toFixed(3);
  return `<animate attributeName="opacity" values="0;0;1" keyTimes="0;${k};1" dur="${total}s" fill="freeze"/>` +
    `<animateTransform attributeName="transform" type="translate" values="0 10;0 10;0 0" keyTimes="0;${k};1" dur="${total}s" fill="freeze" calcMode="spline" keySplines="0 0 1 1;.2 .8 .2 1"/>`;
};

A(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="t">`);
A(`<title id="t">${esc(`${fmt(total)} contributions in the last 12 months, current streak ${current} days, longest streak ${longest} days`)}</title>`);
A(`<defs>
<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#07122A"/><stop offset=".55" stop-color="#0A1D3D"/><stop offset="1" stop-color="#0D2A56"/></linearGradient>
<linearGradient id="accent" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#50E6FF"/><stop offset="1" stop-color="#0F6CBD"/></linearGradient>
<linearGradient id="ring" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#50E6FF"/><stop offset=".6" stop-color="#2899F5"/><stop offset="1" stop-color="#8661C5"/></linearGradient>
<linearGradient id="area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2899F5" stop-opacity=".45"/><stop offset="1" stop-color="#2899F5" stop-opacity="0"/></linearGradient>
<radialGradient id="oA"><stop offset="0" stop-color="#0078D4" stop-opacity=".45"/><stop offset="1" stop-color="#0078D4" stop-opacity="0"/></radialGradient>
<radialGradient id="oC"><stop offset="0" stop-color="#8661C5" stop-opacity=".30"/><stop offset="1" stop-color="#8661C5" stop-opacity="0"/></radialGradient>
<clipPath id="win"><rect width="${W}" height="${H}" rx="16"/></clipPath>
<clipPath id="spark"><rect x="40" y="280" width="1120" height="90"><animate attributeName="width" values="0;1120" dur="2.2s" fill="freeze" calcMode="spline" keyTimes="0;1" keySplines=".3 .7 .2 1"/></rect></clipPath>
</defs>`);
A(`<g clip-path="url(#win)"><rect width="${W}" height="${H}" fill="url(#bg)"/>
<g><circle cx="1050" cy="60" r="300" fill="url(#oA)"/><animateTransform attributeName="transform" type="translate" values="0 0;-40 20;0 0" dur="15s" repeatCount="indefinite"/></g>
<g><circle cx="620" cy="360" r="260" fill="url(#oC)"/><animateTransform attributeName="transform" type="translate" values="0 0;40 -10;0 0" dur="18s" repeatCount="indefinite"/></g></g>`);

// header
A(`<text x="40" y="50" font-family="${SANS}" font-size="22" font-weight="600" fill="#FFFFFF">By the numbers</text>`);
A(`<text x="1160" y="50" text-anchor="end" font-family="${SANS}" font-size="13" fill="#8EA3BF">Updated ${esc(ukDate(new Date()))} · refreshed nightly by GitHub Actions</text>`);

// tiles
const tiles = [
  [fmt(total), 'contributions, last 12 months'],
  [fmt(activeDays), 'days I shipped something'],
  [fmt(longest), 'longest streak (days)'],
  [busiest, 'busiest day of the week'],
  [fmt(repos), 'public repos'],
  [fmt(stars), 'stars earned'],
];
tiles.forEach(([value, label], k) => {
  const x = 40 + (k % 3) * 184;
  const y = 78 + Math.floor(k / 3) * 100;
  const big = String(value).length > 6 ? 22 : 30;
  A(`<g>${fadeIn(0.1 + k * 0.09)}<rect x="${x}" y="${y}" width="170" height="86" rx="12" fill="#FFFFFF" fill-opacity=".045" stroke="#FFFFFF" stroke-opacity=".09"/>
<rect x="${x}" y="${y + 16}" width="3" height="54" rx="1.5" fill="url(#accent)"/>
<text x="${x + 18}" y="${y + 44}" font-family="${SANS}" font-size="${big}" font-weight="700" fill="#FFFFFF">${esc(value)}</text>
<text x="${x + 18}" y="${y + 68}" font-family="${SANS}" font-size="12.5" fill="#8EA3BF">${esc(label)}</text></g>`);
});

// streak ring
const cx = 700;
const cy = 170;
const r = 64;
const C = 2 * Math.PI * r;
const ratio = longest > 0 ? Math.min(current / longest, 1) : 0;
const end = C * (1 - ratio);
A(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#FFFFFF" stroke-opacity=".08" stroke-width="10"/>`);
A(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="url(#ring)" stroke-width="10" stroke-linecap="round" stroke-dasharray="${C.toFixed(2)}" stroke-dashoffset="${end.toFixed(2)}" transform="rotate(-90 ${cx} ${cy})"${ratio === 0 ? ' opacity="0"' : ''}>
<animate attributeName="stroke-dashoffset" values="${C.toFixed(2)};${end.toFixed(2)}" dur="1.6s" fill="freeze" calcMode="spline" keyTimes="0;1" keySplines=".2 .8 .2 1"/></circle>`);
A(`<text x="${cx}" y="${cy + 12}" text-anchor="middle" font-family="${SANS}" font-size="42" font-weight="700" fill="#FFFFFF">${current}</text>`);
A(`<text x="${cx}" y="${cy + 34}" text-anchor="middle" font-family="${SANS}" font-size="12.5" fill="#8EA3BF">day streak</text>`);
const ringCaption = current === 0 ? `Streak resting. Best: ${longest} days` : current >= longest ? 'Personal best, right now' : `Best: ${longest} days`;
A(`<text x="${cx}" y="${cy + 92}" text-anchor="middle" font-family="${SANS}" font-size="13" fill="#AFC3DB">${esc(ringCaption)}</text>`);

// languages
const LX = 820;
const LW = 340;
A(`<text x="${LX}" y="96" font-family="${SANS}" font-size="14" font-weight="600" fill="#FFFFFF">Top languages <tspan font-weight="400" fill="#8EA3BF">· public repos</tspan></text>`);
if (!langs.length) {
  A(`<text x="${LX}" y="130" font-family="${SANS}" font-size="13" fill="#8EA3BF">Nothing public yet. Watch this space.</text>`);
}
langs.forEach((l, k) => {
  const y = 118 + k * 30;
  const w = Math.max(4, (l.pct / 100) * LW);
  A(`<text x="${LX}" y="${y + 10}" font-family="${SANS}" font-size="13" fill="#D5E2F2">${esc(l.name)}</text>`);
  A(`<text x="${LX + LW}" y="${y + 10}" text-anchor="end" font-family="${SANS}" font-size="13" fill="#8EA3BF">${l.pct.toFixed(1)}%</text>`);
  A(`<rect x="${LX}" y="${y + 17}" width="${LW}" height="6" rx="3" fill="#FFFFFF" fill-opacity=".07"/>`);
  A(`<rect x="${LX}" y="${y + 17}" width="${w.toFixed(1)}" height="6" rx="3" fill="${esc(l.color)}"><animate attributeName="width" values="0;0;${w.toFixed(1)}" keyTimes="0;${(0.3 + k * 0.1) / (1.5 + k * 0.1)};1" dur="${(1.5 + k * 0.1).toFixed(1)}s" fill="freeze"/></rect>`);
});

// weekly sparkline
const SX = 40;
const SW = 1120;
const TOP = 304;
const BASE = 356;
const max = Math.max(1, ...weeks);
const pts = weeks.map((v, k) => [SX + (k / Math.max(1, weeks.length - 1)) * SW, BASE - (v / max) * (BASE - TOP)]);
let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
for (let k = 0; k < pts.length - 1; k++) {
  const p0 = pts[k - 1] || pts[k];
  const p1 = pts[k];
  const p2 = pts[k + 1];
  const p3 = pts[k + 2] || p2;
  const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
  const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
  d += ` C${c1[0].toFixed(1)} ${Math.min(BASE, c1[1]).toFixed(1)} ${c2[0].toFixed(1)} ${Math.min(BASE, c2[1]).toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
}
A(`<text x="${SX}" y="292" font-family="${SANS}" font-size="12.5" fill="#8EA3BF">Contributions per week, last 12 months</text>`);
A(`<line x1="${SX}" y1="${BASE}" x2="${SX + SW}" y2="${BASE}" stroke="#FFFFFF" stroke-opacity=".08"/>`);
A(`<g clip-path="url(#spark)"><path d="${d} L${SX + SW} ${BASE} L${SX} ${BASE}Z" fill="url(#area)"/><path d="${d}" fill="none" stroke="#50E6FF" stroke-width="2" stroke-linejoin="round"/></g>`);
const last = pts[pts.length - 1];
A(`<circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="4" fill="#50E6FF"/>`);
A(`<circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="4" fill="none" stroke="#50E6FF" stroke-width="2"><animate attributeName="r" values="4;14" dur="1.8s" repeatCount="indefinite"/><animate attributeName="opacity" values=".8;0" dur="1.8s" repeatCount="indefinite"/></circle>`);

A(`<rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="16" fill="none" stroke="#FFFFFF" stroke-opacity=".10"/>`);
A('</svg>');

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, 'stats.svg'), out.join('\n'));
console.log(`stats.svg written: ${total} contributions, streak ${current}/${longest}, ${langs.length} languages, ${repos} public repos`);
