/**
 * The wording of Bimgus's messages lives in the JSON files in this folder, so it can be edited without
 * touching the code. README.md here explains how.
 */
import { EMOJIS } from '../constants/emojis';
import shared from './shared.json';

// Every custom emoji is a placeholder too: {raid}, {capital_gold}, {crown} and so on
const emojis: Record<string, string> = Object.fromEntries(
  Object.entries(EMOJIS).map(([key, value]) => [key.toLowerCase(), value])
);

/** A template with its {placeholders} filled in. One with no value is left showing, so a typo is seen. */
export function fill(template: string, values: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (placeholder, key) => String(values[key] ?? emojis[key] ?? placeholder));
}

/**
 * Stops names from setting the direction of the line around them (Unicode bidi rule P2).
 * Inside, the name lays itself out in its own direction. Outside, the line ignores it.
 */
export function isolate(text: string): string {
  return '\u2068' + text + '\u2069';
}

/**
 * isolate(), padded with spaces to `width` for a monospace column. The marks take no room on screen,
 * so the padding is worked out from the text alone and sits outside them.
 */
export function isolatePadded(text: string, width: number): string {
  return isolate(text) + ' '.repeat(Math.max(0, width - text.length));
}

/** "Account: Avery (#TAG)", the footer of an account's messages. */
export function accountFooter(account: { name: string; playerTag: string }): string {
  return fill(shared.accountFooter, { name: isolate(account.name), tag: account.playerTag });
}
