# Task list

I add tasks here. When I say "complete tasks", work through them in order and tick them off.

## Open

- [ ] Replace the fake dates in `log` (`data.json` → `activity`) with real dates from your GitHub activity, and remove any entries that can't be verified.

## Done

- [x] Neofetch and skills: show JavaScript and TypeScript in full (no JS/TS). C stays as it is.
- [x] Rename "Medical Store Digital Catalogue" to "Digital Medical Catalogue" everywhere (`featured` and `repos` display names). The repo slug and GitHub URL are unchanged so links still work.
- [x] Create a GitHub Action that runs `scripts/update-contributions.mjs` every day and commits the updated `data.json` back to the repo.
- [x] Change the login line from `ttys001` to `pts/0` in `term.js` (`printMotd`). Also change `uname` from "Darwin" to a Linux-style output.
- [x] "Last push" line: show the most recent push across ALL your GitHub repos (repo name and date), and write it to `data.json`. Source: GitHub's public events for your account (PushEvent, newest first). Needs new code. The current script only fetches contribution counts.
