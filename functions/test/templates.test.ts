import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { EMOJIS } from '../src/constants/emojis';
import { accountFooter, fill } from '../src/templates';

const src = join(__dirname, '../src');
const templateFiles = readdirSync(join(src, 'templates')).filter((f) => f.endsWith('.json'));

// Every string in a template file, however deep
const strings = (node: unknown): string[] => {
  if (typeof node === 'string') return [node];
  return node && typeof node === 'object' ? Object.values(node).flatMap(strings) : [];
};

describe('fill', () => {
  it('fills in every placeholder, as often as it appears', () => {
    expect(fill('{size}v{size} · {clan}', { size: 5, clan: 'Us' })).toBe('5v5 · Us');
  });

  it('keeps zero and empty values', () => {
    expect(fill('[{a}|{b}]', { a: 0, b: '' })).toBe('[0|]');
  });

  it('fills in any custom emoji by its name', () => {
    expect(fill('{raid} {capital_gold}')).toBe(`${EMOJIS.RAID} ${EMOJIS.CAPITAL_GOLD}`);
  });

  it("leaves a player's name alone, even one that looks like a placeholder", () => {
    expect(fill('{name} {level}', { name: '{level}', level: 3 })).toBe('{level} 3');
    expect(fill('{name}', { name: '$& $1' })).toBe('$& $1');
  });

  it('leaves a placeholder with no value showing, so a typo gets noticed', () => {
    expect(fill('{nmae}', { name: 'Avery' })).toBe('{nmae}');
  });
});

describe('accountFooter', () => {
  it('names the account and its tag', () => {
    expect(accountFooter({ name: 'Avery', playerTag: '#P0' })).toBe('Account: Avery (#P0)');
  });
});

describe('the template files', () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      if (e.isDirectory()) return e.name === 'templates' || e.name === 'scripts' ? [] : walk(join(dir, e.name));
      return e.name.endsWith('.ts') ? [join(dir, e.name)] : [];
    });
  const code = walk(src)
    .map((f) => readFileSync(f, 'utf8'))
    .join('\n');
  const emojiNames = Object.keys(EMOJIS).map((k) => k.toLowerCase());

  it.each(templateFiles)('%s only uses placeholders the code fills in', (file) => {
    const template = JSON.parse(readFileSync(join(src, 'templates', file), 'utf8'));
    const placeholders = strings(template).flatMap((s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
    const unknown = placeholders.filter((p) => !emojiNames.includes(p) && !new RegExp(`\\b${p}\\b`).test(code));
    expect(unknown).toEqual([]);
  });

  it.each(templateFiles)('%s has no empty wording', (file) => {
    const template = JSON.parse(readFileSync(join(src, 'templates', file), 'utf8'));
    expect(strings(template).filter((s) => s.trim() === '')).toEqual([]);
  });
});
