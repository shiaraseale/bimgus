/**
 * Every upgrade-related DM goes through here: completions found by the live API, by comparing
 * imports, and by import timers. Wording depends on how sure we are (2.4 step 5), walls are skipped,
 * repeats are suppressed, and users who block DMs are paused (2.4 step 10).
 */
import { DiscordService, COLORS } from './discordService';
import { CocAssetService } from './cocAssetService';
import { dmToggleButton } from '../api/discord/components/dmToggle';
import { Village, getById } from './gameDataService';
import { ImportChange, InProgressUpgrade, VillageImportService } from './villageImportService';
import { snapshotKey } from './playerTrackingService';
import { LinkedAccount, PlayerSnapshot, UserDoc } from '../types/user';
import { DiscordWebhookPayload } from '../types/discord';
import { card, layoutMessage } from './discordLayout';

export type UpgradeKind = 'upgraded' | 'unlocked' | 'built' | 'expected';

export interface UpgradeEvent {
  kind: UpgradeKind;
  code?: number;
  name: string; // display name, e.g. "Cannon (BB)"
  assetName: string; // game name, used for thumbnails (never the display name)
  category: string;
  village: Village;
  oldLevel: number;
  newLevel: number;
  maxLevel: number;
  count: number;
  // A stable key for events that must never be sent twice (API levels, timer instances)
  key?: string;
}

const NOTIFIED_KEYS_LIMIT = 200;
// Categories that never send DMs (still tracked for /status). Hero equipment muted on request, 2026-10-24.
export const MUTED_CATEGORIES = new Set(['equipment']);
// Categories that never become events at all, so they're also left out of import summaries. Walls on
// request, 2026-10-26: there are hundreds of segments and the updates serve no purpose.
const IGNORED_CATEGORIES = new Set(['wall']);
export const DM_BLOCK_PAUSE_MS = 7 * 24 * 60 * 60 * 1000;

export const VILLAGE_HEADINGS: Record<Village, string> = { home: '🏰 Home Village', builder: '🔨 Builder Base' };

const KIND_TITLES: Record<UpgradeKind, string> = {
  upgraded: 'Upgrade Completed!',
  unlocked: 'Unlocked!',
  built: 'New Building!',
  expected: 'Upgrade Should Be Done',
};

function thumbnailCategory(category: string): string {
  if (['hero', 'equipment', 'spell', 'townHall', 'builderHall', 'trap', 'pet', 'guardian'].includes(category))
    return category;
  if (['troop', 'siege', 'superTroop'].includes(category)) return 'troop';
  return 'building';
}

function hallTag(account: LinkedAccount, village: Village): string {
  return village === 'builder' ? `BH${account.builderHallLevel || '?'}` : `TH${account.townHallLevel || '?'}`;
}

/**
 * One line describing an event, used in DMs and import replies, e.g. "🎉 2x **Cannon** reached Lv 14/17"
 * (with "for TH12" when `hall` is given).
 */
export function describeEvent(e: UpgradeEvent, hall?: string): string {
  const countPrefix = e.count > 1 ? `${e.count}x ` : '';
  const levels = `Lv ${e.newLevel}/${e.maxLevel}${hall ? ` for ${hall}` : ''}`;
  switch (e.kind) {
    case 'unlocked':
      return `🔓 **${e.name}** unlocked (${levels})`;
    case 'built':
      return `🏗️ ${countPrefix}**${e.name}** built (${levels})`;
    case 'expected':
      return `🏗️ ${countPrefix}**${e.name}** should now be ${levels}`;
    default:
      return `🎉 ${countPrefix}**${e.name}** reached ${levels}`;
  }
}

/** Event lines, under a heading per village when both have some. */
function byVillage(events: UpgradeEvent[]): string {
  const groups = (['home', 'builder'] as const)
    .map((v) => ({ v, lines: events.filter((e) => e.village === v).map((e) => describeEvent(e)) }))
    .filter((g) => g.lines.length > 0);
  if (groups.length === 1) return groups[0].lines.join('\n');
  return groups.map((g) => `**${VILLAGE_HEADINGS[g.v]}**\n${g.lines.join('\n')}`).join('\n\n');
}

// The live API reports these when they finish, so their import timers only update stored levels (no DM).
// Heroes aren't here: the API reports them the same way, but their timers DM as well, and the two share
// a key so only the first is sent.
export const API_COVERED_CATEGORIES = new Set([
  'troop',
  'superTroop',
  'siege',
  'pet',
  'spell',
  'equipment',
  'townHall',
  'builderHall',
]);

const BUILT_CATEGORIES = new Set(['defense', 'resource', 'army', 'other', 'trap', 'guardian']);

/** Events for what changed between two imports (2.4). */
export function eventsFromImportChanges(changes: ImportChange[]): UpgradeEvent[] {
  return changes
    .filter((c) => !IGNORED_CATEGORIES.has(c.category))
    .map((c) => ({
      kind: c.kind,
      code: c.code,
      name: c.name,
      assetName: getById(c.code)?.name ?? c.name,
      category: c.category,
      village: c.village,
      oldLevel: c.oldLevel,
      newLevel: c.newLevel,
      maxLevel: c.maxLevel,
      count: c.count,
    }));
}

/**
 * The event for an import timer that has run out, or null when the live API reports that category
 * itself or it's ignored. Timers are estimates (boosts shorten them), so a level-up is only "expected"
 * (2.4 step 5).
 */
export function eventFromTimer(up: InProgressUpgrade): UpgradeEvent | null {
  if (API_COVERED_CATEGORIES.has(up.category) || IGNORED_CATEGORIES.has(up.category)) return null;
  const item = up.code ? getById(up.code) : undefined;
  const kind: UpgradeKind =
    up.currentLevel === 0 ? (BUILT_CATEGORIES.has(up.category) ? 'built' : 'unlocked') : 'expected';
  return {
    kind,
    code: up.code,
    name: item?.displayName ?? up.name,
    assetName: item?.name ?? up.name,
    category: up.category,
    village: up.village,
    oldLevel: up.currentLevel,
    newLevel: up.targetLevel,
    maxLevel: up.maxLevel,
    count: 1,
    // A hero reaches each level once, so this key is the API's own for that level-up (only one DM)
    key:
      up.category === 'hero'
        ? `hero:${up.village}:${item?.name ?? up.name}:${up.targetLevel}`
        : `timer:${up.code ?? up.name}:${up.village}:${up.targetLevel}:${up.finishesAtMs}`,
  };
}

/**
 * A hero timer the live API has reached. The API shows a hero's new level once the upgrade has finished
 * (like the lab's), so it's done, and sooner than the timer said if that's before it ran out: a potion,
 * gems or a Book after the export. The API's level-up has already sent the DM.
 */
export function finishedHeroTimer(
  up: { category: string; code?: number; name: string; village: Village; targetLevel: number },
  snapshot: PlayerSnapshot | undefined
): boolean {
  if (up.category !== 'hero' || !snapshot) return false;
  const live = snapshot.heroes[snapshotKey(up.village, (up.code && getById(up.code)?.name) || up.name)];
  return Boolean(live && live.level >= up.targetLevel);
}

export function isDmPaused(user: UserDoc, now: number = Date.now()): boolean {
  return Boolean(user.dmsBlockedAt && now - new Date(user.dmsBlockedAt).getTime() < DM_BLOCK_PAUSE_MS);
}

/**
 * One DM per check: a single event with its picture, or a list. Timer events are estimates, which the
 * footer says (a gem or boost used since the export may have finished it sooner).
 */
export function buildUpgradeDm(account: LinkedAccount, events: UpgradeEvent[]): DiscordWebhookPayload {
  const estimated = events.some((e) => e.kind === 'expected') ? "Estimated from your import's timer • " : '';
  const [only] = events;
  return layoutMessage(
    card({
      accent: COLORS.GOLD,
      ...(events.length === 1
        ? {
            title: `${only.kind === 'unlocked' ? '🔓' : only.kind === 'upgraded' ? '🎉' : '🏗️'} [${account.name}] ${KIND_TITLES[only.kind]}`,
            body: describeEvent(only, hallTag(account, only.village)),
            thumbnail: CocAssetService.getThumbnail(
              only.assetName,
              thumbnailCategory(only.category),
              only.newLevel,
              only.village
            ),
          }
        : {
            title: `🎉 [${account.name}] ${events.length} Upgrades`,
            body: byVillage(events).slice(0, 3700),
          }),
      footer: `${estimated}Account: ${account.name} (${account.playerTag})`,
      buttons: [DiscordService.openGameLinkButton(), dmToggleButton(account.playerTag)],
    })
  );
}

/**
 * Sends the account's events as DMs. Mutates `account.notifiedKeys` and `user.dmsBlockedAt`, so the
 * caller must save the user afterwards. Returns how many DMs were sent.
 */
export async function notifyUpgrades(
  user: UserDoc,
  account: LinkedAccount,
  events: UpgradeEvent[],
  now: number = Date.now()
): Promise<number> {
  if (events.length === 0) return 0;

  // Drop muted categories and anything already sent, and record the rest before sending so a crash
  // can't cause a repeat
  const seen = new Set(account.notifiedKeys ?? []);
  const fresh = events.filter((e) => !MUTED_CATEGORIES.has(e.category) && (!e.key || !seen.has(e.key)));
  const newKeys = fresh.map((e) => e.key).filter((k): k is string => Boolean(k));
  if (newKeys.length > 0) {
    account.notifiedKeys = [...(account.notifiedKeys ?? []), ...newKeys].slice(-NOTIFIED_KEYS_LIMIT);
  }

  if (account.dmsEnabled === false || user.dmsEnabled === false || isDmPaused(user, now)) return 0;
  // Upgrade DMs start with the account's first import, so linking alone never sends them (requested
  // 2026-10-26). Keys are recorded above, so nothing seen before the import is sent afterwards.
  if (!VillageImportService.read(account.villageData)) return 0;
  if (fresh.length === 0) return 0;

  const result = await DiscordService.sendDmResult(user.discordUserId, buildUpgradeDm(account, fresh));
  if (result === 'blocked') {
    user.dmsBlockedAt = new Date(now).toISOString();
    user.dmsBlockedNoticeShown = false;
  }
  return result === 'sent' ? 1 : 0;
}
