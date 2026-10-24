import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseCsv } from '../scripts/importNameSheet.mts';

describe('display-name sheet importer (2.6)', () => {
  it('parses quoted CSV fields', () => {
    expect(parseCsv('Game Name,Village,Display Name\r\n"Cannon",builder,"Cannon, BB"\n')).toEqual([
      ['Game Name', 'Village', 'Display Name'],
      ['Cannon', 'builder', 'Cannon, BB'],
    ]);
  });

  it('refuses a sheet with a name that is not in the game data, and writes nothing', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'names-'));
    const sheet = path.join(dir, 'names.csv');
    writeFileSync(sheet, 'Game Name,Village,Display Name\nCanon,home,Big Gun\n');
    const before = readFileSync('src/data/displayNames.json', 'utf8');
    let message = '';
    try {
      execFileSync('node', ['scripts/importNameSheet.mts', sheet], { stdio: 'pipe' });
    } catch (err: any) {
      message = String(err.stderr);
    }
    expect(message).toContain('no "Canon" in the home village');
    expect(readFileSync('src/data/displayNames.json', 'utf8')).toBe(before);
  });
});
