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

/** "Account: Avery (#TAG)", the footer of an account's messages. */
export function accountFooter(account: { name: string; playerTag: string }): string {
  return fill(shared.accountFooter, { name: account.name, tag: account.playerTag });
}
