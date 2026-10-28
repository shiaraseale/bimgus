/**
 * Every upgrade-related DM goes through here: completions found by the live API, by comparing
 * imports, and by import timers. Wording depends on how sure we are (2.4 step 5), walls are skipped,
 * repeats are suppressed, and users who block DMs are paused (2.4 step 10).
 */
import { DiscordService, COLORS } from './discordService';
import { CocAssetService } from './cocAssetService';
import { dmToggleButton } from '../api/discord/components/dmToggle';
import { Village, getById, getLevel } from './gameDataService';
import { ImportChange, InProgressUpgrade, VillageDataV2, VillageImportService } from './villageImportService';
import { snapshotKey } from './playerTrackingService';
import { LinkedAccount, PendingUpgrade, PlayerSnapshot, UserDoc } from '../types/user';

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
// Categories that never send DMs (still tracked for /upgrades). Hero equipment muted on request, 2026-10-24.
export const MUTED_CATEGORIES = new Set(['equipment']);
// Categories that never become events at all, so they're also left out of import summaries. Walls on
// request, 2026-10-26: there are hundreds of segments and the updates serve no purpose.
const IGNORED_CATEGORIES = new Set(['wall']);
export const DM_BLOCK_PAUSE_MS = 7 * 24 * 60 * 60 * 1000;
// Above this many events in one cycle, send a single summary instead of one DM each
const MAX_SEPARATE_MESSAGES = 3;

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

/** One line describing an event, used in both single and summary messages. */
export function describeEvent(e: UpgradeEvent): string {
  const countPrefix = e.count > 1 ? `${e.count}x ` : '';
  const levels = `Lv ${e.newLevel}/${e.maxLevel}`;
  switch (e.kind) {
    case 'unlocked':
      return `🔓 **${e.name}** unlocked! (${levels})`;
    case 'built':
      return `🏗️ ${countPrefix}**${e.name}** built (${levels})`;
    case 'expected':
      return `🏗️ Your ${countPrefix}**${e.name}** should now be level ${e.newLevel} (${levels})`;
    default:
      return `🎉 ${countPrefix}**${e.name}** reached **level ${e.newLevel}** (${levels})`;
  }
}

// The live API reports these when they finish, so their import timers only update stored levels (no DM).
// Heroes aren't here: the API shows a hero's new level as soon as its upgrade *starts* (seen in
// production on 2026-10-24), so hero completions come from timers (see heroUpgradeStarts).
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
    // A hero reaches each level once, so one key covers both its import timer and its API-start timer
    key:
      up.category === 'hero'
        ? `upgrade:${up.code ?? up.name}:${up.village}:${up.targetLevel}`
        : `timer:${up.code ?? up.name}:${up.village}:${up.targetLevel}:${up.finishesAtMs}`,
  };
}

function sameUpgrade(
  a: { code?: number; village: string; targetLevel: number },
  b: { code?: number; village: string; targetLevel: number }
): boolean {
  return a.code !== undefined && a.code === b.code && a.village === b.village && a.targetLevel === b.targetLevel;
}

/**
 * The API shows a hero's new level as soon as its upgrade starts, so a hero level-up from the API is
 * a start, not a completion. Each one becomes a pending timer instead of a DM: dropped when the import
 * already has a timer for it (that timer DMs, and includes boosts), otherwise finishing after the
 * game data's upgrade time. Returns the remaining events and the new pending timers.
 */
export function heroUpgradeStarts(
  events: UpgradeEvent[],
  village: VillageDataV2 | null,
  now: number = Date.now()
): { events: UpgradeEvent[]; pending: PendingUpgrade[] } {
  const remaining: UpgradeEvent[] = [];
  const pending: PendingUpgrade[] = [];
  for (const e of events) {
    if (e.category !== 'hero' || e.kind !== 'upgraded') {
      remaining.push(e);
      continue;
    }
    const target = { code: e.code, village: e.village, targetLevel: e.newLevel };
    if (village?.inProgressUpgrades.some((u) => u.finishesAtMs > now && sameUpgrade(u, target))) continue;
    const seconds = e.code ? getLevel(getById(e.code)!, e.newLevel)?.upgradeSeconds : undefined;
    if (!seconds) {
      remaining.push(e);
      continue;
    }
    pending.push({
      code: e.code,
      name: e.name,
      category: 'hero',
      village: e.village,
      currentLevel: e.oldLevel,
      targetLevel: e.newLevel,
      maxLevel: e.maxLevel,
      timerSeconds: seconds,
      finishesAtMs: now + seconds * 1000,
    });
  }
  return { events: remaining, pending };
}

/**
 * A hero timer the live API has moved past. The API shows a hero's new level when its upgrade starts,
 * so a level above the timer's target means that upgrade finished early (gems, a Book, a boost after
 * the export) and the next one has started. It's done, and its DM would arrive after the newer
 * upgrade's ("should now be level 12" after "level 13", seen 2026-10-27).
 */
export function supersededHeroTimer(
  up: { category: string; code?: number; name: string; village: Village; targetLevel: number },
  snapshot: PlayerSnapshot | undefined
): boolean {
  if (up.category !== 'hero' || !snapshot) return false;
  const live = snapshot.heroes[snapshotKey(up.village, (up.code && getById(up.code)?.name) || up.name)];
  return Boolean(live && live.level > up.targetLevel);
}

/** Pending API-start timers that an import now covers (the import's own timer is more accurate). */
export function withoutImportedTimers(
  pending: PendingUpgrade[] | undefined,
  village: VillageDataV2 | null
): PendingUpgrade[] {
  if (!pending || !village) return pending ?? [];
  return pending.filter((p) => !village.inProgressUpgrades.some((u) => sameUpgrade(u, p)));
}

export function isDmPaused(user: UserDoc, now: number = Date.now()): boolean {
  return Boolean(user.dmsBlockedAt && now - new Date(user.dmsBlockedAt).getTime() < DM_BLOCK_PAUSE_MS);
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

  const footer = { text: `Account: ${account.name} (${account.playerTag}) • Bimgus` };
  const components = [
    DiscordService.createActionRow([DiscordService.openGameLinkButton(), dmToggleButton(account.playerTag)]),
  ];
  const messages =
    fresh.length > MAX_SEPARATE_MESSAGES
      ? [
          {
            title: `🎉 [${account.name}] ${fresh.length} Upgrades`,
            description: fresh.map(describeEvent).join('\n').slice(0, 4000),
            color: COLORS.GOLD,
            footer,
            timestamp: new Date(now).toISOString(),
          },
        ]
      : fresh.map((e) => ({
          title: `${e.kind === 'unlocked' ? '🔓' : e.kind === 'upgraded' ? '🎉' : '🏗️'} [${account.name}] ${KIND_TITLES[e.kind]}`,
          description: [
            describeEvent(e),
            '',
            `📊 **Level ${e.newLevel}/${e.maxLevel}** for ${hallTag(account, e.village)}`,
            e.kind === 'expected'
              ? "*Estimated from your import's timer (boosts active then are counted); gems or a boost used since may have finished it sooner.*"
              : '',
          ]
            .filter(Boolean)
            .join('\n'),
          color: COLORS.GOLD,
          thumbnail: {
            url: CocAssetService.getThumbnail(e.assetName, thumbnailCategory(e.category), e.newLevel, e.village),
          },
          footer,
          timestamp: new Date(now).toISOString(),
        }));

  let sent = 0;
  for (const embed of messages) {
    const result = await DiscordService.sendDmResult(user.discordUserId, { embeds: [embed], components });
    if (result === 'blocked') {
      user.dmsBlockedAt = new Date(now).toISOString();
      user.dmsBlockedNoticeShown = false;
      break;
    }
    if (result === 'sent') sent++;
  }
  return sent;
}
