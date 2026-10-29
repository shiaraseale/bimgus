/** Display helpers shared by the slash commands. */
import { GameCategory } from '../../services/gameDataService';
import { InProgressUpgrade, VillageDataV2, VillageImportService } from '../../services/villageImportService';
import { VILLAGE_HEADINGS, withoutImportedTimers } from '../../services/upgradeNotifier';
import { COLORS } from '../../services/discordService';
import { card } from '../../services/discordLayout';
import { DiscordButtonComponent } from '../../types/discord';
import { Village } from '../../services/gameDataService';
import { LinkedAccount } from '../../types/user';
import { discordTime } from '../../utils/discordTime';

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

/** "Based on the export taken 2 days ago (…)", with a warning when the export is over a day old. */
export function getVillageJsonTimestampNotice(
  village: VillageDataV2 | null,
  prefix: string = 'Based on the export taken'
): string | null {
  if (!village) return null;
  const stale = VillageImportService.isStale(village) ? ' ⚠️ *over a day old, so timers may be out of date*' : '';
  return `📄 *${prefix} ${discordTime(village.exportTimestamp)}*${stale}`;
}

/** "🏰 Home Village (TH13)" or "🔨 Builder Base (BH9)", the heading of a village's card. */
export function villageHeading(village: Village, hallLevel: number): string {
  return `${VILLAGE_HEADINGS[village]} (${village === 'home' ? 'TH' : 'BH'}${hallLevel})`;
}

export const VILLAGE_COLORS: Record<Village, number> = { home: COLORS.GOLD, builder: COLORS.BLUE };

export interface CardSection {
  title: string;
  lines: string[];
}

export interface VillageCard {
  village: Village;
  hallLevel: number;
  intro?: string; // shown above the sections, e.g. when the export was taken
  sections: CardSection[];
}

export interface CardsOptions {
  author?: string; // above the first card's heading, e.g. "[Tester] Upgrades: Lab"
  thumbnail?: string; // beside the first card's heading
  footer?: string; // under the last card, e.g. the account
  buttons?: DiscordButtonComponent[]; // at the bottom of the last card
  more?: (hidden: number) => string;
}

/**
 * One card per village, headed "🏰 Home Village (TH13)" or "🔨 Builder Base (BH9)", each listing its
 * sections in full ("**⏳ Upgrading (7)**" then the lines), so no list is split. Lists are trimmed,
 * longest first, so all the cards' text fits `budget` characters (Discord allows 4,000 per message);
 * a trimmed list ends "…and N more".
 */
export function villageCards(cards: VillageCard[], budget: number, opts: CardsOptions = {}) {
  // Everything but the lists: headings, intros, the author and footer, and each section's title markup
  const fixed =
    (opts.author?.length ?? 0) +
    (opts.footer?.length ?? 0) +
    cards.reduce(
      (n, c) => n + villageHeading(c.village, c.hallLevel).length + 12 + (c.intro?.length ?? 0) + c.sections.length * 6,
      0
    );
  const all = VillageImportService.fitSections(
    cards.flatMap((c) => c.sections),
    budget - fixed,
    opts.more
  );
  let next = 0;
  return cards.map((c, i) => {
    const own = all.slice(next, (next += c.sections.length));
    const lists = own.map((s) => `**${s.title}**\n${s.lines.join('\n')}`).join('\n\n');
    const first = i === 0;
    const last = i === cards.length - 1;
    const thumb = first ? opts.thumbnail : undefined;
    return card({
      accent: VILLAGE_COLORS[c.village],
      author: first ? opts.author : undefined,
      title: villageHeading(c.village, c.hallLevel),
      // Only the intro sits beside a thumbnail, so long lists get the card's full width
      body: thumb ? c.intro : [c.intro, lists].filter(Boolean).join('\n\n'),
      blocks: thumb ? [lists] : undefined,
      thumbnail: thumb,
      footer: last ? opts.footer : undefined,
      buttons: last ? opts.buttons : undefined,
    });
  });
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
