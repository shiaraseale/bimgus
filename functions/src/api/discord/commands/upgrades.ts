import { DiscordService } from '../../../services/discordService';
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
import { layoutMessage } from '../../../services/discordLayout';
import { DiscordButtonComponent, DiscordStringSelectComponent } from '../../../types/discord';
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
  villageCards,
  CardSection,
  VillageCard,
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

export type UpgradesView = 'overview' | 'buildings' | 'defenses' | 'heroes' | 'lab' | 'bob';

// "<:crown:123>" as a component emoji
const customEmoji = (markup: string) => {
  const [, name, id] = markup.match(/<:(\w+):(\d+)>/) ?? [];
  return id ? { name, id } : { name: markup };
};

// The sections in the menu under each /upgrades message; picking one redraws the message. Each shows
// the Home Village and the Builder Base on separate cards.
const VIEWS: Array<{ value: UpgradesView; label: string; description: string; emoji: { name: string; id?: string } }> =
  [
    { value: 'overview', label: 'Overview', description: 'Timers and what is left, in short', emoji: { name: '📋' } },
    { value: 'buildings', label: 'Buildings', description: 'Halls, resources, army and walls', emoji: { name: '🏛️' } },
    {
      value: 'defenses',
      label: 'Defenses',
      description: 'Defenses, traps, guardians and crafted',
      emoji: { name: '🛡️' },
    },
    { value: 'heroes', label: 'Heroes', description: 'Heroes and hero equipment', emoji: customEmoji(EMOJIS.CROWN) },
    { value: 'lab', label: 'Lab', description: 'Troops and spells', emoji: { name: '🧪' } },
    {
      value: 'bob',
      label: '6th Builder (B.O.B)',
      description: 'Progress to the Builder Base 6th builder',
      emoji: { name: '🤖' },
    },
  ];

const VIEW_MENU = 'upgrades_view:';
// Walls get their own line: hundreds of segments would swamp the building counts
const NON_WALL_BUILDINGS = BUILDING_CATEGORIES.filter((c) => c !== 'wall');
// Room for one view's text across its cards (Discord allows 4,000 characters per message)
const VIEW_BUDGET = 3700;

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

  // Builder Base sections drop the "BB" from their names: they're on the Builder Base card
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
      'Buildings',
      unmaxed('builder', NON_WALL_BUILDINGS),
      `✅ All BB buildings maxed for BH${bh}!`,
      withHallLevels(bb.buildings, bh)
    ),
    bbWalls: importSection('🧱', 'Walls', unmaxed('builder', ['wall']), `✅ All BB walls maxed for BH${bh}!`),
    bbDefenses: importSection(
      '🛡️',
      'Defenses',
      unmaxed('builder', BB_DEFENSE_CATEGORIES),
      `✅ All BB defenses maxed for BH${bh}!`
    ),
    bbHeroes: itemSection(EMOJIS.CROWN, 'Heroes', bb.heroes, `✅ All BB heroes maxed for BH${bh}!`),
    bbTroops: itemSection('⚔️', 'Troops', bb.troops, `✅ All BB troops maxed for BH${bh}!`),
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

/** A section's full list under its heading, or the "all maxed" / "import first" line. */
function cardSection(s: Section): CardSection {
  const title = `${s.emoji} ${s.name}`;
  if (s.needsImport) return { title, lines: [...s.lines, NO_IMPORT_TEXT] };
  if (s.lines.length === 0) return { title: `${title} (0)`, lines: [s.done] };
  return { title: `${title} (${s.count})`, lines: s.lines };
}

function bobText(bob: ReturnType<typeof upgradeData>['bob']): string[] {
  const mark = (done: boolean) => (done ? '✅' : '🔄');
  return [
    bob.unlocked
      ? '🎉 **B.O.B Unlocked! (6th Builder Active)**'
      : `⏳ **Progress (${bob.overallPercentage}%)**: ${formatProgressBar(bob.overallPercentage, 6)}`,
    `${mark(bob.tasks.gearUps.completed)} **Gear-Ups**: ${bob.tasks.gearUps.current}/3`,
    `${mark(bob.tasks.bbTroopLv18.completed)} **Troop Lv 18**: ${bob.tasks.bbTroopLv18.highestTroopName} (${bob.tasks.bbTroopLv18.current}/18)`,
    `${mark(bob.tasks.bbDefenseLv9.completed)} **Defense Lv 9**: ${bob.tasks.bbDefenseLv9.completed ? '1/1' : '0/1 (e.g. Mega Tesla)'}`,
    `${mark(bob.tasks.bbHeroesLv45.completed)} **Heroes Lv 45**: ${bob.tasks.bbHeroesLv45.current}/45`,
  ];
}

/**
 * One /upgrades message: the overview (timers, then one line per category) or one section's full list,
 * with a card for each village and the menu to switch between views.
 */
export function buildUpgradesMessage(
  account: LinkedAccount,
  player: PlayerLike,
  isCached: boolean,
  view: UpgradesView = 'overview'
) {
  const village = VillageImportService.read(account.villageData);
  const { th, bh, bob, sections: s, totalLevels, timers } = upgradeData(account, player, village);
  if (view === 'bob' && bh === 0) view = 'overview';

  const upgrading = (v: Village): CardSection[] => {
    const own = timers.filter((u) => u.village === v);
    if (own.length === 0) return [];
    return [
      { title: `⏳ Upgrading (${own.length})`, lines: VillageImportService.formatInProgressUpgrades(own).split('\n') },
    ];
  };

  // Each view's sections for the Home Village and the Builder Base cards
  let home: CardSection[] = [];
  let builder: CardSection[] = [];
  if (view === 'overview') {
    home = [
      ...upgrading('home'),
      {
        title: '📋 Left to Upgrade',
        lines: [s.buildings, ...wallsLeft(s.walls), s.defenses, s.heroes, s.equipment, s.troops, s.spells].map(
          summaryLine
        ),
      },
    ];
    const bobLine = bob.unlocked
      ? '🤖 **B.O.B**: 🎉 unlocked'
      : `🤖 **B.O.B**: ${formatProgressBar(bob.overallPercentage, 6)}`;
    builder = [
      ...upgrading('builder'),
      {
        title: '📋 Left to Upgrade',
        lines: [
          bobLine,
          ...[s.bbBuildings, ...wallsLeft(s.bbWalls), s.bbDefenses, s.bbHeroes, s.bbTroops].map(summaryLine),
        ],
      },
    ];
  } else if (view === 'bob') {
    builder = [{ title: '🤖 6th Builder (B.O.B)', lines: bobText(bob) }];
  } else {
    const shown: Record<Exclude<UpgradesView, 'overview' | 'bob'>, [Section[], Section[]]> = {
      buildings: [
        [s.buildings, ...wallsLeft(s.walls)],
        [s.bbBuildings, ...wallsLeft(s.bbWalls)],
      ],
      defenses: [[s.defenses], [s.bbDefenses]],
      heroes: [[s.heroes, s.equipment], [s.bbHeroes]],
      lab: [[s.troops, s.spells], [s.bbTroops]],
    };
    home = shown[view][0].map(cardSection);
    builder = shown[view][1].map(cardSection);
  }

  const usesImport = ['overview', 'buildings', 'defenses'].includes(view);
  const intro = [
    isCached ? '⚠️ *CoC API is currently under maintenance. Displaying your last saved snapshot.*' : '',
    usesImport ? getVillageJsonTimestampNotice(village, 'Defenses & buildings based on the export taken') : '',
    view === 'overview' ? `**${totalLevels}** levels left in total. Pick a section below for the full list.` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const cards: VillageCard[] = [];
  if (home.length > 0) cards.push({ village: 'home', hallLevel: th, sections: home });
  if (bh > 0 && builder.length > 0) cards.push({ village: 'builder', hallLevel: bh, sections: builder });
  if (intro) cards[0].intro = intro;

  const label = VIEWS.find((v) => v.value === view)!.label;
  const shownCards = villageCards(cards, VIEW_BUDGET, {
    author: `[${account.name}] Upgrades${view === 'overview' ? '' : `: ${label}`}`,
    thumbnail: CocAssetService.getPlayerLeagueUrl(player) || CocAssetService.getTownHallUrl(th),
    footer: `Account: ${account.name} (${account.playerTag})`,
    more: (hidden) => `…and ${hidden} more`,
  });

  const menu: DiscordStringSelectComponent = {
    type: 3,
    custom_id: `${VIEW_MENU}${account.playerTag}`,
    placeholder: 'Show a section',
    options: VIEWS.filter((v) => v.value !== 'bob' || bh > 0).map((v) => ({
      label: v.label,
      value: v.value,
      description: v.description,
      emoji: v.emoji,
      default: v.value === view,
    })),
  };
  const buttons: DiscordButtonComponent[] = [];
  if (view === 'bob') buttons.push(bobDefenseButton(account.playerTag, bob.tasks.bbDefenseLv9.completed, true));
  buttons.push(DiscordService.openGameLinkButton('Open CoC'));

  // The menu and buttons are for the whole message, so they sit under the cards
  return layoutMessage(...shownCards, { type: 1, components: [menu] }, DiscordService.createActionRow(buttons));
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
    const message = buildUpgradesMessage(account, player, isCached, view);
    // A message sent before the new layouts still has embeds, which Discord wants cleared to switch it
    if (!(await reply.edit(message)) && !(await reply.edit({ ...message, content: null, embeds: [] }))) {
      await reply.followup({ content: "⚠️ Couldn't redraw this message. Run `/upgrades` again.", flags: 64 });
    }
  } catch (err: any) {
    log.error(`[Discord] Could not show the ${view} view of /upgrades for ${tag}:`, err);
    await reply.followup({ content: `❌ Couldn't load that section: ${err.message || 'API error'}`, flags: 64 });
  }
}
