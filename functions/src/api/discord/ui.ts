/** Display helpers shared by the slash commands. */
import { GameCategory } from '../../services/gameDataService';
import { InProgressUpgrade, VillageDataV2, VillageImportService } from '../../services/villageImportService';
import { withoutImportedTimers } from '../../services/upgradeNotifier';
import { LinkedAccount } from '../../types/user';

// Which stored import categories each list shows
export const HOME_DEFENSE_CATEGORIES: GameCategory[] = ['defense', 'trap', 'guardian', 'craftedModule'];
export const BB_DEFENSE_CATEGORIES: GameCategory[] = ['defense', 'trap'];
export const BUILDING_CATEGORIES: GameCategory[] = ['resource', 'army', 'other', 'wall'];

// Shown where imported data would be, for accounts with no import in the current format
export const NO_IMPORT_TEXT =
  '💡 *Run `/import-village` to load your exact building levels and upgrade costs. ' +
  '(Imports from before the one-file update are no longer used; one export now covers both villages.)*';

export function formatProgressBar(percent: number, length: number = 10): string {
  const filled = Math.max(0, Math.min(length, Math.round((percent / 100) * length)));
  const empty = length - filled;
  return `[${'█'.repeat(filled)}${'░'.repeat(empty)}] ${percent}%`;
}

/** "Based on the export taken on …", with a warning when the export is over a day old. */
export function getVillageJsonTimestampNotice(
  village: VillageDataV2 | null,
  prefix: string = 'Based on the export taken'
): string | null {
  if (!village) return null;
  const sec = Math.floor(village.exportTimestamp / 1000);
  const stale = VillageImportService.isStale(village) ? ' ⚠️ *over a day old, so timers may be out of date*' : '';
  return `📄 *${prefix} on <t:${sec}:f> (<t:${sec}:R>)*${stale}`;
}

/**
 * Upgrades still running, soonest first: the import's timers plus hero upgrades seen starting in the
 * API that the import doesn't cover. Each timer is its own upgrade (two traps can both be going to 6).
 */
export function activeInProgress(
  account: LinkedAccount,
  village: VillageDataV2 | null,
  now: number = Date.now()
): InProgressUpgrade[] {
  const heroTimers = withoutImportedTimers(account.pendingUpgrades, village) as InProgressUpgrade[];
  return [...(village?.inProgressUpgrades || []), ...heroTimers]
    .filter((u) => u.finishesAtMs > now)
    .sort((a, b) => a.finishesAtMs - b.finishesAtMs);
}

/**
 * Splits lines into embed fields under Discord's 1,024-character limit: "Title (N)" first, then
 * "Title (Cont. 2)", "Title (Cont. 3)", …
 */
export function numberedFields(title: string, count: number, lines: string[], limit: number = 900) {
  const fields: Array<{ name: string; value: string; inline: boolean }> = [];
  let chunk: string[] = [];
  let length = 0;
  const flush = () => {
    if (chunk.length === 0) return;
    const part = fields.length + 1;
    fields.push({
      name: part === 1 ? `${title} (${count})` : `${title} (Cont. ${part})`,
      value: chunk.join('\n'),
      inline: false,
    });
    chunk = [];
    length = 0;
  };
  for (const line of lines) {
    if (length + line.length + 1 > limit && chunk.length > 0) flush();
    chunk.push(line);
    length += line.length + 1;
  }
  flush();
  return fields;
}
