#!/usr/bin/env node
// Rejects a commit that contains one of your private values: project IDs, proxy VM details, the
// clan tag, Discord IDs, tokens. Generic scanners like gitleaks can't know those are private.
// The values are read from the git-ignored files below, so this script holds none of them.
//
//   private-values.mjs --staged   staged files and changes (pre-commit)
//   private-values.mjs <file>     a commit message (commit-msg)
//   private-values.mjs --all      every tracked file (before publishing)
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();

// Values in those files that are public by design, such as the proxy's service name
const PUBLIC = new Set(['us-central1', 'us-central1-a', 'clash-proxy', 'true', 'false']);
const PUBLIC_HOSTS = new Set(['discord.com', 'discordapp.com', 'api.clashofclans.com']);
const MIN_LENGTH = 6;

// Files that must never be committed, even with git add -f
const BLOCKED_PATHS = [
  /(^|\/)\.env(\.(?!example$)[^/]+)?$/, // .env, .env.staging (not .env.example)
  /(^|\/)[^/]+\.env$/, // deploy.env
  /(^|\/)\.firebaserc$/,
  /(^|\/)\.private-values$/,
  /\.secret\.local$/,
  /^docs\/IMPLEMENTATION_PLAN\.md$/,
  /^docs\/Notes_/,
];

/** Private value (lower case) -> where it came from, e.g. "deploy.env GCP_PROJECT_ID" */
function loadPrivateValues() {
  const values = new Map();
  const add = (value, source) => {
    const v = String(value).trim();
    if (v.length < MIN_LENGTH || PUBLIC.has(v.toLowerCase())) return;
    values.set(v.toLowerCase(), source);
    // "#ABC123" also appears as "ABC123" or "%23ABC123"
    if (v.startsWith('#')) add(v.slice(1), source);
    // Discord IDs inside webhook URLs and the like
    for (const id of v.match(/\d{17,20}/g) || []) values.set(id, source);
    if (/^https?:\/\//.test(v)) {
      const host = new URL(v).hostname;
      if (!PUBLIC_HOSTS.has(host)) add(host, source);
    }
    // An IP inside a hostname, like 1-2-3-4.sslip.io
    const ip = v.match(/(?:^|[^\d])(\d{1,3})[.-](\d{1,3})[.-](\d{1,3})[.-](\d{1,3})(?![\d])/);
    if (ip) {
      values.set(ip.slice(1).join('.'), source);
      values.set(ip.slice(1).join('-'), source);
    }
  };

  const envFiles = [];
  const exampleFiles = [];
  for (const dir of ['', 'functions', 'frontend', 'proxy']) {
    if (!existsSync(join(root, dir))) continue;
    for (const name of readdirSync(join(root, dir))) {
      if (/^\.env(\..+)?$|\.env$/.test(name))
        (name.endsWith('.example') ? exampleFiles : envFiles).push(join(dir, name));
      else if (/\.env\.example$/.test(name)) exampleFiles.push(join(dir, name));
    }
  }
  const readEnv = (file) =>
    readFileSync(join(root, file), 'utf8')
      .split(/\r?\n/)
      .map((line) => line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/))
      .filter(Boolean)
      .map(([, key, value]) => [key, value.replace(/^(['"])(.*)\1$/, '$2')]);
  // A setting still holding its .example placeholder isn't private
  const placeholders = new Set(exampleFiles.flatMap((file) => readEnv(file).map(([k, v]) => `${k}=${v}`)));
  for (const file of envFiles) {
    for (const [key, value] of readEnv(file)) {
      if (!placeholders.has(`${key}=${value}`)) add(value, `${file} ${key}`);
    }
  }

  const firebaserc = join(root, '.firebaserc');
  if (existsSync(firebaserc)) {
    const walk = (node) => {
      if (typeof node === 'string') add(node, '.firebaserc');
      else if (node && typeof node === 'object') Object.values(node).forEach(walk);
    };
    walk(JSON.parse(readFileSync(firebaserc, 'utf8')));
  }

  const extra = join(root, '.private-values');
  if (existsSync(extra)) {
    for (const line of readFileSync(extra, 'utf8').split(/\r?\n/)) {
      if (line.trim() && !line.trim().startsWith('#')) add(line, '.private-values');
    }
  }
  return values;
}

function findValues(text, values) {
  const lower = text.toLowerCase();
  return [...values].filter(([v]) => lower.includes(v)).map(([, source]) => source);
}

const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const values = loadPrivateValues();
const problems = [];
const report = (where, text) => {
  for (const source of new Set(findValues(text, values))) problems.push(`${where}: a private value (from ${source})`);
};
const mode = process.argv[2];

if (mode === '--staged' || mode === '--all') {
  const files =
    mode === '--staged'
      ? git(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z']).split('\0').filter(Boolean)
      : git(['ls-files', '-z']).split('\0').filter(Boolean);
  for (const file of files) {
    if (BLOCKED_PATHS.some((re) => re.test(file))) problems.push(`${file}: this file must stay local`);
    report(`${file} (file name)`, file);
  }

  if (mode === '--staged') {
    // Only the lines this commit adds, with their line numbers
    let file = '';
    let line = 0;
    for (const row of git(['diff', '--cached', '-U0', '--no-color', '--no-ext-diff', '--diff-filter=ACMR']).split(
      '\n'
    )) {
      if (row.startsWith('+++ ')) file = row.replace(/^\+\+\+ (b\/)?/, '');
      else if (row.startsWith('@@')) line = Number(row.match(/\+(\d+)/)[1]);
      else if (row.startsWith('+')) report(`${file}:${line++}`, row.slice(1));
    }
  } else {
    for (const file of files) {
      if (!existsSync(join(root, file))) continue;
      const buf = readFileSync(join(root, file));
      if (buf.includes(0)) continue; // binary
      buf
        .toString('utf8')
        .split('\n')
        .forEach((text, i) => report(`${file}:${i + 1}`, text));
    }
  }
} else if (mode && existsSync(mode)) {
  const message = readFileSync(mode, 'utf8')
    .split('\n')
    .filter((l) => !l.startsWith('#'))
    .join('\n');
  report('commit message', message);
} else {
  console.error('Usage: private-values.mjs --staged | --all | <commit message file>');
  process.exit(2);
}

if (problems.length) {
  console.error('Blocked: found private values (not shown here). Replace them with made-up ones.\n');
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
