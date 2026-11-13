#!/usr/bin/env node
/*
 * Writes the account's owned public repositories into data.json.
 * Forks are excluded so the portfolio highlights projects owned by the account.
 *
 * Usage (run from the project folder, Node 18+):
 *   node scripts/update-repos.mjs
 *   GITHUB_TOKEN=ghp_xxx node scripts/update-repos.mjs
 */
import { readFile, writeFile } from 'node:fs/promises';

const DATA_URL = new URL('../data.json', import.meta.url);
const data = JSON.parse(await readFile(DATA_URL, 'utf8'));
const user = data.profile?.login;

if (!user) fail('No username found: set profile.login in data.json.');

const headers = {
  Accept: 'application/vnd.github+json',
  'User-Agent': 'terminal-portfolio-repo-script',
  ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
};

const repositories = [];
for (let page = 1; page <= 10; page++) {
  const res = await fetch(
    `https://api.github.com/users/${encodeURIComponent(user)}/repos?per_page=100&page=${page}&sort=pushed`,
    { headers },
  );
  if (!res.ok) fail(`GitHub returned HTTP ${res.status} for the repository list.`);

  const batch = await res.json();
  if (!Array.isArray(batch)) fail('GitHub returned an invalid repository list.');
  repositories.push(...batch);
  if (batch.length < 100) break;
}

const oldByName = new Map((data.repos || []).map((repo) => [repo.name.toLowerCase(), repo]));
const repos = repositories
  .filter((repo) => !repo.fork && repo.owner?.login?.toLowerCase() === user.toLowerCase())
  .map((repo) => {
    const old = oldByName.get(repo.name.toLowerCase());
    return {
      name: repo.name,
      description: repo.description || old?.description || '',
      language: repo.language,
      stars: repo.stargazers_count,
      archived: repo.archived,
      topics: repo.topics || [],
      homepage: repo.homepage || null,
      url: repo.html_url,
      created_at: repo.created_at,
      pushed_at: repo.pushed_at,
      slug: repo.name.toLowerCase(),
    };
  })
  .sort((a, b) => String(b.pushed_at).localeCompare(String(a.pushed_at)));

if (!repos.length) fail(`No owned public repositories found for ${user}.`);

data.repos = repos;
data.repos_updated_at = new Date().toISOString();
await writeFile(DATA_URL, JSON.stringify(data, null, 2) + '\n');
console.log(`✔ ${user}: ${repos.length} repositories written to data.json`);

function fail(message) {
  console.error(`✖ ${message}`);
  process.exit(1);
}
