#!/usr/bin/env node
/*
 * Writes your most recent public push (across ALL your repos) into data.json
 * as `last_push`, which the terminal's "Last push:" login line reads.
 * Nothing is guessed: if GitHub can't be reached, or no push is found, data.json is left untouched.
 *
 * Source: GitHub's public events for your account (PushEvent, newest first).
 * Limits of that feed: public repos only, and only roughly the last 90 days / 300 events.
 *
 * Usage (run from the project folder, Node 18+):
 *   node scripts/update-last-push.mjs
 *   GITHUB_TOKEN=ghp_xxx node scripts/update-last-push.mjs     (optional, avoids rate limits)
 *   node scripts/update-last-push.mjs --from-file events.json  (parse a saved copy of the events JSON)
 */
import { readFile, writeFile } from 'node:fs/promises';

const DATA_URL = new URL('../data.json', import.meta.url);
const MAX_PAGES = 3;

const data = JSON.parse(await readFile(DATA_URL, 'utf8'));
const user = data.profile?.login;
if (!user) fail('No username found: set profile.login in data.json.');

const fromFileIdx = process.argv.indexOf('--from-file');
const events = fromFileIdx > -1
  ? JSON.parse(await readFile(process.argv[fromFileIdx + 1], 'utf8'))
  : await fetchEvents(user, process.env.GITHUB_TOKEN);

const push = latestPush(events);
if (!push) {
  console.warn(`! No PushEvent found in ${user}'s recent public events. data.json left untouched.`);
  process.exit(0);
}

data.last_push = { ...push, updated_at: new Date().toISOString() };
await writeFile(DATA_URL, JSON.stringify(data, null, 2) + '\n');
console.log(`✔ last_push: ${push.repo} on ${push.at.slice(0, 10)} written to data.json`);

// ─── Source ───────────────────────────────────────────────────────────
// Pages are newest first, so stop at the first page that contains a PushEvent.
async function fetchEvents(login, token) {
  const headers = {
    'User-Agent': 'terminal-portfolio-last-push-script',
    Accept: 'application/vnd.github+json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  const all = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await fetch(`https://api.github.com/users/${encodeURIComponent(login)}/events/public?per_page=100&page=${page}`, { headers });
    if (!res.ok) fail(`GitHub returned HTTP ${res.status} for the public events feed.`);
    const batch = await res.json();
    if (!Array.isArray(batch) || !batch.length) break;
    all.push(...batch);
    if (batch.some(isPush)) break;
  }
  return all;
}

// ─── Parsing ──────────────────────────────────────────────────────────
function isPush(e) {
  return e && e.type === 'PushEvent' && e.repo?.name && e.created_at;
}

function latestPush(list) {
  if (!Array.isArray(list)) return null;
  const e = list.filter(isPush).sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  if (!e) return null;
  return {
    repo: e.repo.name,                                       // "owner/name"
    at: e.created_at,                                        // ISO timestamp
    branch: String(e.payload?.ref || '').replace(/^refs\/heads\//, '') || null,
    url: `https://github.com/${e.repo.name}`,
  };
}

function fail(msg) {
  console.error(`✖ ${msg}`);
  process.exit(1);
}
