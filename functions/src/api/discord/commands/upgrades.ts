import { DiscordService, COLORS } from '../../../services/discordService';
import { CocAssetService } from '../../../services/cocAssetService';
import { CocService } from '../../../services/cocService';
import { FirestoreService } from '../../../services/firestoreService';
import { getPlayerWithFallback } from '../../../services/playerFallback';
import { EMOJIS } from '../../../constants/emojis';
import { config } from '../../../config';
import { PlayerTrackingService } from '../../../services/playerTrackingService';
import { ParsedDefenseGroup, VillageDataV2, VillageImportService } from '../../../services/villageImportService';
import { GameCategory, Village } from '../../../services/gameDataService';
import { interactionReply } from '../../../jobs/interactionReply';
import { LinkedAccount, OutstandingUpgradeItem } from '../../../types/user';
import type { PlayerLike } from '../../../types/coc';
import { log } from '../../../utils/log';
import { bobDefenseButton } from '../components/bobDefense';
import { CommandContext, forEachLinkedAccount } from '../context';
import {
  formatProgressBar,
  getVillageJsonTimestampNotice,
  NO_IMPORT_TEXT,
  HOME_DEFENSE_CATEGORIES,
  BB_DEFENSE_CATEGORIES,
  BUILDING_CATEGORIES,
  activeInProgress,
  numberedFields,
} from '../ui';

/** Slash command definition, registered by scripts/registerCommands.ts */
export const definition = {
  name: 'upgrades',
  description: 'Show live progression and all outstanding upgrades read directly from Clash of Clans',
  contexts: [0, 1],
  integration_types: [0],
  options: [
    {
      name: 'account',
      description: 'Specific player tag to check (leave blank for all linked accounts)',
      type: 3, // STRING
      required: false,
    },
  ],
};

// Runs as a Cloud Task (3.7): its work happens after the "thinking…" reply
export const runsAsTask = true;

export type UpgradesView = 'overview' | 'buildings' | 'defenses' | 'heroes' | 'lab' | 'builder';

// "<:crown:123>" as a component emoji
const customEmoji = (markup: string) => {
  const [, name, id] = markup.match(/<:(\w+):(\d+)>/) ?? [];
  return id ? { name, id } : { name: markup };
};

// The sections in the menu under each /upgrades message; picking one redraws the message (1 message, not 4)
const VIEWS: Array<{ value: UpgradesView; label: string; description: string; emoji: { name: string; id?: string } }> =
  [
    { value: 'overview', label: 'Overview', description: 'Timers and what is left, in short', emoji: { name: '📋' } },
    {
      value: 'buildings',
      label: 'Buildings',
      description: 'Town Hall, resources, army and walls',
      emoji: { name: '🏛️' },
    },
    {
      value: 'defenses',
      label: 'Defenses',
      description: 'Defenses, traps, guardians and crafted',
      emoji: { name: '🛡️' },
    },
    { value: 'heroes', label: 'Heroes', description: 'Heroes and hero equipment', emoji: customEmoji(EMOJIS.CROWN) },
    { value: 'lab', label: 'Lab', description: 'Troops and spells', emoji: { name: '🧪' } },
    {
      value: 'builder',
      label: 'Builder Base',
      description: 'B.O.B, buildings, defenses, heroes, troops',
      emoji: { name: '🔨' },
    },
  ];

const VIEW_MENU = 'upgrades_view:';
// Walls get their own line: hundreds of segments would swamp the building counts
const NON_WALL_BUILDINGS = BUILDING_CATEGORIES.filter((c) => c !== 'wall');
// Room for one view's fields: Discord's limit is 6,000 characters per embed, with the description and footer
const VIEW_BUDGET = 4800;

/** One category in a view, e.g. the home defenses: its lines and how much is left. */
interface Section {
  emoji: string;
  name: string;
  lines: string[];
  count: number; // things still to upgrade
  levels: number; // levels still to go across them
  done: string; // shown when nothing is left
  needsImport?: boolean;
  importedLevels: number; // the part of `levels` that comes from the import
}

function itemSection(emoji: string, name: string, items: OutstandingUpgradeItem[], done: string): Section {
  return {
    emoji,
    name,
    done,
    importedLevels: 0,
    count: items.length,
    levels: items.reduce((n, i) => n + i.levelsRemaining, 0),
    lines: items.map(
      (i) => `• **${i.name}**: Lv ${i.currentLevel}/${i.maxLevel}${i.nextCost ? ` — ${i.nextCost}` : ''}`
    ),
  };
}

/** A section from the import (null groups: no import yet), with any items from the live API first. */
function importSection(
  emoji: string,
  name: string,
  groups: ParsedDefenseGroup[] | null,
  done: string,
  items: OutstandingUpgradeItem[] = []
): Section {
  const fromItems = itemSection(emoji, name, items, done);
  if (!groups) return { ...fromItems, needsImport: true };
  const importedLevels = groups.reduce((n, g) => n + g.count * Math.max(0, g.maxLevel - g.currentLevel), 0);
  return {
    ...fromItems,
    importedLevels,
    count: fromItems.count + groups.reduce((n, g) => n + g.count, 0),
    levels: fromItems.levels + importedLevels,
    lines: [...fromItems.lines, ...groups.map(VillageImportService.formatGroupLine)],
  };
}

/** Everything /upgrades shows for one account, worked out once for whichever view is drawn. */
function upgradeData(account: LinkedAccount, player: PlayerLike, village: VillageDataV2 | null) {
  const outstanding = PlayerTrackingService.calculateOutstandingUpgrades(
    player,
    account.bobDefenseCompleted || false,
    village
  );
  const home = outstanding.byCategory.home;
  const bb = outstanding.byCategory.builder;
  const th = player.townHallLevel;
  const bh = player.builderHallLevel || 0;
  const halls = { townHall: th, builderHall: bh };
  // The next hall upgrade is counted as "0 of 1"; it's shown as the hall's own levels ("Lv 12/13")
  const withHallLevels = (items: OutstandingUpgradeItem[], hall: number) =>
    items.map((i) =>
      ['Town Hall', 'Builder Hall'].includes(i.name) ? { ...i, currentLevel: hall, maxLevel: hall + 1 } : i
    );
  const unmaxed = (v: Village, categories: readonly GameCategory[]) =>
    village ? VillageImportService.groupsFor(village, v, categories, halls).filter((g) => !g.isMaxed) : null;

  const sections = {
    buildings: importSection(
      '🏛️',
      'Buildings & Storages',
      unmaxed('home', NON_WALL_BUILDINGS),
      '✅ All buildings, storages & gear-ups maxed!',
      withHallLevels(home.buildings, th)
    ),
    walls: importSection('🧱', 'Walls', unmaxed('home', ['wall']), `✅ All walls maxed for TH${th}!`),
    defenses: importSection(
      '🛡️',
      'Defenses',
      unmaxed('home', HOME_DEFENSE_CATEGORIES),
      `✅ All home defenses maxed for TH${th}!`
    ),
    heroes: itemSection(EMOJIS.CROWN, 'Heroes', home.heroes, `✅ All heroes maxed for TH${th}!`),
    equipment: itemSection(EMOJIS.ANVIL, 'Hero Equipment', home.equipment, `✅ All equipment maxed for TH${th}!`),
    troops: itemSection('⚔️', 'Troops', home.troops, `✅ All troops maxed for TH${th}!`),
    spells: itemSection('🧪', 'Spells', home.spells, `✅ All spells maxed for TH${th}!`),
    bbBuildings: importSection(
      '🏛️',
      'BB Buildings',
      unmaxed('builder', NON_WALL_BUILDINGS),
      `✅ All BB buildings maxed for BH${bh}!`,
      withHallLevels(bb.buildings, bh)
    ),
    bbWalls: importSection('🧱', 'BB Walls', unmaxed('builder', ['wall']), `✅ All BB walls maxed for BH${bh}!`),
    bbDefenses: importSection(
      '🛡️',
      'BB Defenses',
      unmaxed('builder', BB_DEFENSE_CATEGORIES),
      `✅ All BB defenses maxed for BH${bh}!`
    ),
    bbHeroes: itemSection(EMOJIS.CROWN, 'BB Heroes', bb.heroes, `✅ All BB heroes maxed for BH${bh}!`),
    bbTroops: itemSection('⚔️', 'BB Troops', bb.troops, `✅ All BB troops maxed for BH${bh}!`),
  };

  // The API's levels plus the import's (the import is the only source for defenses and buildings)
  const totalLevels = Object.values(sections).reduce(
    (n, sec) => n + sec.importedLevels,
    outstanding.totalRemainingLevels
  );

  return { th, bh, bob: bb.sixthBuilder, sections, totalLevels, timers: activeInProgress(account, village) };
}

// Walls are only listed while some are left
const wallsLeft = (walls: Section) => (walls.count > 0 ? [walls] : []);

/** "🛡️ **Defenses**: 32 to upgrade · 64 levels", for the overview. */
function summaryLine(s: Section): string {
  const status = s.needsImport
    ? 'needs `/import-village`'
    : s.count === 0
      ? '✅ maxed'
      : `${s.count} to upgrade · ${s.levels} level${s.levels === 1 ? '' : 's'}`;
  return `${s.emoji} **${s.name}**: ${status}`;
}

/** A section's full list as embed fields, or the "all maxed" / "import first" text. */
function sectionFields(s: Section) {
  const title = `${s.emoji} ${s.name}`;
  if (s.needsImport) return [{ name: title, value: NO_IMPORT_TEXT, inline: false }];
  if (s.lines.length === 0) return [{ name: `${title} (0)`, value: s.done, inline: false }];
  return numberedFields(title, s.count, s.lines);
}

/** Trims the longest sections so one view fits in one message, ending each with "…and N more". */
function fitToView(sections: Section[]): Section[] {
  const fitted = VillageImportService.fitSections(
    sections.map((s) => ({ title: `${s.emoji} ${s.name}`, lines: s.lines })),
    VIEW_BUDGET,
    (hidden) => `…and ${hidden} more`
  );
  return sections.map((s, i) => ({ ...s, lines: fitted[i].lines }));
}

function bobText(bob: ReturnType<typeof upgradeData>['bob']): string {
  const mark = (done: boolean) => (done ? '✅' : '🔄');
  return [
    bob.unlocked
      ? '🎉 **B.O.B Unlocked! (6th Builder Active)**'
      : `⏳ **Progress (${bob.overallPercentage}%)**: ${formatProgressBar(bob.overallPercentage, 6)}`,
    `${mark(bob.tasks.gearUps.completed)} **Gear-Ups**: ${bob.tasks.gearUps.current}/3`,
    `${mark(bob.tasks.bbTroopLv18.completed)} **Troop Lv 18**: ${bob.tasks.bbTroopLv18.highestTroopName} (${bob.tasks.bbTroopLv18.current}/18)`,
    `${mark(bob.tasks.bbDefenseLv9.completed)} **Defense Lv 9**: ${bob.tasks.bbDefenseLv9.completed ? '1/1' : '0/1 (e.g. Mega Tesla)'}`,
    `${mark(bob.tasks.bbHeroesLv45.completed)} **Heroes Lv 45**: ${bob.tasks.bbHeroesLv45.current}/45`,
  ].join('\n');
}

/**
 * One /upgrades message: the overview (timers, then one line per category) or one section's full list,
 * with the menu to switch between them.
 */
export function buildUpgradesMessage(
  account: LinkedAccount,
  player: PlayerLike,
  isCached: boolean,
  view: UpgradesView = 'overview'
) {
  const village = VillageImportService.read(account.villageData);
  const { th, bh, bob, sections: s, totalLevels, timers } = upgradeData(account, player, village);
  if (view === 'builder' && bh === 0) view = 'overview';

  const fields: any[] = [];
  if (view === 'overview') {
    if (timers.length > 0) {
      const lines = VillageImportService.formatInProgressUpgrades(timers).split('\n');
      fields.push(...numberedFields('⏳ Upgrading', timers.length, lines));
    }
    fields.push({
      name: `🏰 Home Village (TH${th})`,
      value: [s.buildings, ...wallsLeft(s.walls), s.defenses, s.heroes, s.equipment, s.troops, s.spells]
        .map(summaryLine)
        .join('\n'),
      inline: false,
    });
    if (bh > 0) {
      const bobLine = bob.unlocked
        ? '🤖 **B.O.B**: 🎉 unlocked'
        : `🤖 **B.O.B**: ${formatProgressBar(bob.overallPercentage, 6)}`;
      fields.push({
        name: `🔨 Builder Base (BH${bh})`,
        value: [
          bobLine,
          ...[s.bbBuildings, ...wallsLeft(s.bbWalls), s.bbDefenses, s.bbHeroes, s.bbTroops].map(summaryLine),
        ].join('\n'),
        inline: false,
      });
    }
  } else {
    const shown: Record<Exclude<UpgradesView, 'overview'>, Section[]> = {
      buildings: [s.buildings, ...wallsLeft(s.walls)],
      defenses: [s.defenses],
      heroes: [s.heroes, s.equipment],
      lab: [s.troops, s.spells],
      builder: [s.bbBuildings, ...wallsLeft(s.bbWalls), s.bbDefenses, s.bbHeroes, s.bbTroops],
    };
    if (view === 'builder') fields.push({ name: '🤖 6th Builder (B.O.B)', value: bobText(bob), inline: false });
    fields.push(...fitToView(shown[view]).flatMap(sectionFields));
  }

  const usesImport = ['overview', 'buildings', 'defenses', 'builder'].includes(view);
  const embed = {
    title: `🏰 [${account.name}] Upgrades${view === 'overview' ? '' : `: ${VIEWS.find((v) => v.value === view)!.label}`}`,
    description: [
      isCached ? '⚠️ *CoC API is currently under maintenance. Displaying your last saved snapshot.*' : '',
      usesImport ? getVillageJsonTimestampNotice(village, 'Defenses & buildings based on the export taken') : '',
      view === 'overview' ? `**${totalLevels}** levels left in total. Pick a section below for the full list.` : '',
    ]
      .filter(Boolean)
      .join('\n'),
    fields: fields.slice(0, 25),
    color: COLORS.GOLD,
    thumbnail: {
      url: CocAssetService.getPlayerLeagueUrl(player) || CocAssetService.getTownHallUrl(th),
    },
    footer: { text: `Account: ${account.name} (${account.playerTag})` },
    timestamp: new Date().toISOString(),
  };

  const menu = {
    type: 3,
    custom_id: `${VIEW_MENU}${account.playerTag}`,
    placeholder: 'Show a section',
    options: VIEWS.filter((v) => v.value !== 'builder' || bh > 0).map((v) => ({
      label: v.label,
      value: v.value,
      description: v.description,
      emoji: v.emoji,
      default: v.value === view,
    })),
  };
  const buttons: any[] = [];
  if (view === 'builder') buttons.push(bobDefenseButton(account.playerTag, bob.tasks.bbDefenseLv9.completed, true));
  buttons.push(DiscordService.openGameLinkButton('Open CoC'));

  return { embeds: [embed], components: [{ type: 1, components: [menu] }, DiscordService.createActionRow(buttons)] };
}

export async function execute(ctx: CommandContext): Promise<any> {
  const { sendAccountMessage, getPlayerWithFallback: getPlayer } = ctx;
  return forEachLinkedAccount(ctx, 'upgrades', async (account, idx) => {
    const { player, isCached } = await getPlayer(account);
    await sendAccountMessage(idx, buildUpgradesMessage(account, player, isCached));
  });
}

export function isUpgradesViewSelect(customId: string): boolean {
  return customId.startsWith(VIEW_MENU);
}

/**
 * Redraws an /upgrades message with the section picked in its menu. The interaction has already been
 * answered with "deferred update", so this edits the message the menu is on.
 */
export async function showUpgradesView(interaction: any): Promise<void> {
  const reply = interactionReply({
    applicationId: interaction.application_id || config.discord.clientId,
    interactionToken: interaction.token,
  });
  const tag = String(interaction.data.custom_id).slice(VIEW_MENU.length);
  const picked = interaction.data.values?.[0];
  const view: UpgradesView = VIEWS.some((v) => v.value === picked) ? picked : 'overview';
  try {
    const discordUserId = (interaction.user || interaction.member?.user)?.id;
    const user = discordUserId ? await FirestoreService.getUser(discordUserId) : null;
    const account = user?.accounts.find((a) => a.playerTag.toUpperCase() === tag.toUpperCase());
    if (!account) {
      await reply.followup({ content: `⚠️ \`${tag}\` isn't linked to your profile any more.`, flags: 64 });
      return;
    }
    const { player, isCached } = await getPlayerWithFallback(CocService.shared(), account);
    await reply.edit(buildUpgradesMessage(account, player, isCached, view));
  } catch (err: any) {
    log.error(`[Discord] Could not show the ${view} view of /upgrades for ${tag}:`, err);
    await reply.followup({ content: `❌ Couldn't load that section: ${err.message || 'API error'}`, flags: 64 });
  }
}
