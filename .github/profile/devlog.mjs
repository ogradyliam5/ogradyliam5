// Weekly AI devlog: a GitHub Models LLM summarises Liam's PUBLIC activity into the README.
// Runs in GitHub Actions with `permissions: models: read` (no API keys needed).
// Usage: node devlog.mjs                        live
//        node devlog.mjs --mock facts.json --mock-llm reply.txt   offline test
import fs from 'node:fs';
import { gh, graphql, TOKEN, USER, readSection, replaceSection, ukDate } from './lib.mjs';

const README = 'README.md';
const MODELS = 'https://models.github.ai';
const PREFERRED = [
  ...(process.env.DEVLOG_MODEL ? [process.env.DEVLOG_MODEL] : []),
  'openai/gpt-5-mini', 'openai/gpt-4.1-mini', 'openai/gpt-4o-mini', 'openai/gpt-5-nano', 'openai/gpt-4.1-nano', 'openai/gpt-4.1', 'openai/gpt-4o',
];
const now = new Date();
const since = new Date(now.getTime() - 7 * 864e5);

const SYSTEM = `You write the weekly devlog on Liam O'Grady's GitHub profile README.
Liam is an AI Solution Architect in London who builds with Copilot Studio, Power Platform, Microsoft 365 Copilot, Azure and MCP.
Voice: British/Irish English, confident, a bit of craic: light and witty, never cringe, never mean. Tech only, nothing about his personal life.
Rules:
- Use ONLY the facts in the JSON you are given. Never invent projects, features, numbers, people or outcomes.
- Commit messages are terse. You may paraphrase them in plain English but must not add detail they don't contain.
- No links, no @mentions, no hashtags, no code blocks, no HTML. At most one emoji per bullet.
- contributionsThisWeek counts all contributions, including private repos. If it is bigger than the public activity, you may say the rest happened in private repos, without guessing what it was.
- If there is no public activity at all, say it was a heads-down week in private repos, with a wink.
Output format, exactly:
HEADLINE: <at most 9 words>
- <bullet, at most 22 words>
- <bullet, at most 22 words>
- <optional third bullet, at most 22 words>`;

async function gather() {
  const facts = { window: { from: since.toISOString().slice(0, 10), to: now.toISOString().slice(0, 10) }, publicRepos: [], publicEvents: [], contributionsThisWeek: null };
  const repos = await gh(`/users/${USER}/repos?type=owner&sort=pushed&per_page=100`);
  const active = repos.filter((r) => !r.fork && !r.private && r.name.toLowerCase() !== USER.toLowerCase() && new Date(r.pushed_at) >= since).slice(0, 8);
  for (const r of active) {
    let commits = [];
    try { commits = await gh(`/repos/${r.full_name}/commits?author=${USER}&since=${since.toISOString()}&per_page=30`); } catch { /* empty repo etc. */ }
    const msgs = commits.map((c) => c.commit.message.split('\n')[0].slice(0, 120)).filter((m) => !/^merge /i.test(m));
    if (msgs.length) facts.publicRepos.push({ repo: r.name, about: r.description || '', commits: msgs.length, messages: msgs.slice(0, 10) });
  }
  try {
    const events = await gh(`/users/${USER}/events/public?per_page=100`);
    const out = [];
    for (const e of events) {
      if (new Date(e.created_at) < since) continue;
      const repo = e.repo?.name || '';
      if (repo.toLowerCase() === `${USER}/${USER}`.toLowerCase()) continue;
      const p = e.payload || {};
      if (e.type === 'PullRequestEvent' && p.action === 'opened') out.push(`Opened a pull request "${(p.pull_request?.title || '').slice(0, 100)}" in ${repo}`);
      else if (e.type === 'PullRequestEvent' && p.action === 'closed' && p.pull_request?.merged) out.push(`Merged a pull request "${(p.pull_request?.title || '').slice(0, 100)}" in ${repo}`);
      else if (e.type === 'ReleaseEvent' && p.action === 'published') out.push(`Released ${p.release?.tag_name || 'a new version'} of ${repo}`);
      else if (e.type === 'CreateEvent' && p.ref_type === 'repository') out.push(`Created the public repo ${repo}`);
      else if (e.type === 'PublicEvent') out.push(`Made ${repo} public`);
      else if (e.type === 'IssuesEvent' && p.action === 'opened') out.push(`Opened an issue "${(p.issue?.title || '').slice(0, 100)}" in ${repo}`);
      else if (e.type === 'WatchEvent') out.push(`Starred ${repo}`);
      else if (e.type === 'ForkEvent') out.push(`Forked ${repo}`);
    }
    facts.publicEvents = [...new Set(out)].slice(0, 15);
  } catch (e) { console.warn(`events: ${e.message}`); }
  try {
    const q = 'query($login:String!,$from:DateTime!,$to:DateTime!){ user(login:$login){ contributionsCollection(from:$from,to:$to){ contributionCalendar{ totalContributions } } } }';
    const d = await graphql(q, { login: USER, from: since.toISOString(), to: now.toISOString() });
    facts.contributionsThisWeek = d.user.contributionsCollection.contributionCalendar.totalContributions;
  } catch (e) { console.warn(`calendar: ${e.message}`); }
  return facts;
}

const modelHeaders = () => ({ Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' });

async function catalog() {
  try {
    const res = await fetch(`${MODELS}/catalog/models`, { headers: modelHeaders() });
    if (!res.ok) { console.warn(`catalog: ${res.status}`); return []; }
    const j = await res.json();
    return (Array.isArray(j) ? j : j.models || j.data || []).map((m) => m.id).filter(Boolean);
  } catch (e) { console.warn(`catalog: ${e.message}`); return []; }
}

async function chat(model, facts) {
  const res = await fetch(`${MODELS}/inference/chat/completions`, {
    method: 'POST',
    headers: { ...modelHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: JSON.stringify(facts, null, 2) }] }),
  });
  if (!res.ok) throw new Error(`${model}: ${res.status} ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  const text = j.choices?.[0]?.message?.content;
  if (!text) throw new Error(`${model}: empty reply`);
  return text;
}

const clean = (s, max) => String(s)
  .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  .replace(/<[^>]*>/g, '')
  .replace(/https?:\/\/\S+/g, '')
  .replace(/[@<>|]/g, '')
  .replace(/\*\*/g, '')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, max);

function parse(text) {
  const lines = String(text).replace(/\r/g, '').split('\n').map((l) => l.trim()).filter(Boolean);
  let headline = '';
  const bullets = [];
  for (const l of lines) {
    const h = l.replace(/\*/g, '').match(/^headline\s*:\s*(.+)$/i);
    if (h && !headline) { headline = h[1]; continue; }
    const b = l.match(/^(?:[-*•]|\d+[.)])\s+(.+)$/);
    if (b) bullets.push(b[1]);
  }
  return { headline: clean(headline, 90), bullets: bullets.slice(0, 3).map((b) => clean(b, 220)).filter(Boolean) };
}

function fallback(f) {
  if (f.publicRepos.length) {
    return { headline: 'Shipping in public this week', bullets: f.publicRepos.slice(0, 3).map((r) => `${r.commits} commit${r.commits === 1 ? '' : 's'} to ${r.repo}.`) };
  }
  return { headline: 'Heads down in private repos', bullets: [f.contributionsThisWeek ? `${f.contributionsThisWeek} contributions this week, all behind closed doors for now. 🤫` : 'Quiet on the public front this week. Something is brewing. 🤫'] };
}

function render({ headline, bullets }, model) {
  const by = model ? `written by \`${model}\` via GitHub Models, running in GitHub Actions` : 'auto-generated in GitHub Actions';
  return [
    `> **${headline}**`,
    '>',
    ...bullets.map((b) => `> - ${b}`),
    '>',
    `> <sub>7 days to ${ukDate(now)} · ${by}. It only sees my public activity and has strict orders not to make things up.</sub>`,
  ].join('\n');
}

const argv = process.argv.slice(2);
const mockAt = argv.indexOf('--mock');
const facts = mockAt > -1 ? JSON.parse(fs.readFileSync(argv[mockAt + 1], 'utf8')) : await gather();
console.log(`Facts: ${JSON.stringify(facts)}`);

let parsed = null;
let used = null;
const llmAt = argv.indexOf('--mock-llm');
if (llmAt > -1) {
  parsed = parse(fs.readFileSync(argv[llmAt + 1], 'utf8'));
  used = 'mock/model';
} else {
  const ids = await catalog();
  const skip = /embed|image|audio|whisper|tts|realtime|vision/i;
  const candidates = ids.length
    ? [...PREFERRED.filter((m) => ids.includes(m)), ...ids.filter((m) => !PREFERRED.includes(m) && !skip.test(m) && /gpt|phi|llama|mistral|grok|deepseek/i.test(m))]
    : PREFERRED;
  console.log(`Model candidates: ${candidates.slice(0, 5).join(', ')}`);
  for (const m of candidates.slice(0, 5)) {
    try {
      const p = parse(await chat(m, facts));
      if (p.headline && p.bullets.length) { parsed = p; used = m; break; }
      console.warn(`${m}: reply didn't match the format`);
    } catch (e) { console.warn(e.message); }
  }
}

const md = fs.readFileSync(README, 'utf8');
if (!parsed) {
  if (!(readSection(md, 'DEVLOG') || '').includes('DEVLOG:PLACEHOLDER')) { console.warn("No model answered, so last week's devlog stays."); process.exit(0); }
  parsed = fallback(facts);
}
fs.writeFileSync(README, replaceSection(md, 'DEVLOG', render(parsed, used)));
console.log(`Devlog updated using ${used || 'the fallback summary'}.`);
