/**
 * Turns a sheet of display-name overrides into src/data/displayNames.json (2.6 step 2.3).
 *
 *   npm run import-names -- "../docs/Display Names.csv"
 *
 * The sheet (saved from Excel or Google Sheets as CSV) has three columns: Game Name, Village
 * (home or builder) and Display Name. Only add rows where a name should differ from the game's name
 * plus the automatic " (BB)" rule. Every Game Name + Village must exist in the game data, so typos
 * and outdated names are caught here, not in Discord. Then run `npm run build:game-data`.
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const GAME_DATA = path.resolve(here, '../src/data/gameData.json');
const OUT_FILE = path.resolve(here, '../src/data/displayNames.json');

/** Minimal CSV parser: commas, quoted fields, "" for a quote inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim()));
}

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error('Usage: npm run import-names -- <sheet.csv>');
  const rows = parseCsv((await readFile(file, 'utf8')).replace(/^﻿/, ''));
  const [header, ...data] = rows;
  const col = (name: string) => header.findIndex((h) => h.trim().toLowerCase() === name);
  const [gi, vi, di] = [col('game name'), col('village'), col('display name')];
  if (gi < 0 || vi < 0 || di < 0) throw new Error('The sheet needs columns "Game Name", "Village" and "Display Name"');

  const items = Object.values(JSON.parse(await readFile(GAME_DATA, 'utf8')).items) as Array<{
    name: string;
    village: string;
  }>;
  const problems: string[] = [];
  const overrides = data.map((r, n) => {
    const gameName = r[gi].trim();
    const village = r[vi].trim().toLowerCase();
    const displayName = r[di].trim();
    if (village !== 'home' && village !== 'builder')
      problems.push(`Row ${n + 2}: Village must be "home" or "builder", not "${r[vi]}"`);
    else if (!items.some((i) => i.name === gameName && i.village === village))
      problems.push(`Row ${n + 2}: no "${gameName}" in the ${village} village`);
    if (!displayName) problems.push(`Row ${n + 2}: Display Name is empty`);
    return { gameName, village, displayName };
  });
  if (problems.length) throw new Error(`Not written:\n${problems.join('\n')}`);

  await writeFile(OUT_FILE, JSON.stringify(overrides, null, 2) + '\n');
  console.log(`Wrote ${overrides.length} overrides to ${OUT_FILE}. Now run: npm run build:game-data`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
