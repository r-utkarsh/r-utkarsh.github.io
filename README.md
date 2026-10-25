# terminal-portfolio

An interactive, terminal-style portfolio. Type commands or tap the chips at the bottom.

```
terminal-portfolio/
├── index.html                      page shell (meta tags, prompt, chip bar)
├── data.json                       ALL content — edit this to change what the site says
├── assets/
│   ├── term.css                    design tokens + styles
│   └── term.js                     the shell: commands, history, tab-completion, rendering
├── scripts/
│   └── update-contributions.mjs    fetches your real contribution calendar into data.json
└── package.json                    `npm start`, `npm run contrib`
```

## Run it locally

`data.json` is loaded with `fetch()`, which browsers block for `file://` pages, so serve the folder:

- VS Code → right-click `index.html` → **Open with Live Server**, or
- `npm start` (runs `npx serve .`), or
- `python -m http.server 8000` and open http://localhost:8000

If you open `index.html` straight from disk, the terminal prints this same hint instead of loading.

## Update your content

Everything is in `data.json`: `profile`, `links`, `skills`, `building`, `practice`, `featured`,
`contributions_prs`, `achievements`, `certifications`, `repos`, `activity`, `posts`.
No JavaScript changes needed. Each repo's `slug` is what you type (`cat tempadd-flux`).

## Real contribution calendar

The calendar is never generated or estimated. `contrib` and `neofetch` look for your real calendar in this order:

1. `data.json` → `contributions.days` (baked in by the script below)
2. a cached copy of the last live fetch (kept in the browser for 6 hours)
3. a live request to a public GitHub-contributions API for `profile.login`

If none of those work (offline, API down), `contrib` says so and links to your GitHub profile instead of drawing a grid.

To bake your calendar into `data.json` so it works without any third-party service:

```
npm run contrib
```

For a more reliable source, create a token (no scopes needed for public data) and run:

```
# macOS / Linux
GITHUB_TOKEN=ghp_xxx npm run contrib
# Windows PowerShell
$env:GITHUB_TOKEN="ghp_xxx"; npm run contrib
```

Re-run it whenever you want the calendar refreshed, then redeploy.

## Commands

`help` `whoami` `blog` `read <slug>` `neofetch` `ls [-a] [dir]` `cd <dir>` `cat <file|repo|post>`
`open <target> [--web]` `log [-n N]` `contrib` `achievements` `certifications` `grep <pattern>` `man <command>` `pwd` `history` `clear`

Shortcuts: `about`, `now`, `skills`, `links`, `repos`, `ll`, `git log`. Keys: Tab completes, ↑/↓ history, Ctrl+L clear,
Ctrl+U / Esc clear the line. Links like `/#blog` and `/#read/<slug>` open directly.
