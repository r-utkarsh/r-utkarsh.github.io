/*
 * Terminal portfolio — interactive fake shell.
 *
 * Structure
 *   1. Config + helpers
 *   2. Logo art + gradient
 *   3. Static tables: help, aliases, virtual files, chips
 *   4. Contribution calendar: load (data.json → cache → public API) + SVG render
 *      (data.json is filled by scripts/update-contributions.mjs)
 *   5. Shell class: output, input, history, tab-completion, commands
 *   6. Boot: fetch data.json, then start the shell
 *
 * All content lives in data.json. Nothing about the person is hard-coded here.
 */
(() => {
  'use strict';

  /* ═══ 1. Config + helpers ═════════════════════════════════════ */

  const DATA_URL = 'data.json';
  const HISTORY_KEY = 'rast0gi.v1.history';
  const HISTORY_MAX = 100;
  const CONTRIB_CACHE_KEY = 'rast0gi.v1.contrib';
  const CONTRIB_CACHE_MS = 6 * 60 * 60 * 1000;
  const CONTRIB_API = 'https://github-contributions-api.jogruber.de/v4/';
  const MOBILE_MAX = 600;

  let DATA = null;     // filled from data.json at boot
  let CONTRIB = null;  // { total, days } once the contribution calendar has loaded

  const $ = (sel) => document.querySelector(sel);

  const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC_MAP[c]);
  const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/[\s_]+/g, '-');
  const day = (s) => String(s ?? '').slice(0, 10);
  // the typeable name of a repo: data.json "slug" if present, else the name with spaces → hyphens
  const slugOf = (r) => norm(r.slug || r.name);
  // own-property lookup: typing "constructor" or "__proto__" must not resolve to Object.prototype members
  const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
  const pad2 = (n) => String(n).padStart(2, '0');
  const isMerged = (pr) => /merged/i.test(pr.status || '');
  const safeUrl = (u) => (/^(https?:|mailto:)/i.test(u) ? u : '#');
  const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const coarsePointer = () => window.matchMedia('(pointer: coarse)').matches;

  // Escapes first, then turns **bold**, `code` and [text](https://url) into markup.
  function inline(raw) {
    return esc(raw)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*(.+?)\*\*/g, '<span class="white b">$1</span>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
        '<a href="$2" target="_blank" rel="noopener">$1</a>');
  }

  function runBtn(cmd, text, extra = '') {
    return `<button type="button" class="run ${extra}" data-cmd="${esc(cmd)}">${esc(text ?? cmd)}</button>`;
  }

  function extLink(url, text) {
    return `<a href="${esc(safeUrl(url))}" target="_blank" rel="noopener">${esc(text ?? url)}</a>`;
  }

  const LANG_CLASS = {
    python: 'lang-python', typescript: 'lang-typescript', javascript: 'lang-javascript',
    rust: 'lang-rust', swift: 'lang-swift', go: 'lang-go', java: 'lang-java',
    c: 'lang-c', 'c++': 'lang-cpp', cpp: 'lang-cpp', sql: 'lang-sql',
  };
  const langClass = (l) => LANG_CLASS[String(l || '').toLowerCase()] || 'lang-none';

  function levenshtein(a, b) {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        d[i][j] = Math.min(
          d[i - 1][j] + 1,
          d[i][j - 1] + 1,
          d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
        );
      }
    }
    return d[a.length][b.length];
  }

  // "2 years, 1 month" between an ISO date and now (calendar months, not 30-day blocks)
  function sinceText(iso) {
    const s = new Date(iso);
    if (Number.isNaN(s.getTime())) return '';
    const n = new Date();
    let months = (n.getFullYear() - s.getFullYear()) * 12 + n.getMonth() - s.getMonth();
    if (n.getDate() < s.getDate()) months--;
    if (months < 1) return 'less than a month';
    const y = Math.floor(months / 12);
    const m = months % 12;
    return [y && `${y} year${y > 1 ? 's' : ''}`, m && `${m} month${m > 1 ? 's' : ''}`].filter(Boolean).join(', ');
  }

  function commonPrefix(list) {
    let p = list[0] || '';
    for (const s of list) while (!s.toLowerCase().startsWith(p.toLowerCase())) p = p.slice(0, -1);
    return p;
  }

  // Small markdown renderer for blog posts: headings, lists, fenced code, paragraphs.
  function renderMarkdown(md) {
    const lines = String(md || '').replace(/\r/g, '').split('\n');
    const out = [];
    let para = [];
    let list = null;
    const endPara = () => { if (para.length) { out.push(`<p>${inline(para.join(' '))}</p>`); para = []; } };
    const endList = () => {
      if (list) {
        out.push(`<${list.tag}>${list.items.map((t) => `<li>${inline(t)}</li>`).join('')}</${list.tag}>`);
        list = null;
      }
    };
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let m;
      if (/^```/.test(line)) {
        endPara(); endList();
        const code = [];
        while (++i < lines.length && !/^```/.test(lines[i])) code.push(lines[i]);
        out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`);
      } else if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
        endPara(); endList();
        out.push(`<div class="ph"><span class="hash">${m[1]}</span>${inline(m[2])}</div>`);
      } else if ((m = line.match(/^\s*[-*]\s+(.*)$/))) {
        endPara();
        if (!list || list.tag !== 'ul') { endList(); list = { tag: 'ul', items: [] }; }
        list.items.push(m[1]);
      } else if ((m = line.match(/^\s*\d+\.\s+(.*)$/))) {
        endPara();
        if (!list || list.tag !== 'ol') { endList(); list = { tag: 'ol', items: [] }; }
        list.items.push(m[1]);
      } else if (!line.trim()) {
        endPara(); endList();
      } else {
        endList();
        para.push(line.trim());
      }
    }
    endPara(); endList();
    return out.join('');
  }

  function loadHistory() {
    try {
      const v = JSON.parse(localStorage.getItem(HISTORY_KEY));
      return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
    } catch (e) { return []; }
  }

  function saveHistory(list) {
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(-HISTORY_MAX))); } catch (e) { /* storage blocked */ }
  }

  /* ═══ 2. Logo art + gradient ══════════════════════════════════ */
  // █ is the letter, ░ is its drop shadow (dimmed by .sh).

  // Lowercase pixel letters. Each map is 6 rows: row 0 holds the i-dot and t-top,
  // rows 1–4 are the x-height, row 5 is the g descender. '#' = filled, '.' = empty.
  
    const LOGO_WIDE = [
    '                            █████                       ███',
    '                           ░░███                       ░░░',
    ' ████████  ██████    █████ ███████    ██████   ██████  ████',
    '░░███░░███░░░░░███  ███░░  ░░███░    ███░░███ ███░░███░░███',
    ' ░███ ░░░  ███████ ░░█████  ░███    ░███ ░███░███ ░███ ░███',
    ' ░███     ███░░███  ░░░░███ ░███ ███░███ ░███░███ ░███ ░███',
    ' █████    ░████████ ██████  ░░█████ ░░██████ ░░███████ █████',
    ' ░░░░░    ░░░░░░░░ ░░░░░░    ░░░░░   ░░░░░░   ░░░░░███░░░░░',
    '                                              ███ ░███',
    '                                             ░░██████',
    '                                              ░░░░░░',
  ];
  const LOGO_NARROW = [
    '                            █████',
    '                           ░░███',
    ' ████████  ██████    █████ ███████',
    '░░███░░███░░░░░███  ███░░  ░░███░',
    ' ░███ ░░░  ███████ ░░█████  ░███',
    ' ░███     ███░░███  ░░░░███ ░███ ███',
    ' █████    ░████████ ██████  ░░█████',
    ' ░░░░░    ░░░░░░░░ ░░░░░░    ░░░░░',
    '                    ███',
    '                  ░░░',
    '  ██████   ██████  ████',
    ' ███░░███ ███░░███░░███',
    '░███ ░███░███ ░███ ░███',
    '░███ ░███░███ ░███ ░███',
    '░░██████ ░░███████ █████',
    ' ░░░░░░   ░░░░░███░░░░░',
    '          ███ ░███',
    '         ░░██████',
    '          ░░░░░░',
  ];

  // Renders a word as block text: each pixel is two characters wide, ░ is the drop shadow.
  function pixelWord(word) {
    const grid = [0, 1, 2, 3, 4, 5].map((r) =>
      [...word].map((ch) => (GLYPHS[ch] ? GLYPHS[ch][r] : '....')).join('.')
    ).map((row) => [...row].map((c) => c === '#'));
    return grid.map((row, r) => {
      let line = '  ';
      row.forEach((on, c) => {
        if (on) line += '██';
        else if (r > 0 && c > 0 && grid[r - 1][c - 1]) line += '░░';
        else line += '  ';
      });
      return line.replace(/\s+$/, '');
    });
  }

  // Row colour runs green → cyan → blue from top to bottom.
  function gradientAt(t) {
    const lerp = (a, b, f) => Math.round(a + (b - a) * f);
    const [from, to, f] = t < 0.5
      ? [[126, 231, 135], [86, 212, 221], t / 0.5]
      : [[86, 212, 221], [121, 192, 255], (t - 0.5) / 0.5];
    return `rgb(${lerp(from[0], to[0], f)},${lerp(from[1], to[1], f)},${lerp(from[2], to[2], f)})`;
  }

  function renderLogo(lines) {
    const last = Math.max(1, lines.length - 1);
    return lines.map((line, i) => {
      const body = line.split(/(░+)/).map((part) => (part.startsWith('░') ? `<span class="sh">${part}</span>` : part)).join('');
      return `<span style="color:${gradientAt(i / last)}">${body}</span>`;
    }).join('\n');
  }

  /* ═══ 3. Static tables ════════════════════════════════════════ */

  // [usage, description, command that the clickable name runs]
  // '@read' is replaced at runtime with "read <newest post slug>".
  const HELP = [
    ['help',                  'list commands',                                   'help'],
    ['whoami',                'who is this',                                     'whoami'],
    ['blog [slug]',           'list blog posts, newest first',                   'blog'],
    ['read <slug>',           'read a post right here',                          '@read'],
    ['neofetch',              'system info, but it is a person',                 'neofetch'],
    ['ls [-a] [dir]',         'list files · ls repos · ls posts',                'ls repos'],
    ['cd <dir>',              'change directory',                                'cd repos'],
    ['cat <file|repo|post>',  'print a file, a repo card or a post',             'cat about.txt'],
    ['open <target> [--web]', 'open a repo or profile in a new tab',             'open github'],
    ['log [-n N]',            'recent public activity (git log style)',          'log'],
    ['contrib',               'contribution heatmap & merged PRs',               'contrib'],
    ['achievements',          'competitive programming stats (LeetCode)',        'achievements'],
    ['certifications',        'verified certificates and credentials',           'certifications'],
    ['grep <pattern>',        'search repos and posts',                          'grep Spring'],
    ['man <command>',         'short manual for a command',                      'man ls'],
    ['pwd',                   'print working directory',                         'pwd'],
    ['history',               'command history',                                 'history'],
    ['clear',                 'clear the screen (Ctrl+L)',                       'clear'],
  ];

  // alias → real command line (extra typed args are appended)
  const ALIASES = {
    '?': 'help',
    about: 'cat about.txt',
    skills: 'cat skills.txt',
    links: 'cat links.txt',
    contact: 'cat links.txt',
    now: 'cat now.txt',
    repos: 'ls repos',
    posts: 'blog',
    ll: 'ls -la',
    dir: 'ls',
    cls: 'clear',
    fetch: 'neofetch',
  };

  // virtual files → the method that renders them
  const FILES = {
    'about.txt': 'html_about',
    'now.txt': 'html_now',
    '.plan': 'html_now',
    'skills.txt': 'html_skills',
    'links.txt': 'html_links',
    'achievements.txt': 'html_achievements',
    'certifications.txt': 'html_certs',
  };

  const CHIPS = [
    'help', 'whoami', 'about', 'blog', 'now', 'ls repos', 'log', 'neofetch',
    'contrib', 'skills', 'achievements', 'links', 'clear',
  ];

  // everything worth offering for Tab and "Did you mean?"
  const COMPLETABLE = [
    'help', 'whoami', 'about', 'neofetch', 'skills', 'now', 'contrib', 'achievements',
    'certifications', 'links', 'contact', 'blog', 'read', 'ls', 'cd', 'cat', 'open',
    'log', 'grep', 'man', 'pwd', 'history', 'clear', 'repos', 'posts',
  ];

  // names a person might type for a link: "github", "x", "twitter", "email" …
  function linkAliases(l) {
    const full = norm(l.label);
    const base = norm(l.label.replace(/\s*\(.*?\)/g, ''));
    const paren = (l.label.match(/\((.*?)\)/) || [])[1];
    return [full, base, paren && norm(paren)].filter(Boolean);
  }

  /* ═══ 4. Contribution calendar ════════════════════════════════ */

  // Accepts either shape:
  //   data.json   { total_last_year, days: [{date,count,level}] }
  //   public API  { total: { lastYear }, contributions: [{date,count,level}] }
  function normalizeContrib(raw) {
    if (!raw) return null;
    const list = Array.isArray(raw.days) ? raw.days
      : Array.isArray(raw.contributions) ? raw.contributions : null;
    if (!list) return null;
    const days = list
      .filter((d) => d && /^\d{4}-\d{2}-\d{2}$/.test(d.date))
      .map((d) => ({
        date: d.date,
        count: Number(d.count) || 0,
        level: Number.isInteger(d.level) ? Math.min(4, Math.max(0, d.level)) : null,
      }))
      .sort((a, b) => (a.date < b.date ? -1 : 1));
    if (days.length < 7) return null;
    if (days.some((d) => d.level === null)) {
      const max = Math.max(1, ...days.map((d) => d.count));
      days.forEach((d) => { if (d.level === null) d.level = d.count === 0 ? 0 : Math.min(4, Math.ceil((d.count / max) * 4)); });
    }
    const total = raw.total_last_year ?? raw.total?.lastYear ?? days.reduce((s, d) => s + d.count, 0);
    return { total, days };
  }

  // 1) calendar baked into data.json by scripts/update-data.mjs
  // 2) cached copy of a live fetch
  // 3) live fetch from a public GitHub-contributions API
  // Never invents data: if none of these work it resolves to null.
  async function loadContributions() {
    const login = DATA.profile.login;

    const baked = normalizeContrib(DATA.contributions);
    if (baked) return baked;

    try {
      const cached = JSON.parse(localStorage.getItem(CONTRIB_CACHE_KEY));
      if (cached && cached.login === login && Date.now() - cached.t < CONTRIB_CACHE_MS) return cached.data;
    } catch (e) { /* no cache */ }

    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 7000);
      const res = await fetch(`${CONTRIB_API}${encodeURIComponent(login)}?y=last`, { signal: ctl.signal });
      clearTimeout(timer);
      if (!res.ok) return null;
      const data = normalizeContrib(await res.json());
      if (!data) return null;
      try { localStorage.setItem(CONTRIB_CACHE_KEY, JSON.stringify({ t: Date.now(), login, data })); } catch (e) { /* storage blocked */ }
      return data;
    } catch (e) {
      return null;
    }
  }

  function renderHeatmap(c, availW) {
    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const gutterX = 30;
    const gutterY = 18;
    const padR = 6;

    // group into weeks (columns) that start on Sunday
    const lead = new Date(`${c.days[0].date}T00:00:00Z`).getUTCDay();
    const weeks = [];
    let col = new Array(lead).fill(null);
    for (const d of c.days) {
      col.push(d);
      if (col.length === 7) { weeks.push(col); col = []; }
    }
    if (col.length) { while (col.length < 7) col.push(null); weeks.push(col); }

    // shrink the cell pitch first; only drop the oldest weeks if it still doesn't fit
    let shown = weeks;
    let pitch = Math.min(12, Math.floor((availW - gutterX - padR) / shown.length));
    if (pitch < 6) {
      pitch = 6;
      shown = weeks.slice(-Math.max(8, Math.floor((availW - gutterX - padR) / pitch)));
    }
    const size = pitch - 2;
    const width = gutterX + shown.length * pitch + padR;
    const height = gutterY + 7 * pitch + 4;

    // month labels: where the month changes from one column to the next
    const labels = [];
    let lastMonth = -1;
    shown.forEach((w, i) => {
      const first = w.find(Boolean);
      const m = Number(first.date.slice(5, 7)) - 1;
      if (m !== lastMonth) { labels.push({ i, text: MONTHS[m] }); lastMonth = m; }
    });
    if (labels.length > 1 && labels[1].i - labels[0].i < 3) labels.shift();
    const monthSvg = labels.map((l) => `<text x="${gutterX + l.i * pitch}" y="10">${l.text}</text>`).join('');

    const dayY = (r) => gutterY + r * pitch + size - 1;
    const daySvg = [[1, 'Mon'], [3, 'Wed'], [5, 'Fri']].map(([r, t]) => `<text x="2" y="${dayY(r)}">${t}</text>`).join('');

    let cells = '';
    shown.forEach((w, i) => w.forEach((d, r) => {
      if (!d) return;
      cells += `<rect class="h${d.level}" x="${gutterX + i * pitch}" y="${gutterY + r * pitch}" width="${size}" height="${size}" rx="2" shape-rendering="crispEdges">` +
        `<title>${d.count} contribution${d.count === 1 ? '' : 's'} on ${MONTHS[Number(d.date.slice(5, 7)) - 1]} ${Number(d.date.slice(8, 10))}, ${d.date.slice(0, 4)}</title></rect>`;
    }));

    const key = [0, 1, 2, 3, 4].map((l) => `<rect class="h${l}" x="${l * 12}" y="0" width="10" height="10" rx="2" shape-rendering="crispEdges"/>`).join('');

    return `<div class="heatmap-wrap">
<svg class="heatmap-svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(c.total)} contributions in the last year">${monthSvg}${daySvg}${cells}</svg>
<div class="heatmap-legend"><span>less</span><svg class="heat" width="58" height="10" viewBox="0 0 58 10" aria-hidden="true">${key}</svg><span>more</span><span class="g" style="margin-left:12px">${esc(c.total)} contributions in the last year</span></div>
</div>`;
  }

  /* ═══ 5. Shell ════════════════════════════════════════════════ */

  class Shell {
    constructor() {
      this.outEl = $('#out');
      this.cmdEl = $('#cmd');
      this.lineEl = $('#line');
      this.chipsEl = $('#chips');
      this.termEl = $('#term');
      this.ps1El = $('#ps1');

      this.cwd = '~';
      this.history = loadHistory();
      this.histIndex = this.history.length;
      this.draft = '';
      this.typing = false;
      this.touched = false;   // true once the visitor has pressed a key or clicked a command: skip the intro
      this.currentCmd = '';   // what the user typed; used for the echo line
      this.hash = '';         // location.hash to show after the current command
      this.contribPromise = Promise.resolve(null);
    }

    /* ── data views (sorted copies, so "newest first" is always true) ── */
    repos()    { return [...(DATA.repos || [])].sort((a, b) => String(b.pushed_at).localeCompare(String(a.pushed_at))); }
    posts()    { return [...(DATA.posts || [])].sort((a, b) => String(b.date).localeCompare(String(a.date))); }
    activity() { return [...(DATA.activity || [])].sort((a, b) => String(b.at).localeCompare(String(a.at))); }
    prs()      { return DATA.contributions_prs || []; }

    /* ── lifecycle ── */
    start() {
      this.renderChips();
      this.updatePrompt();
      this.bindEvents();
      this.cmdEl.disabled = false;
      this.printMotd();
      this.contribPromise = loadContributions().then((c) => { CONTRIB = c; return c; });

      if (/^#(read\/|blog$)/.test(location.hash)) {
        this.route(true);
      } else {
        // give the calendar a moment so the first neofetch can include the total
        const wait = new Promise((r) => setTimeout(r, 700));
        Promise.race([this.contribPromise, wait]).then(() => this.route(true));
      }
      if (!coarsePointer()) this.cmdEl.focus();
    }

    route(initial) {
      const h = location.hash;
      let m;
      if ((m = h.match(/^#read\/(.+)$/))) {
        let slug = m[1];
        try { slug = decodeURIComponent(slug); } catch (e) { /* keep raw */ }
        this.exec(`read ${slug}`, { record: false });
      } else if (h === '#blog') {
        this.exec('blog', { record: false });
      } else if (initial) {
        this.startTypewriter('neofetch');
      }
    }

    /* ── prompt ── */
    promptInner() {
      const p = DATA.profile;
      return `<span class="u">${esc(p.prompt_user)}</span><span class="host">@${esc(p.domain)}</span>:<span class="p">${esc(this.cwd)}</span>$`;
    }

    updatePrompt() {
      this.ps1El.innerHTML = this.promptInner();
    }

    renderChips() {
      this.chipsEl.innerHTML = CHIPS.map((c) => `<button type="button" data-cmd="${esc(c)}">${esc(c)}</button>`).join('');
      this.chipsEl.hidden = false;
    }

    printMotd() {
      const D = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const n = new Date();
      const lines = [`Last login: ${D[n.getDay()]} ${M[n.getMonth()]} ${n.getDate()} ${pad2(n.getHours())}:${pad2(n.getMinutes())} on pts/0`];

      // data.json "last_push" is written by scripts/update-last-push.mjs (newest public push across all repos).
      // Until that script has run there is no value, and the line is simply left out.
      const lp = DATA.last_push;
      if (lp && lp.repo && lp.at) lines.push(`Last push:  ${esc(String(lp.repo).split('/').pop())} · ${day(lp.at)}`);

      const pr = this.prs().filter(isMerged).sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
      if (pr) lines.push(`Last PR merged: ${esc(pr.name)} · ${day(pr.date)}`);

      const el = document.createElement('section');
      el.className = 'entry';
      el.innerHTML = lines.map((l) => `<div class="dim">${l}</div>`).join('') +
        `<div class="dim">Type ${runBtn('help', 'help', 'cmdname')}, or press <span class="white">Tab</span> to complete.</div>`;
      this.outEl.appendChild(el);
    }

    /* ── events ── */
    bindEvents() {
      this.lineEl.addEventListener('submit', (e) => {
        e.preventDefault();
        const v = this.cmdEl.value;
        this.cmdEl.value = '';
        this.exec(v);
      });

      this.cmdEl.addEventListener('keydown', (e) => this.onKeyDown(e));

      // click empty terminal space → focus the prompt (mouse only, and not while selecting text)
      this.termEl.addEventListener('click', (e) => {
        if (e.target.closest('a, button')) return;
        if (coarsePointer()) return;
        if (String(window.getSelection())) return;
        this.cmdEl.focus();
      });

      // every button with data-cmd (chips, help names, repo names …) runs that command
      document.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-cmd]');
        if (!btn) return;
        e.preventDefault();
        this.cancelTypewriter();
        this.cmdEl.value = '';
        this.exec(btn.dataset.cmd);
        if (!coarsePointer()) this.cmdEl.focus();
      });

      window.addEventListener('hashchange', () => this.route(false));
    }

    onKeyDown(e) {
      this.touched = true;
      // any key while the intro is being typed cancels it
      if (this.typing) {
        this.cancelTypewriter();
        this.cmdEl.value = '';
        if (e.key === 'Enter') { e.preventDefault(); return; }
      }

      if (e.key === 'Tab') {
        e.preventDefault();
        this.tabComplete();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (this.histIndex > 0) {
          if (this.histIndex === this.history.length) this.draft = this.cmdEl.value;
          this.histIndex--;
          this.cmdEl.value = this.history[this.histIndex];
          this.cursorToEnd();
        }
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (this.histIndex < this.history.length) {
          this.histIndex++;
          this.cmdEl.value = this.histIndex === this.history.length ? this.draft : this.history[this.histIndex];
          this.cursorToEnd();
        }
      } else if (e.ctrlKey && e.key === 'l') {
        e.preventDefault();
        this.exec('clear');
      } else if (e.ctrlKey && e.key === 'c') {
        // keep normal copy working when something is selected
        const sel = String(window.getSelection()) || this.cmdEl.value.slice(this.cmdEl.selectionStart, this.cmdEl.selectionEnd);
        if (sel) return;
        e.preventDefault();
        this.out('', `${this.cmdEl.value}^C`);
        this.cmdEl.value = '';
      } else if (e.ctrlKey && e.key === 'u') {
        e.preventDefault();
        this.cmdEl.value = '';
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.cmdEl.value = '';
      }
    }

    cursorToEnd() {
      const n = this.cmdEl.value.length;
      setTimeout(() => this.cmdEl.setSelectionRange(n, n), 0);
    }

    /* ── intro animation ── */
    startTypewriter(cmd) {
      if (this.touched) return;   // they started typing before the intro began: don't overwrite their input
      if (reducedMotion()) { this.exec(cmd, { record: false }); return; }
      this.typing = true;
      this.cmdEl.value = '';
      let i = 0;
      const step = () => {
        if (!this.typing) return;
        if (i < cmd.length) {
          this.cmdEl.value += cmd[i++];
          setTimeout(step, 45);
        } else {
          setTimeout(() => {
            if (!this.typing) return;
            this.typing = false;
            this.cmdEl.value = '';
            this.exec(cmd, { record: false });
          }, 180);
        }
      };
      setTimeout(step, 250);
    }

    cancelTypewriter() { this.typing = false; this.touched = true; }

    /* ── output ── */
    // Prints the echoed prompt line plus an optional result block; returns the block.
    out(html, cmd = this.currentCmd) {
      const sec = document.createElement('section');
      sec.className = 'entry';
      sec.innerHTML =
        `<div class="echo"><span class="ps1">${this.promptInner()}</span><span class="cmd-echo">${esc(cmd)}</span></div>` +
        (html ? `<div class="blk">${html}</div>` : '');
      this.outEl.appendChild(sec);
      this.scrollToBottom();
      return sec.querySelector('.blk');
    }

    scrollToBottom() {
      this.lineEl.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
    }

    syncHash() {
      const base = location.pathname + location.search;
      if (base + this.hash !== base + location.hash) window.history.replaceState(null, '', base + this.hash);
    }

    /* ── command router ── */
    exec(raw, { record = true } = {}) {
      const str = String(raw || '').trim();
      if (!str) { this.currentCmd = ''; this.out(''); return; }

      if (record) {
        if (this.history[this.history.length - 1] !== str) { this.history.push(str); saveHistory(this.history); }
      }
      this.histIndex = this.history.length;
      this.draft = '';

      this.currentCmd = str;
      this.hash = '';

      let [head, ...args] = str.split(/\s+/);
      head = head.toLowerCase();
      if (own(ALIASES, head)) {
        const [h, ...pre] = ALIASES[head].split(/\s+/);
        head = h;
        args = [...pre, ...args];
      }

      const fn = this[`cmd_${head}`];
      if (typeof fn !== 'function') { this.notFound(head); return; }

      try {
        fn.call(this, args);
      } catch (err) {
        console.error(err);
        this.out(`<span class="r">error: ${esc(err.message || err)}</span>`);
      }
      this.syncHash();
    }

    notFound(head) {
      let suggestion = '';
      let best = 3;
      for (const k of COMPLETABLE) {
        const d = levenshtein(head, k);
        if (d < best) { best = d; suggestion = k; }
      }
      const msg = `<span class="dim">command not found: ${esc(head)}.</span> ` + (suggestion
        ? `<span class="dim">Did you mean</span> ${runBtn(suggestion, suggestion, 'cmdname')}<span class="dim">?</span>`
        : `<span class="dim">Type</span> ${runBtn('help', 'help', 'cmdname')} <span class="dim">for commands.</span>`);
      this.out(msg);
    }

    /* ═══ renderers (return HTML, never print) ═══ */

    html_about() {
      const p = DATA.profile;
      const paras = (p.about || []).map((t, i, all) => {
        const tail = i === all.length - 1 ? ` → ${runBtn('cat links.txt', 'links.txt')}` : '';
        return `<div class="dim mt">${inline(t)}${tail}</div>`;
      }).join('');
      return `<div><span class="g b">${esc(p.name)}</span> <span class="dim">(@${esc(p.login)})</span></div>` +
        `<div class="white">${esc(p.bio)}</div>` +
        `<div class="dim mt">${esc(p.tagline)}</div>${paras}`;
    }

    html_now() {
      const building = DATA.building || [];
      const practice = DATA.practice || [];
      let html = `<div class="g b">● currently building</div>`;
      html += building.map((it) =>
        `<div class="mt4"><span class="bl b">${esc(it.name)}</span> <span class="dim">· ${esc((it.stack || []).join(' · '))}</span></div>` +
        `<div class="dim ind">${esc(it.summary)}</div>` +
        (it.url ? `<div class="ind">${extLink(it.url, it.url.replace(/^https?:\/\//, ''))}</div>` : '')
      ).join('');
      if (practice.length) {
        html += `<div class="g b mt10">● daily practice &amp; open source</div>`;
        html += practice.map((it) =>
          `<div class="mt4"><span class="bl b">${esc(it.name)}</span> <span class="dim">· ${esc(it.meta)}</span></div>` +
          `<div class="dim ind">${esc(it.summary)}</div>`
        ).join('');
      }
      return html;
    }

    html_skills() {
      return (DATA.skills || []).map((s) =>
        `<div class="row skill"><span class="p b">${esc(s.area)}</span><span class="white">${esc((s.items || []).join(', '))}</span></div>`
      ).join('');
    }

    html_links() {
      return (DATA.links || []).map((l) =>
        `<div class="row link"><span><span class="g">»</span> <span class="white b">${esc(l.label)}</span></span>${extLink(l.url, l.display || l.url)}</div>`
      ).join('');
    }

    html_achievements() {
      return `<div class="g b">Achievements &amp; Problem Solving</div>` + (DATA.achievements || []).map((a) =>
        `<div class="mt"><span class="y b">★</span> <span class="bl b">${esc(a.title)}</span></div>` +
        `<div class="dim ind">${esc(a.desc)}</div>` +
        `<div class="ind">${extLink(a.url, /leetcode/i.test(a.url) ? 'View LeetCode Profile →' : 'View →')}</div>`
      ).join('');
    }

    html_certs() {
      return `<div class="g b">Verified Certifications</div>` + (DATA.certifications || []).map((c) =>
        `<div><span class="dim">●</span> <span class="g">${esc(c.issuer)}</span>: <span class="white">${esc(c.title)}</span></div>`
      ).join('');
    }

    html_repos(list, header, hl = esc) {
      const rows = list.map((r) =>
        `<div class="row repo">` +
        `<span class="dim">${day(r.pushed_at)}</span>` +
        `<span class="${langClass(r.language)}">${esc(r.language || '—')}</span>` +
        `<span class="dim">★ ${Number(r.stars) || 0}</span>` +
        `<span class="nowrap">${runBtn(`cat ${slugOf(r)}`, r.name, 'cmdname')}</span>` +
        `<span class="dim desc clip">${hl(r.description || '')}</span></div>`
      ).join('');
      return `<div class="dim">${header}</div>${rows}`;
    }

    html_repoCard(r) {
      const topics = (r.topics || []).length ? `<div class="ind c mt4">topics: ${esc(r.topics.join(', '))}</div>` : '';
      const site = r.homepage ? `<div class="ind dim">site: ${extLink(r.homepage, r.homepage.replace(/^https?:\/\//, ''))}</div>` : '';
      return `<div class="meta"><span class="bl b">${esc(r.name)}</span><span class="${langClass(r.language)}">${esc(r.language || '')}</span>` +
        `<span class="dim">★ ${Number(r.stars) || 0} · pushed ${day(r.pushed_at)}</span></div>` +
        `<div class="ind mt4">${esc(r.description)}</div>${topics}` +
        `<div class="ind dim">repo: ${extLink(r.url, r.url.replace(/^https?:\/\//, ''))}</div>${site}` +
        `<div class="ind mt">→ ${runBtn(`open ${slugOf(r)}`, `open ${slugOf(r)}`, 'cmdname')}</div>`;
    }

    html_blog() {
      const posts = this.posts();
      const newest = posts[0];
      return `<div class="dim">total ${posts.length} · newest first</div>` + posts.map((p) =>
        `<div class="row post"><span class="dim">${day(p.date)}</span><span>${runBtn(`read ${p.slug}`, p.title, 'bl')}</span></div>` +
        `<div class="dim ind12">${esc(p.summary)}</div>`
      ).join('') +
        `<div class="dim sp">Type ${runBtn(newest ? `read ${newest.slug}` : 'blog', 'read <slug>', 'cmdname')} to read any post right here.</div>`;
    }

    html_post(p) {
      return `<article class="post">` +
        `<div class="bl b ptitle">${esc(p.title)}</div>` +
        `<div class="dim">${day(p.date)} · ${esc(p.minutes)} min read · tags: ${(p.tags || []).map(esc).join(', ')}</div>` +
        `<div class="rule"></div>${renderMarkdown(p.content)}<div class="rule"></div>` +
        `<div>${runBtn('blog', '← back to blog', 'cmdname')} · permalink: <span class="dim">#read/${esc(p.slug)}</span></div>` +
        `</article>`;
    }

    html_neofetch() {
      const p = DATA.profile;
      const host = `${p.prompt_user}@${p.domain}`;
      const sep = '─'.repeat(Math.max(18, host.length + 2));
      const skill = (area) => ((DATA.skills || []).find((s) => s.area === area) || { items: [] }).items;
      const prs = this.prs();
      const merged = prs.filter(isMerged).length;
      const inReview = prs.length - merged;

      const rows = [
        ['Name', `${esc(p.name)} (${esc(p.login)})`],
        ['Role', esc(p.bio)],
        p.focus && ['Focus', esc(p.focus)],
        sinceText(p.created_at) && ['Uptime', `${esc(sinceText(p.created_at))} on GitHub`],
        p.leetcode && ['LeetCode', esc(p.leetcode)],
        prs.length && ['OSS PRs', `${merged} merged${inReview ? `, ${inReview} in review` : ''} (${esc(prs.map((x) => x.name).join(', '))})`],
        ['Packages', `${(DATA.repos || []).length} repos, ${(DATA.posts || []).length} posts`],
        skill('Languages').length && ['Langs', esc(skill('Languages').join(', '))],
        skill('Backend').length && ['Backend', esc(skill('Backend').slice(0, 3).join(', '))],
        (DATA.building || [])[0] && ['Building', esc(DATA.building[0].name)],
        CONTRIB && ['Contribs', `${esc(CONTRIB.total)} contributions / last year`],
        this.posts()[0] && ['Latest post', `${esc(this.posts()[0].title)} (${day(this.posts()[0].date)})`],
        ['Social', esc((DATA.links || []).filter((l) => !/^mailto:/i.test(l.url)).map((l) => l.label.replace(/\s*\(.*\)/, '')).join(' · '))],
      ].filter(Boolean);

      const swatches = ['r', 'o', 'y', 'g', 'c', 'bl', 'pu', 'h'].map((c) => `<span class="swatch-${c}"></span>`).join('');

      return `<div class="fetch">` +
        `<div class="logo logo-wide" role="img" aria-label="rastogi in block letters">${renderLogo(LOGO_WIDE)}</div>` +
        `<div class="logo logo-narrow" role="img" aria-label="rastogi in block letters">${renderLogo(LOGO_NARROW)}</div>` +
        `<div class="motto"><div>${esc(p.tagline)}</div><div>${esc(p.proof.text)} — ${extLink(p.proof.url, p.proof.link)}</div></div>` +
        `<div class="fetch-info">` +
        `<span class="g b fi-title">${esc(host)}</span><span class="dim fi-title">${sep}</span>` +
        rows.map(([k, v]) => `<span class="g b">${esc(k)}</span><span class="white">${v}</span>`).join('') +
        `<div class="swatches" aria-hidden="true">${swatches}</div>` +
        `</div></div>`;
    }

    /* ═══ commands (cmd_<name>) ═══ */

    cmd_help() {
      const newest = this.posts()[0];
      const rows = HELP.map(([usage, desc, run]) => {
        const target = run === '@read' ? (newest ? `read ${newest.slug}` : 'blog') : run;
        return `<div class="row help">${runBtn(target, usage, 'cmdname')}<span class="dim">${esc(desc)}</span></div>`;
      }).join('');
      const shortcuts = [['about'], ['blog'], ['now'], ['skills'], ['links'], ['ls repos', 'repos']]
        .map(([c, t]) => runBtn(c, t || c, 'cmdname')).join(' · ');
      this.out(
        `<div class="dim">commands — type them, or tap them. Tab completes, ↑/↓ walks history.</div>` +
        `<div class="sp"></div>${rows}<div class="dim sp">shortcuts: ${shortcuts}</div>`
      );
    }

    cmd_whoami() {
      const p = DATA.profile;
      this.out(
        `<div><span class="white b">${esc(p.name)}</span> · <span class="g">${esc(p.bio)}</span></div>` +
        `<div class="dim">${esc(p.tagline)}</div>` +
        `<div class="dim">try ${runBtn('cat about.txt')}, ${runBtn('ls repos')} or ${runBtn('neofetch')}</div>`
      );
    }

    cmd_neofetch() { this.out(this.html_neofetch()); }

    cmd_blog(args) {
      if (args.length) { this.cmd_read(args); return; }
      this.hash = '#blog';
      this.out(this.html_blog());
    }

    cmd_read(args) {
      if (!args.length) {
        this.out(`<span class="dim">Usage: read &lt;slug&gt;. Type ${runBtn('blog', 'blog', 'cmdname')} to list available posts.</span>`);
        return;
      }
      const post = this.posts().find((p) => norm(p.slug) === norm(args.join(' ')));
      if (!post) {
        this.out(`<span class="r">Post not found: ${esc(args.join(' '))}.</span> <span class="dim">Type</span> ${runBtn('blog', 'blog', 'cmdname')} <span class="dim">to list posts.</span>`);
        return;
      }
      this.showPost(post);
    }

    showPost(post) {
      this.hash = `#read/${post.slug}`;
      this.out(this.html_post(post));
    }

    cmd_ls(args) {
      const flags = args.filter((a) => a.startsWith('-')).join('');
      const showAll = flags.includes('a');
      const typed = norm((args.find((a) => !a.startsWith('-')) || '').replace(/^~\/?/, '').replace(/\/+$/, ''));
      const where = typed || (this.cwd === '~' ? '' : this.cwd.slice(2));

      if (where === 'repos') {
        const list = this.repos();
        this.out(this.html_repos(list, `total ${list.length} · my repos · newest push first`));
        return;
      }
      if (where === 'posts') { this.out(this.html_blog()); return; }
      if (where) { this.out(`<span class="r">ls: cannot access '${esc(where)}': No such file or directory</span>`); return; }

      const files = ['about.txt', 'now.txt', 'skills.txt', 'links.txt', 'achievements.txt', 'certifications.txt', 'repos/', 'posts/'];
      if (showAll) files.unshift('.plan');
      this.out(`<div class="ls">${files.map((f) => (f.endsWith('/')
        ? runBtn(`cd ${f.slice(0, -1)}`, f, 'bl')
        : runBtn(`cat ${f}`, f, 'file'))).join('')}</div>`);
    }

    cmd_cd(args) {
      const dir = (args[0] || '').replace(/\/+$/, '');
      const rel = norm(dir.replace(/^(~|\/home\/[^/]+)\/?/, ''));
      let next = null;
      if (!dir || dir === '~' || dir === '/' || dir === '..') next = '~';
      else if (dir === '.') next = this.cwd;
      else if (rel === '') next = '~';
      else if (rel === 'repos' || rel === 'posts') next = `~/${rel}`;

      if (!next) { this.out(`<span class="r">cd: no such file or directory: ${esc(dir)}</span>`); return; }
      this.out('');            // echo with the prompt as it was *before* the cd
      this.cwd = next;
      this.updatePrompt();
    }

    cmd_pwd() {
      const base = `/home/${DATA.profile.prompt_user}`;
      this.out(esc(this.cwd === '~' ? base : `${base}/${this.cwd.slice(2)}`));
    }

    cmd_cat(args) {
      if (!args.length) { this.out(`<span class="dim">Usage: cat &lt;file|repo|post&gt;</span>`); return; }
      const raw = args.join(' ');
      const clean = norm(raw.replace(/^(~\/|\.\/|repos\/|posts\/)+/i, ''));

      if (clean === 'repos' || clean === 'posts') { this.out(`<span class="r">cat: ${esc(raw)}: Is a directory</span>`); return; }

      const repo = this.repos().find((r) => slugOf(r) === clean || norm(r.name) === clean);
      if (repo) { this.out(this.html_repoCard(repo)); return; }

      const post = this.posts().find((p) => norm(p.slug) === clean);
      if (post) { this.showPost(post); return; }

      if (own(FILES, clean)) { this.out(this[FILES[clean]]()); return; }

      this.out(`<span class="r">cat: ${esc(raw)}: No such file or directory</span>`);
    }

    cmd_open(args) {
      const web = args.includes('--web');
      const target = norm(args.filter((a) => a !== '--web').join(' '));
      if (!target) { this.out(`<span class="dim">Usage: open &lt;repo|post|github|leetcode|linkedin|x|email&gt; [--web]</span>`); return; }

      const post = this.posts().find((p) => norm(p.slug) === target);
      if (post) {
        if (!web) { this.showPost(post); return; }
        // --web: the post's permalink in a new browser tab instead of reading it inline
        const permalink = `${location.href.split('#')[0]}#read/${post.slug}`;
        window.open(permalink, '_blank', 'noopener');
        this.out(`<span class="dim">Opening ${extLink(permalink, permalink)}…</span>`);
        return;
      }

      const link = (DATA.links || []).find((l) => linkAliases(l).includes(target));
      const repo = this.repos().find((r) => slugOf(r) === target || norm(r.name) === target);
      const url = (link && link.url) || (repo && repo.url);
      if (!url) { this.out(`<span class="r">Cannot resolve target: ${esc(target)}</span>`); return; }

      window.open(safeUrl(url), '_blank', 'noopener');
      this.out(`<span class="dim">Opening ${extLink(url, url)}…</span>`);
    }

    cmd_log(args) {
      let limit = 12;
      const i = args.indexOf('-n');
      if (i >= 0 && args[i + 1]) limit = Math.max(1, parseInt(args[i + 1], 10) || 12);

      const rows = this.activity().slice(0, limit).map((a) => {
        let kind;
        let detail;
        if (a.kind === 'push') {
          kind = '<span class="g">pushed</span>';
          detail = `${extLink(a.url, a.repo)} <span class="dim">${esc(a.count)}× to ${esc(a.branch || 'main')}</span>`;
        } else if (a.kind === 'pr') {
          kind = `<span class="p">${esc(a.action || 'merged')}</span>`;
          detail = `${extLink(a.url, a.repo)} <span class="dim">#${esc(a.number)} ${esc(a.title)}</span>`;
        } else {
          kind = '<span class="dim">event</span>';
          detail = esc(a.repo);
        }
        return `<div class="row log"><span class="y">*</span><span class="dim">${day(a.at)}</span>${kind}<span>${detail}</span></div>`;
      }).join('');
      this.out(`${rows}<div class="dim sp">(public events · ${extLink(DATA.profile.html_url, 'full activity')})</div>`);
    }

    cmd_contrib() {
      const prs = this.prs();
      // who you contributed *to*: the upstream owners in your PR activity (kyechan99/…, Bandmators/…),
      // falling back to the owners in contributions_prs when activity has none
      const ownerOf = (r) => String(r).split('/')[0];
      const upstream = this.activity().filter((a) => a.kind === 'pr' && a.repo).map((a) => ownerOf(a.repo));
      const owners = [...new Set((upstream.length ? upstream : prs.map((p) => ownerOf(p.repo))).filter(Boolean))];

      let html = `<div class="g b">Open Source Contributions &amp; Heatmap</div>`;
      html += prs.map((pr) => {
        const merged = isMerged(pr);
        const meta = [pr.number ? `#${esc(pr.number)}` : '', pr.date ? day(pr.date) : ''].filter(Boolean).join(' · ');
        return `<div class="mt4"><span class="${merged ? 'g' : 'y'}">${merged ? '✔ Merged PR:' : '◌ PR in review:'}</span> ${extLink(pr.url, pr.repo)}` +
          `${meta ? ` <span class="dim">· ${meta}</span>` : ''}</div>` +
          (pr.title ? `<div class="dim ind">${esc(pr.title)}</div>` : '');
      }).join('');
      if (owners.length) html += `<div class="dim mt4">Contributing to ${owners.map((o) => `@${esc(o)}`).join(' and ')}.</div>`;
      html += `<div class="heat-slot dim mt10">loading contribution graph…</div>`;

      const blk = this.out(html);
      this.contribPromise.then((c) => {
        const slot = blk && blk.querySelector('.heat-slot');
        if (!slot) return;
        slot.className = 'heat-slot';
        slot.innerHTML = c
          ? renderHeatmap(c, this.outEl.clientWidth)
          : `<div class="dim">Couldn't load the contribution graph right now. See it on ${extLink(DATA.profile.html_url, 'GitHub')} →</div>`;
        this.scrollToBottom();
      });
    }

    cmd_achievements()   { this.out(this.html_achievements()); }
    cmd_certifications() { this.out(this.html_certs()); }

    cmd_grep(args) {
      const q = args.join(' ').trim();
      if (!q) { this.out(`<span class="dim">Usage: grep &lt;pattern&gt;</span>`); return; }

      const ql = q.toLowerCase();
      const re = new RegExp(escRe(esc(q)), 'gi');      // pattern is matched against already-escaped text
      const hl = (s) => esc(s).replace(re, (m) => `<mark>${m}</mark>`);

      const repos = this.repos().filter((r) =>
        [r.name, r.description, r.language, ...(r.topics || [])].some((f) => String(f || '').toLowerCase().includes(ql)));

      const posts = this.posts().map((p) => {
        const lines = String(p.content || '').split('\n')
          .map((t, i) => [i + 1, t]).filter(([, t]) => t.trim() && t.toLowerCase().includes(ql));
        const inTitle = p.title.toLowerCase().includes(ql);
        return (lines.length || inTitle) ? { p, lines: lines.slice(0, 5), inTitle } : null;
      }).filter(Boolean);

      if (!repos.length && !posts.length) {
        this.out(`<span class="dim">No matches found for "${esc(q)}".</span>`);
        return;
      }

      let html = '';
      if (repos.length) html += this.html_repos(repos, `${repos.length} repo${repos.length === 1 ? '' : 's'}`, hl);
      if (posts.length) {
        html += `<div class="dim${repos.length ? ' sp' : ''}">${posts.length} post${posts.length === 1 ? '' : 's'}</div>`;
        html += posts.map(({ p, lines, inTitle }) =>
          `<div class="mt4">${runBtn(`read ${p.slug}`, p.title, 'bl')} <span class="dim">(${esc(p.slug)})</span></div>` +
          (lines.length
            ? lines.map(([n, t]) => `<div class="ind clip"><span class="dim">${n}:</span> ${hl(t.trim())}</div>`).join('')
            : (inTitle ? `<div class="dim ind">matched in title</div>` : ''))
        ).join('');
      }
      this.out(html);
    }

    cmd_history() {
      this.out(this.history.map((c, i) =>
        `<div class="row hist"><span class="dim">${i + 1}</span><span class="white">${esc(c)}</span></div>`
      ).join(''));
    }

    cmd_clear() {
      this.outEl.innerHTML = '';
      this.cmdEl.value = '';
    }

    cmd_man(args) {
      const t = (args[0] || '').toLowerCase();
      if (!t) { this.out(`<span class="dim">What manual page do you want? Try ${runBtn('man ls', 'man ls', 'cmdname')}</span>`); return; }
      const base = own(ALIASES, t) ? ALIASES[t].split(/\s+/)[0] : t;
      const row = HELP.find(([u]) => u.split(/\s+/)[0] === base);
      if (!row) { this.out(`<span class="r">No manual entry for ${esc(t)}</span>`); return; }
      const aliases = Object.keys(ALIASES).filter((a) => ALIASES[a].split(/\s+/)[0] === base);
      this.out(
        `<div class="g b">NAME</div><div class="ind">${esc(base)} — ${esc(row[1])}</div>` +
        `<div class="g b mt10">SYNOPSIS</div><div class="ind">${esc(row[0])}</div>` +
        (aliases.length ? `<div class="g b mt10">ALIASES</div><div class="ind">${esc(aliases.join(', '))}</div>` : '')
      );
    }

    cmd_git(args) {
      if (args[0] === 'log') { this.cmd_log(args.slice(1)); return; }
      this.out(`<span class="dim">git: only ${runBtn('git log', 'git log', 'cmdname')} is available here.</span>`);
    }

    /* hidden extras */
    cmd_echo(args) { this.out(esc(args.join(' '))); }
    cmd_date()     { this.out(esc(new Date().toString())); }
    cmd_uname()    { this.out(`Linux ${esc(DATA.profile.domain)} 6.8.0 x86_64 GNU/Linux`); }
    cmd_sudo()     { this.out(`<span class="r">Permission denied: user ${esc(DATA.profile.prompt_user)} is not in the sudoers file. This incident will be reported.</span>`); }
    cmd_exit()     { this.out(`<span class="dim">[Process completed] — reload to start again.</span>`); }
    cmd_vim()      { this.out(`<span class="dim">Tip: try ${runBtn('cat about.txt')} to read files right in the terminal!</span>`); }
    cmd_nano()     { this.cmd_vim(); }

    /* ═══ tab completion ═══ */

    candidatesFor(head) {
      const posts = this.posts().map((p) => p.slug);
      const repos = (DATA.repos || []).map(slugOf);
      switch (head) {
        case 'read':
        case 'blog': return posts;
        case 'cat':  return [...Object.keys(FILES).filter((f) => !f.startsWith('.')), ...repos, ...posts];
        case 'cd':   return ['repos', 'posts', '..', '~'];
        case 'ls':   return ['repos', 'posts', '-a', '-la'];
        case 'open': return [...(DATA.links || []).flatMap(linkAliases), ...repos, ...posts];
        case 'man':  return COMPLETABLE;
        default:     return [];
      }
    }

    tabComplete() {
      const input = this.cmdEl.value;
      const tokens = input.trimStart().split(/\s+/);
      const second = tokens.length > 1;

      const head = (tokens[0] || '').toLowerCase();
      const resolvedHead = own(ALIASES, head) ? ALIASES[head].split(/\s+/)[0] : head;
      const candidates = second ? this.candidatesFor(resolvedHead) : COMPLETABLE;
      const prefix = second ? tokens[tokens.length - 1] : tokens[0];
      const build = (word) => (second ? `${tokens.slice(0, -1).join(' ')} ${word}` : word);

      const matches = [...new Set(candidates)].filter((c) => c.toLowerCase().startsWith(prefix.toLowerCase()));
      if (matches.length === 1) {
        this.cmdEl.value = `${build(matches[0])} `;
      } else if (matches.length > 1) {
        const cls = second ? 'bl' : 'g';
        this.out(`<div class="cands">${matches.map((m) => `<span class="${cls}">${esc(m)}</span>`).join('')}</div>`, input);
        const common = commonPrefix(matches);
        if (common.length > prefix.length) this.cmdEl.value = build(common);
      }
    }
  }

  /* ═══ 6. Boot ═════════════════════════════════════════════════ */

  function showLoadError(err) {
    $('#out').innerHTML =
      `<section class="entry"><div class="r">error: couldn't load data.json (${esc(err && err.message ? err.message : err)})</div>` +
      `<div class="dim mt4">Reload the page. If you opened index.html straight from disk, browsers block that: serve the folder instead (VS Code “Live Server”, or <code>npx serve</code>).</div>` +
      `<div class="mt4">GitHub: <a href="https://github.com/r-utkarsh">github.com/r-utkarsh</a></div></section>`;
    $('#line').hidden = true;
  }

  async function boot() {
    try {
      const res = await fetch(DATA_URL, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      DATA = await res.json();
      if (!DATA || !DATA.profile) throw new Error('missing "profile"');
    } catch (err) {
      showLoadError(err);
      return;
    }
    new Shell().start();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
