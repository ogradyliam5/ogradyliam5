// Weekly AI devlog: GitHub Copilot (Copilot CLI, run by the workflow) summarises Liam's PUBLIC activity.
//   node devlog.mjs --gather   collect public activity -> .devlog/facts.json + .devlog/prompt.txt
//   node devlog.mjs --write    read .devlog/response.txt (if Copilot answered) -> README section
// Offline test: node devlog.mjs --write --facts f.json --response r.txt
import fs from 'node:fs';
import { gh, graphql, USER, replaceSection, ukDate } from './lib.mjs';

const README = 'README.md';
const DIR = '.devlog';
const now = new Date();
const since = new Date(now.getTime() - 7 * 864e5);
const argv = process.argv.slice(2);
const opt = (name) => { const i = argv.indexOf(name); return i > -1 ? argv[i + 1] : null; };

const RULES = `You write the weekly devlog on Liam O'Grady's GitHub profile README.
Liam is an AI Solution Architect in London who builds with Copilot Studio, Power Platform, Microsoft 365 Copilot, Azure and MCP.
Voice: British/Irish English, confident, a bit of craic: light and witty, never cringe, never mean. Tech only, nothing about his personal life.
Rules:
- Use ONLY the facts in the JSON below. Never invent projects, features, numbers, people or outcomes.
- Commit messages are terse. You may paraphrase them in plain English but must not add detail they don't contain.
- No links, no @mentions, no hashtags, no code blocks, no HTML. At most one emoji per bullet.
- contributionsThisWeek counts every contribution (commits, issues, pull requests, reviews, new repos), private repos included. Only if it is clearly bigger than all the public activity listed may you say some work happened in private repos, and never guess what it was.
- If there is no public activity at all, say it was a heads-down week, with a wink.
- Do not use any tools, do not read any files. Just answer.
Reply in exactly this format and nothing else:
HEADLINE: <at most 9 words>
- <bullet, at most 22 words>
- <bullet, at most 22 words>
- <optional third bullet, at most 22 words>`;

async function gather() {
  const facts = { window: { from: since.toISOString().slice(0, 10), to: now.toISOString().slice(0, 10) }, publicRepos: [], publicEvents: [], contributionsThisWeek: null };
  const repos = await gh(`/users/${USER}/repos?type=owner&sort=pushed&per_page=100`);
  const active = repos.filter((r) => !r.fork && !r.private && new Date(r.pushed_at) >= since).slice(0, 8);
  for (const r of active) {
    let commits = [];
    try { commits = await gh(`/repos/${r.full_name}/commits?author=${USER}&since=${since.toISOString()}&per_page=30`); } catch { /* empty repo etc. */ }
    const msgs = commits.map((c) => c.commit.message.split('\n')[0].slice(0, 120)).filter((m) => !/^merge /i.test(m));
    const isProfile = r.name.toLowerCase() === USER.toLowerCase();
    if (msgs.length) facts.publicRepos.push({ repo: isProfile ? 'this GitHub profile page' : r.name, about: isProfile ? 'the README you are reading' : r.description || '', commits: msgs.length, messages: msgs.slice(0, 10) });
  }
  try {
    const events = await gh(`/users/${USER}/events/public?per_page=100`);
    const out = [];
    for (const e of events) {
      if (new Date(e.created_at) < since) continue;
      const repo = e.repo?.name || '';
      const where = repo.toLowerCase() === `${USER}/${USER}`.toLowerCase() ? 'this profile page' : repo;
      const p = e.payload || {};
      if (e.type === 'PullRequestEvent' && p.action === 'opened') out.push(`Opened a pull request "${(p.pull_request?.title || '').slice(0, 100)}" in ${where}`);
      else if (e.type === 'PullRequestEvent' && p.action === 'closed' && p.pull_request?.merged) out.push(`Merged a pull request "${(p.pull_request?.title || '').slice(0, 100)}" in ${where}`);
      else if (e.type === 'ReleaseEvent' && p.action === 'published') out.push(`Released ${p.release?.tag_name || 'a new version'} of ${where}`);
      else if (e.type === 'CreateEvent' && p.ref_type === 'repository') out.push(where === repo ? `Created the public repo ${repo}` : 'Created this profile page');
      else if (e.type === 'PublicEvent') out.push(`Made ${repo} public`);
      else if (e.type === 'IssuesEvent' && p.action === 'opened' && /^connect4\|/i.test(p.issue?.title || '')) out.push('Played a Connect Four move against the bot on this profile page');
      else if (e.type === 'IssuesEvent' && p.action === 'opened') out.push(`Opened an issue "${(p.issue?.title || '').slice(0, 100)}" in ${where}`);
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

const clean = (s, max) => String(s)
  .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  .replace(/<[^>]*>/g, '')
  .replace(/https?:\/\/\S+/g, '')
  .replace(/[@<>|`]/g, '')
  .replace(/\*\*/g, '')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, max);

function parse(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n').map((l) => l.trim()).filter(Boolean);
  let headline = '';
  const bullets = [];
  for (const l of lines) {
    const h = l.replace(/[*_#]/g, '').match(/^\s*headline\s*:\s*(.+)$/i);
    if (h && !headline) { headline = h[1]; continue; }
    const b = l.match(/^(?:[-*•]|\d+[.)])\s+(.+)$/);
    if (b && headline) bullets.push(b[1]);
  }
  return { headline: clean(headline, 90), bullets: bullets.slice(0, 3).map((b) => clean(b, 220)).filter(Boolean) };
}

function fallback(f) {
  if (f.publicRepos.length) {
    return { headline: 'Shipping in public this week', bullets: f.publicRepos.slice(0, 3).map((r) => `${r.commits} commit${r.commits === 1 ? '' : 's'} to ${r.repo}.`) };
  }
  return { headline: 'Quiet week on the public repos', bullets: [f.contributionsThisWeek ? `${f.contributionsThisWeek} contributions logged, and the interesting stuff is still under wraps. 🤫` : 'Nothing public this week. Something is brewing. 🤫'] };
}

function render({ headline, bullets }, ai) {
  const by = ai ? 'written by GitHub Copilot, running in GitHub Actions' : "auto-generated in GitHub Actions (the AI sat this one out)";
  return [
    `> **${headline}**`,
    '>',
    ...bullets.map((b) => `> - ${b}`),
    '>',
    `> <sub>7 days to ${ukDate(now)} · ${by}. It only sees my public activity and has strict orders not to make things up.</sub>`,
  ].join('\n');
}

if (argv.includes('--gather')) {
  const facts = await gather();
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(`${DIR}/facts.json`, JSON.stringify(facts, null, 2));
  fs.writeFileSync(`${DIR}/prompt.txt`, `${RULES}\n\nFacts (JSON):\n${JSON.stringify(facts, null, 2)}\n`);
  console.log(`Facts: ${JSON.stringify(facts)}`);
} else if (argv.includes('--write')) {
  const facts = JSON.parse(fs.readFileSync(opt('--facts') || `${DIR}/facts.json`, 'utf8'));
  const respPath = opt('--response') || `${DIR}/response.txt`;
  const reply = fs.existsSync(respPath) ? fs.readFileSync(respPath, 'utf8') : '';
  let parsed = parse(reply);
  const ai = Boolean(parsed.headline && parsed.bullets.length);
  if (!ai) {
    console.warn(reply ? `Copilot's reply didn't match the format: ${reply.slice(0, 300)}` : 'No reply from Copilot; using the fallback summary.');
    parsed = fallback(facts);
  }
  fs.writeFileSync(README, replaceSection(fs.readFileSync(README, 'utf8'), 'DEVLOG', render(parsed, ai)));
  console.log(`Devlog updated (${ai ? 'GitHub Copilot' : 'fallback'}): ${parsed.headline}`);
} else {
  console.error('Use --gather or --write');
  process.exit(1);
}
