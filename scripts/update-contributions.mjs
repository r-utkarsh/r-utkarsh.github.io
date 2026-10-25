#!/usr/bin/env node
/*
 * Writes YOUR real GitHub contribution calendar into data.json
 * (contributions.days), which the `contrib` and `neofetch` commands render.
 * Nothing is generated or estimated — if this fails, data.json is left untouched.
 *
 * Usage (run from the project folder, Node 18+):
 *   node scripts/update-contributions.mjs
 *       Reads the public calendar at github.com/users/<you>/contributions. No token needed.
 *
 *   GITHUB_TOKEN=ghp_xxx node scripts/update-contributions.mjs        (PowerShell: $env:GITHUB_TOKEN="ghp_xxx"; node ...)
 *       Uses GitHub's GraphQL API. More reliable, and counts private contributions
 *       if your profile setting "Include private contributions" is on.
 *
 *   node scripts/update-contributions.mjs --from-file saved.html
 *       Parses a saved copy of the calendar page (useful for debugging).
 */
import { readFile, writeFile } from 'node:fs/promises';

const DATA_URL = new URL('../data.json', import.meta.url);
const data = JSON.parse(await readFile(DATA_URL, 'utf8'));
const user = data.contributions?.username || data.profile?.login;
if (!user) fail('No username found: set profile.login in data.json.');

const fromFileIdx = process.argv.indexOf('--from-file');
const token = process.env.GITHUB_TOKEN;

let result;
if (fromFileIdx > -1) result = parseCalendarHtml(await readFile(process.argv[fromFileIdx + 1], 'utf8'));
else if (token) result = await viaGraphQL(user, token);
else result = await viaPublicPage(user);

const days = result.days.sort((a, b) => a.date.localeCompare(b.date));
if (days.length < 300) {
  fail(`Only found ${days.length} days (expected ~365). GitHub's markup may have changed — try again with GITHUB_TOKEN set.`);
}
const total = result.total ?? days.reduce((s, d) => s + d.count, 0);

data.contributions = { username: user, total, updated_at: new Date().toISOString(), days };
await writeFile(DATA_URL, JSON.stringify(data, null, 2) + '\n');
console.log(`✔ ${user}: ${total} contributions across ${days.length} days written to data.json`);

// ─── Sources ──────────────────────────────────────────────────────────
async function viaPublicPage(login) {
  const res = await fetch(`https://github.com/users/${encodeURIComponent(login)}/contributions`, {
    headers: { 'User-Agent': 'terminal-portfolio-contrib-script', Accept: 'text/html' },
  });
  if (!res.ok) fail(`GitHub returned HTTP ${res.status} for the public calendar page.`);
  return parseCalendarHtml(await res.text());
}

async function viaGraphQL(login, tok) {
  const query = `query($login:String!){user(login:$login){contributionsCollection{contributionCalendar{
    totalContributions weeks{contributionDays{date contributionCount contributionLevel}}}}}}`;
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `bearer ${tok}`, 'Content-Type': 'application/json', 'User-Agent': 'terminal-portfolio-contrib-script' },
    body: JSON.stringify({ query, variables: { login } }),
  });
  if (!res.ok) fail(`GitHub GraphQL returned HTTP ${res.status}. Check your token.`);
  const json = await res.json();
  const cal = json.data?.user?.contributionsCollection?.contributionCalendar;
  if (!cal) fail(`GraphQL error: ${JSON.stringify(json.errors || json).slice(0, 300)}`);
  const levels = { NONE: 0, FIRST_QUARTILE: 1, SECOND_QUARTILE: 2, THIRD_QUARTILE: 3, FOURTH_QUARTILE: 4 };
  return {
    total: cal.totalContributions,
    days: cal.weeks.flatMap((w) => w.contributionDays).map((d) => ({
      date: d.date, count: d.contributionCount, level: levels[d.contributionLevel] ?? 0,
    })),
  };
}

// ─── Parsing ──────────────────────────────────────────────────────────
export function parseCalendarHtml(html) {
  const attr = (tag, name) => (tag.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`)) || [])[1];

  // tooltip text by the id of the day cell it describes: "3 contributions on May 4th." / "No contributions on …"
  const tips = new Map();
  for (const m of html.matchAll(/<tool-tip\b([^>]*)>([^<]*)<\/tool-tip>/g)) tips.set(attr(m[1], 'for'), m[2].trim());

  const days = [];
  for (const m of html.matchAll(/<td\b([^>]*ContributionCalendar-day[^>]*)>/g)) {
    const date = attr(m[1], 'data-date');
    if (!date) continue;
    const tip = tips.get(attr(m[1], 'id')) || '';
    const n = tip.match(/^(\d[\d,]*)\s+contribution/i);
    days.push({ date, count: n ? Number(n[1].replace(/,/g, '')) : 0, level: Number(attr(m[1], 'data-level') ?? 0) });
  }

  const t = html.match(/([\d,]+)\s+contributions?\s+in\s+the\s+last\s+year/i);
  return { days, total: t ? Number(t[1].replace(/,/g, '')) : null };
}

function fail(msg) {
  console.error(`✖ ${msg}`);
  process.exit(1);
}
