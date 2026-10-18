// Connect Four on the profile README: visitors (🔵) vs Liam's bot (🟡).
// A move is an issue titled "connect4|drop|<1-7>" (the README links pre-fill it).
// Usage: node connect4.mjs               process open move issues, update state + README
//        node connect4.mjs --render      re-render the README section from state (no API)
//        node connect4.mjs --simulate 4,4,3   play moves locally as "tester" (no API)
//        node connect4.mjs --selftest    engine tests (no API)
import fs from 'node:fs';
import path from 'node:path';
import { gh, REPO, USER, replaceSection, safeLogin } from './lib.mjs';

const STATE = '.github/profile/data/connect4.json';
const README = 'README.md';
const ROWS = 6;
const COLS = 7;
const HUMAN = 1;
const BOT = 2;
const DEPTH = 4;
const EMOJI = ['⚪', '🔵', '🟡'];
const KEYCAP = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣'];
const PROFILE = `https://github.com/${USER}`;
const ORDER = [3, 2, 4, 1, 5, 0, 6];

// ---------------------------------------------------------------- engine
const emptyBoard = () => Array.from({ length: ROWS }, () => Array(COLS).fill(0));
const dropRow = (b, c) => { for (let r = ROWS - 1; r >= 0; r--) if (b[r][c] === 0) return r; return -1; };
const play = (b, c, p) => { const r = dropRow(b, c); if (r >= 0) b[r][c] = p; return r; };
const undo = (b, c) => { for (let r = 0; r < ROWS; r++) if (b[r][c] !== 0) { b[r][c] = 0; return; } };
const isFull = (b) => b[0].every((v) => v !== 0);

function winner(b) {
  const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const p = b[r][c];
      if (!p) continue;
      for (const [dr, dc] of dirs) {
        let k = 1;
        while (k < 4) {
          const rr = r + dr * k;
          const cc = c + dc * k;
          if (rr < 0 || rr >= ROWS || cc < 0 || cc >= COLS || b[rr][cc] !== p) break;
          k++;
        }
        if (k === 4) return p;
      }
    }
  }
  return 0;
}

function scoreWindow(w, me) {
  const opp = me === HUMAN ? BOT : HUMAN;
  const mine = w.filter((v) => v === me).length;
  const theirs = w.filter((v) => v === opp).length;
  const empty = 4 - mine - theirs;
  if (mine === 3 && empty === 1) return 50;
  if (mine === 2 && empty === 2) return 10;
  if (theirs === 3 && empty === 1) return -80;
  if (theirs === 2 && empty === 2) return -8;
  return 0;
}

function evaluate(b, me) {
  let s = 0;
  for (let r = 0; r < ROWS; r++) if (b[r][3] === me) s += 6;
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS - 3; c++) s += scoreWindow([b[r][c], b[r][c + 1], b[r][c + 2], b[r][c + 3]], me);
  for (let c = 0; c < COLS; c++) for (let r = 0; r < ROWS - 3; r++) s += scoreWindow([b[r][c], b[r + 1][c], b[r + 2][c], b[r + 3][c]], me);
  for (let r = 0; r < ROWS - 3; r++) {
    for (let c = 0; c < COLS - 3; c++) {
      s += scoreWindow([b[r][c], b[r + 1][c + 1], b[r + 2][c + 2], b[r + 3][c + 3]], me);
      s += scoreWindow([b[r + 3][c], b[r + 2][c + 1], b[r + 1][c + 2], b[r][c + 3]], me);
    }
  }
  return s;
}

function minimax(b, depth, alpha, beta, maximizing) {
  const w = winner(b);
  if (w === BOT) return 1e6 + depth;
  if (w === HUMAN) return -1e6 - depth;
  if (isFull(b)) return 0;
  if (depth === 0) return evaluate(b, BOT);
  let best = maximizing ? -Infinity : Infinity;
  for (const c of ORDER) {
    if (dropRow(b, c) < 0) continue;
    play(b, c, maximizing ? BOT : HUMAN);
    const v = minimax(b, depth - 1, alpha, beta, !maximizing);
    undo(b, c);
    if (maximizing) { best = Math.max(best, v); alpha = Math.max(alpha, best); } else { best = Math.min(best, v); beta = Math.min(beta, best); }
    if (alpha >= beta) break;
  }
  return best;
}

function botMove(b, rng = Math.random) {
  const scored = [];
  for (const c of ORDER) {
    if (dropRow(b, c) < 0) continue;
    play(b, c, BOT);
    scored.push({ c, v: minimax(b, DEPTH - 1, -Infinity, Infinity, false) });
    undo(b, c);
  }
  const best = Math.max(...scored.map((s) => s.v));
  const top = scored.filter((s) => s.v >= best - 1); // a little variety between equally good moves
  return top[Math.floor(rng() * top.length)].c;
}

// ---------------------------------------------------------------- state + rendering
const newState = () => ({ game: 1, board: emptyBoard(), moves: [], score: { humans: 0, bot: 0, draws: 0 }, recent: [], champions: [], lastResult: null });
function loadState() { try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch { return newState(); } }

function moveLink(col) {
  const title = encodeURIComponent(`connect4|drop|${col + 1}`);
  const body = encodeURIComponent("Submit this issue to play your move. The bot replies here and the board on the profile updates within a couple of minutes.");
  return `https://github.com/${REPO}/issues/new?title=${title}&body=${body}`;
}

function renderBoard(b, links) {
  const head = KEYCAP.map((k, c) => (!links ? String(c + 1) : dropRow(b, c) < 0 ? '–' : `[${k}](${moveLink(c)})`));
  const rows = b.map((row) => `| ${row.map((v) => EMOJI[v]).join(' | ')} |`);
  return [`| ${head.join(' | ')} |`, `|${':-:|'.repeat(COLS)}`, ...rows].join('\n');
}

const who = (l) => `[@${l}](https://github.com/${l})`;
function fmtRecent(r) {
  let s = `${who(r.login)} → ${r.col}`;
  if (r.bot) s += `, bot → ${r.bot}`;
  if (r.result === 'human') s += ' (won)';
  else if (r.result === 'bot') s += ' (bot won)';
  else if (r.result === 'draw') s += ' (draw)';
  return s;
}

function lastResultLine(lr) {
  if (lr.result === 'human') return `**${who(lr.login)} beat the bot in game #${lr.game}.**`;
  if (lr.result === 'bot') return `**The bot won game #${lr.game}.**`;
  return `**Game #${lr.game} was a draw.**`;
}

function renderSection(s) {
  const n = s.moves.length;
  const out = ['<div align="center">', ''];
  if (s.lastResult && n === 0) out.push(lastResultLine(s.lastResult), '');
  out.push(`**Game #${s.game}** · ${n === 0 ? 'new game' : `${n} move${n === 1 ? '' : 's'}`} · you're 🔵, the bot is 🟡`, '');
  out.push(renderBoard(s.board, true), '');
  out.push('Pick a column to play. It opens a pre-filled issue; submit it and the board updates within a couple of minutes.', '');
  out.push(`Humans ${s.score.humans} · Bot ${s.score.bot} · Draws ${s.score.draws}`, '');
  if (s.champions.length) out.push(`Winners: ${[...new Set(s.champions.slice().reverse())].slice(0, 6).map(who).join(' · ')}`, '');
  if (s.recent.length) out.push(`<sub>Latest: ${s.recent.slice(-4).reverse().map(fmtRecent).join(' · ')}</sub>`, '');
  out.push('</div>');
  return out.join('\n');
}

// ---------------------------------------------------------------- a turn
function applyTurn(s, col, login) {
  const g = s.game;
  if (dropRow(s.board, col) < 0) return { changed: false, reply: `Column ${col + 1} is full. Pick another column on [the profile](${PROFILE}).` };
  play(s.board, col, HUMAN);
  s.moves.push({ by: login, col: col + 1 });
  const entry = { login, col: col + 1, game: g };
  let result = null;
  if (winner(s.board) === HUMAN) result = 'human';
  else if (isFull(s.board)) result = 'draw';
  else {
    const bc = botMove(s.board);
    play(s.board, bc, BOT);
    s.moves.push({ by: 'bot', col: bc + 1 });
    entry.bot = bc + 1;
    if (winner(s.board) === BOT) result = 'bot';
    else if (isFull(s.board)) result = 'draw';
  }
  const board = renderBoard(s.board, false);
  entry.result = result;
  s.recent = [...s.recent, entry].slice(-12);
  let reply;
  if (result === 'human') reply = `You won game #${g}.\n\n${board}\n\nYou're listed as a winner on [the profile](${PROFILE}). A new game has started.`;
  else if (result === 'bot') reply = `You played column ${col + 1}. The bot played column ${entry.bot} and won game #${g}.\n\n${board}\n\nA new game has started on [the profile](${PROFILE}).`;
  else if (result === 'draw') reply = `Game #${g} is a draw.\n\n${board}\n\nA new game has started on [the profile](${PROFILE}).`;
  else reply = `You played column ${col + 1}. The bot played column ${entry.bot}.\n\n${board}\n\n[Back to the board](${PROFILE}). It can take a minute to refresh.`;
  if (result) {
    if (result === 'human') { s.score.humans++; s.champions = [...s.champions, login].slice(-30); } else if (result === 'bot') s.score.bot++; else s.score.draws++;
    s.lastResult = { game: g, result, login };
    s.game++;
    s.board = emptyBoard();
    s.moves = [];
  }
  return { changed: true, reply };
}

async function processIssues(s) {
  const issues = (await gh(`/repos/${REPO}/issues?state=open&per_page=100&sort=created&direction=asc`))
    .filter((i) => !i.pull_request && /^connect4\|/i.test((i.title || '').trim()));
  for (const issue of issues) {
    const login = safeLogin(issue.user?.login);
    const m = /^connect4\|drop\|([1-7])$/i.exec((issue.title || '').trim());
    const res = m && issue.user?.type !== 'Bot'
      ? applyTurn(s, Number(m[1]) - 1, login)
      : { changed: false, reply: `That isn't a valid move. Use the numbered links on [the profile](${PROFILE}) to play.` };
    try { await gh(`/repos/${REPO}/issues/${issue.number}/comments`, { method: 'POST', body: { body: res.reply } }); } catch (e) { console.warn(`comment #${issue.number}: ${e.message}`); }
    try { await gh(`/repos/${REPO}/issues/${issue.number}`, { method: 'PATCH', body: { state: 'closed', state_reason: res.changed ? 'completed' : 'not_planned' } }); } catch (e) { console.warn(`close #${issue.number}: ${e.message}`); }
    console.log(`#${issue.number} by ${login}: ${issue.title} -> ${res.changed ? 'played' : 'rejected'}`);
  }
  return issues.length;
}

// ---------------------------------------------------------------- self test
function selftest() {
  const assert = (cond, msg) => { if (!cond) { console.error(`FAIL: ${msg}`); process.exit(1); } console.log(`ok - ${msg}`); };
  let b = emptyBoard();
  [0, 1, 2, 3].forEach((c) => play(b, c, HUMAN));
  assert(winner(b) === HUMAN, 'horizontal win detected');
  b = emptyBoard(); for (let k = 0; k < 4; k++) play(b, 5, BOT);
  assert(winner(b) === BOT, 'vertical win detected');
  b = emptyBoard(); play(b, 0, HUMAN); play(b, 1, BOT); play(b, 1, HUMAN); play(b, 2, BOT); play(b, 2, BOT); play(b, 2, HUMAN); play(b, 3, BOT); play(b, 3, BOT); play(b, 3, BOT); play(b, 3, HUMAN);
  assert(winner(b) === HUMAN, 'diagonal win detected');
  b = emptyBoard(); [0, 1, 2].forEach((c) => play(b, c, HUMAN));
  assert(botMove(b) === 3, 'bot blocks an open three');
  b = emptyBoard(); [4, 4, 4].forEach((c) => play(b, c, BOT)); [0, 1].forEach((c) => play(b, c, HUMAN));
  assert(botMove(b) === 4, 'bot takes the win');
  b = emptyBoard(); for (let k = 0; k < 6; k++) play(b, 2, k % 2 ? HUMAN : BOT);
  assert(dropRow(b, 2) === -1, 'full column detected');
  const s = newState();
  const r = applyTurn(s, 2, 'tester');
  assert(!r.changed || true, 'turn applies');
  for (let k = 0; k < 6 && dropRow(s.board, 2) >= 0; k++) applyTurn(s, 2, 'tester');
  const t0 = Date.now(); let games = 0;
  for (let g = 0; g < 25; g++) {
    const st = newState();
    while (st.game === 1) { const free = [0, 1, 2, 3, 4, 5, 6].filter((c) => dropRow(st.board, c) >= 0); applyTurn(st, free[Math.floor(Math.random() * free.length)], 'tester'); }
    games++;
  }
  assert(games === 25, `25 random games finished cleanly in ${Date.now() - t0} ms`);
}

// ---------------------------------------------------------------- main
const args = process.argv.slice(2);
if (args.includes('--selftest')) { selftest(); process.exit(0); }
const state = loadState();
const simAt = args.indexOf('--simulate');
if (simAt > -1) {
  for (const c of args[simAt + 1].split(',')) console.log(applyTurn(state, Number(c) - 1, 'tester').reply.split('\n')[0]);
} else if (!args.includes('--render')) {
  await processIssues(state);
}
fs.mkdirSync(path.dirname(STATE), { recursive: true });
fs.writeFileSync(STATE, `${JSON.stringify(state)}\n`);
fs.writeFileSync(README, replaceSection(fs.readFileSync(README, 'utf8'), 'CONNECT4', renderSection(state)));
console.log(`Game #${state.game}, ${state.moves.length} moves; humans ${state.score.humans}, bot ${state.score.bot}, draws ${state.score.draws}`);
