import { DiscordService } from '../../../services/discordService';
import { CocAssetService } from '../../../services/cocAssetService';
import { CocService } from '../../../services/cocService';
import { FirestoreService } from '../../../services/firestoreService';
import { getPlayerWithFallback } from '../../../services/playerFallback';
import { EMOJIS } from '../../../constants/emojis';
import { config } from '../../../config';
import { PlayerTrackingService } from '../../../services/playerTrackingService';
import { ParsedDefenseGroup, VillageDataV2, VillageImportService } from '../../../services/villageImportService';
import { CostBoosts, GameCategory, Village } from '../../../services/gameDataService';
import { goldPassBoosts, nextBoostStep } from '../../../services/goldPass';
import { interactionReply } from '../../../jobs/interactionReply';
import { LinkedAccount, OutstandingUpgradeItem } from '../../../types/user';
import type { PlayerLike } from '../../../types/coc';
import { log } from '../../../utils/log';
import { card, layoutMessage } from '../../../services/discordLayout';
import { DiscordButtonComponent, DiscordStringSelectComponent } from '../../../types/discord';
import { bobDefenseButton } from '../components/bobDefense';
import { CommandContext } from '../context';
import {
  formatProgressBar,
  getVillageJsonTimestampNotice,
  NO_IMPORT_TEXT,
  HOME_DEFENSE_CATEGORIES,
  BB_DEFENSE_CATEGORIES,
  BUILDING_CATEGORIES,
  activeInProgress,
  villageCards,
  villageHeading,
  CardSection,
  VILLAGE_COLORS,
} from '../ui';

/** Slash command definition, registered by scripts/registerCommands.ts (it was /upgrades until 2026-10-30) */
export const definition = {
  name: 'status',
  description: 'Running timers and what is left to upgrade, with menus to pick the account, village and area',
  contexts: [0, 1],
  integration_types: [0],
  options: [
    {
      name: 'account',
      description: 'Player tag of the account to open on (the message has a menu to switch)',
      type: 3, // STRING
      required: false,
    },
  ],
};

// Runs as a Cloud Task (3.7): its work happens after the "thinking…" reply
export const runsAsTask = true;

export type StatusArea = 'overview' | 'buildings' | 'defenses' | 'heroes' | 'lab' | 'bob';

/** What one /status message shows for its account: a village, and an area of it. */
export interface StatusView {
  village: Village;
  area: StatusArea;
}

const OPENING_VIEW: StatusView = { village: 'home', area: 'overview' };

// "<:crown:123>" as a component emoji
const customEmoji = (markup: string) => {
  const [, name, id] = markup.match(/<:(\w+):(\d+)>/) ?? [];
  return id ? { name, id } : { name: markup };
};

// The areas in the menu, with what each covers in each village (B.O.B is on the Builder Base only)
const AREAS: Array<{
  value: StatusArea;
  label: string;
  emoji: { name: string; id?: string };
  covers: Partial<Record<Village, string>>;
}> = [
  {
    value: 'overview',
    label: 'Overview',
    emoji: { name: '📋' },
    covers: { home: 'Timers and what is left, in short', builder: 'Timers and what is left, in short' },
  },
  {
    value: 'buildings',
    label: 'Buildings',
    emoji: { name: '🏛️' },
    covers: { home: 'Halls, resources, army and walls', builder: 'Halls, resources, army and walls' },
  },
  {
    value: 'defenses',
    label: 'Defenses',
    emoji: { name: '🛡️' },
    covers: { home: 'Defenses, traps, guardians and crafted', builder: 'Defenses and traps' },
  },
  {
    value: 'heroes',
    label: 'Heroes',
    emoji: customEmoji(EMOJIS.CROWN),
    covers: { home: 'Heroes and hero equipment', builder: 'Battle Machine and Battle Copter' },
  },
  { value: 'lab', label: 'Lab', emoji: { name: '🧪' }, covers: { home: 'Troops and spells', builder: 'Troops' } },
  {
    value: 'bob',
    label: '6th Builder (B.O.B)',
    emoji: { name: '🤖' },
    covers: { builder: 'Progress to the 6th builder' },
  },
];

// Each menu's custom_id carries the message's whole state: "status:<menu>:<tag>:<village>:<area>"
const MENU = 'status:';
type StatusMenu = 'account' | 'village' | 'area';
// The Gold Pass buttons: their custom_ids carry the same state, "status:<boost>:<tag>:<village>:<area>"
const BOOST_LABELS: Record<keyof CostBoosts, string> = { builder: 'Builder Boost', research: 'Research Boost' };
// The single menu on /upgrades messages from before /status: "upgrades_view:<tag>"
const OLD_MENU = 'upgrades_view:';
// Walls get their own line: hundreds of segments would swamp the building counts
const NON_WALL_BUILDINGS = BUILDING_CATEGORIES.filter((c) => c !== 'wall');
// Room for the card's text (Discord allows 4,000 characters per message)
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

/** Everything /status shows for one account, worked out once for whichever view is drawn. */
function upgradeData(account: LinkedAccount, player: PlayerLike, village: VillageDataV2 | null) {
  const boosts = goldPassBoosts(account);
  const outstanding = PlayerTrackingService.calculateOutstandingUpgrades(
    player,
    account.bobDefenseCompleted || false,
    village,
    boosts
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
    village ? VillageImportService.groupsFor(village, v, categories, halls, boosts).filter((g) => !g.isMaxed) : null;

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

  return { th, bh, bob: bb.sixthBuilder, sections, timers: activeInProgress(village) };
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

/** The view, adjusted to what the account has: no Builder Base yet, or B.O.B outside the Builder Base. */
function fitView(view: StatusView, builderHall: number): StatusView {
  const village: Village = view.village === 'builder' && builderHall > 0 ? 'builder' : 'home';
  const area = AREAS.find((a) => a.value === view.area && a.covers[village]) ? view.area : 'overview';
  return { village, area };
}

const menuId = (menu: StatusMenu | keyof CostBoosts, tag: string, view: StatusView) =>
  `${MENU}${menu}:${tag}:${view.village}:${view.area}`;

/** Steps one Gold Pass boost for this account, and says where it's at ("Builder Boost: 20%"). */
function boostButton(account: LinkedAccount, view: StatusView, boost: keyof CostBoosts): DiscordButtonComponent {
  const percent = goldPassBoosts(account)[boost];
  return {
    type: 2,
    style: 2,
    label: `${BOOST_LABELS[boost]}: ${percent ? `${percent}%` : 'Off'}`,
    custom_id: menuId(boost, account.playerTag, view),
  };
}

/**
 * The menus at the bottom of a /status card: the account (with more than one linked), the village (once
 * there's a Builder Base) and the area. Each says what's picked, and carries the other two.
 */
function statusMenus(
  accounts: LinkedAccount[],
  account: LinkedAccount,
  view: StatusView,
  halls: { th: number; bh: number }
): DiscordStringSelectComponent[] {
  const menus: DiscordStringSelectComponent[] = [];
  if (accounts.length > 1) {
    menus.push({
      type: 3,
      custom_id: menuId('account', account.playerTag, view),
      placeholder: 'Account',
      // Discord allows 25 options
      options: accounts.slice(0, 25).map((a) => ({
        label: a.name,
        value: a.playerTag,
        description: `${a.playerTag} · TH${a.townHallLevel}`,
        default: a.playerTag === account.playerTag,
      })),
    });
  }
  if (halls.bh > 0) {
    menus.push({
      type: 3,
      custom_id: menuId('village', account.playerTag, view),
      placeholder: 'Village',
      options: [
        {
          label: `Home Village (TH${halls.th})`,
          value: 'home',
          emoji: { name: '🏰' },
          default: view.village === 'home',
        },
        {
          label: `Builder Base (BH${halls.bh})`,
          value: 'builder',
          emoji: { name: '🔨' },
          default: view.village === 'builder',
        },
      ],
    });
  }
  menus.push({
    type: 3,
    custom_id: menuId('area', account.playerTag, view),
    placeholder: 'Area',
    options: AREAS.filter((a) => a.covers[view.village]).map((a) => ({
      label: a.label,
      value: a.value,
      description: a.covers[view.village],
      emoji: a.emoji,
      default: a.value === view.area,
    })),
  });
  return menus;
}

/**
 * One /status message: one account's village, either the overview (timers, then a line per category)
 * or one area's full list, with the menus to switch account, village and area under it.
 */
export function buildStatusMessage(
  accounts: LinkedAccount[],
  account: LinkedAccount,
  player: PlayerLike,
  isCached: boolean,
  requested: StatusView = OPENING_VIEW
) {
  const village = VillageImportService.read(account.villageData);
  const { th, bh, bob, sections: s, timers } = upgradeData(account, player, village);
  const view = fitView(requested, bh);
  const isHome = view.village === 'home';

  const upgrading: CardSection[] = (() => {
    const own = timers.filter((u) => u.village === view.village);
    if (own.length === 0) return [];
    return [
      { title: `⏳ Upgrading (${own.length})`, lines: VillageImportService.formatInProgressUpgrades(own).split('\n') },
    ];
  })();

  // The village's categories, as listed in its overview
  const overviewSections = isHome
    ? [s.buildings, ...wallsLeft(s.walls), s.defenses, s.heroes, s.equipment, s.troops, s.spells]
    : [s.bbBuildings, ...wallsLeft(s.bbWalls), s.bbDefenses, s.bbHeroes, s.bbTroops];

  let sections: CardSection[];
  if (view.area === 'overview') {
    const bobLine = bob.unlocked
      ? '🤖 **B.O.B**: 🎉 unlocked'
      : `🤖 **B.O.B**: ${formatProgressBar(bob.overallPercentage, 6)}`;
    sections = [
      ...upgrading,
      { title: '📋 Left to Upgrade', lines: [...(isHome ? [] : [bobLine]), ...overviewSections.map(summaryLine)] },
    ];
  } else if (view.area === 'bob') {
    sections = [{ title: '🤖 6th Builder (B.O.B)', lines: bobText(bob) }];
  } else {
    const shown: Record<Exclude<StatusArea, 'overview' | 'bob'>, [Section[], Section[]]> = {
      buildings: [
        [s.buildings, ...wallsLeft(s.walls)],
        [s.bbBuildings, ...wallsLeft(s.bbWalls)],
      ],
      defenses: [[s.defenses], [s.bbDefenses]],
      heroes: [[s.heroes, s.equipment], [s.bbHeroes]],
      lab: [[s.troops, s.spells], [s.bbTroops]],
    };
    sections = shown[view.area][isHome ? 0 : 1].map(cardSection);
  }

  // Levels still to go in this village, across what the overview lists
  const levelsLeft = overviewSections.reduce((n, sec) => n + sec.levels, 0);
  const usesImport = ['overview', 'buildings', 'defenses'].includes(view.area);
  const intro = [
    isCached ? '⚠️ *CoC API is currently under maintenance. Displaying your last saved snapshot.*' : '',
    usesImport ? getVillageJsonTimestampNotice(village, 'Defenses & buildings based on the export taken') : '',
    view.area === 'overview' ? `**${levelsLeft}** levels left. Pick an area below for the full list.` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const buttons: DiscordButtonComponent[] = [];
  if (view.area === 'bob') buttons.push(bobDefenseButton(account.playerTag, bob.tasks.bbDefenseLv9.completed, true));
  // The boosts only change Home Village costs
  if (isHome) buttons.push(boostButton(account, view, 'builder'), boostButton(account, view, 'research'));
  buttons.push(DiscordService.openGameLinkButton('Open CoC'));

  const label = AREAS.find((a) => a.value === view.area)!.label;
  const shownCards = villageCards(
    [{ village: view.village, hallLevel: isHome ? th : bh, intro: intro || undefined, sections }],
    VIEW_BUDGET,
    {
      author: `[${account.name}] Status${view.area === 'overview' ? '' : `: ${label}`}`,
      thumbnail: isHome
        ? CocAssetService.getPlayerLeagueUrl(player) || CocAssetService.getTownHallUrl(th)
        : CocAssetService.getBuilderHallUrl(bh),
      footer: `Account: ${account.name} (${account.playerTag})`,
      menus: statusMenus(accounts, account, view, { th, bh }),
      buttons,
      more: (hidden) => `…and ${hidden} more`,
    }
  );

  // One card: the menus and buttons are at its bottom
  return layoutMessage(...shownCards);
}

/** The account couldn't be loaded: say so on its card, and keep the menus so another can be picked. */
function statusErrorMessage(accounts: LinkedAccount[], account: LinkedAccount, view: StatusView, err: any) {
  const bh = account.builderHallLevel || 0;
  const fitted = fitView(view, bh);
  return layoutMessage(
    card({
      accent: VILLAGE_COLORS[fitted.village],
      author: `[${account.name}] Status`,
      title: villageHeading(fitted.village, fitted.village === 'home' ? account.townHallLevel : bh),
      body: `❌ Could not load **${account.name}** (${account.playerTag}): ${err?.message || 'API error'}`,
      menus: statusMenus(accounts, account, fitted, { th: account.townHallLevel, bh }),
    })
  );
}

/** Loads the account from the CoC API (or its saved snapshot) and draws its /status message. */
async function loadStatusMessage(
  accounts: LinkedAccount[],
  account: LinkedAccount,
  view: StatusView,
  getPlayer: (a: LinkedAccount) => Promise<{ player: PlayerLike; isCached: boolean }>
) {
  try {
    const { player, isCached } = await getPlayer(account);
    return buildStatusMessage(accounts, account, player, isCached, view);
  } catch (err: any) {
    log.error(`[Discord] Could not load /status for ${account.playerTag}:`, err);
    return statusErrorMessage(accounts, account, view, err);
  }
}

export async function execute(ctx: CommandContext): Promise<any> {
  ctx.deferReply();
  ctx.track(async () => {
    try {
      // Every linked account goes in the account menu; the option only picks the one it opens on
      const { accounts, error } = await ctx.getTargetAccounts();
      if (error || accounts.length === 0) {
        await ctx.editDeferredReply({ content: error || 'No linked accounts found.' });
        return;
      }
      const wanted = ctx.optionsMap['account'] ? config.formatTag(ctx.optionsMap['account']) : null;
      const account = wanted ? accounts.find((a) => a.playerTag.toUpperCase() === wanted.toUpperCase()) : accounts[0];
      if (!account) {
        await ctx.editDeferredReply({
          content: `⚠️ Account with tag \`${wanted}\` is not linked. Use \`/accounts\` to see your linked accounts.`,
        });
        return;
      }
      await ctx.sendAccountMessage(
        0,
        await loadStatusMessage(accounts, account, OPENING_VIEW, ctx.getPlayerWithFallback)
      );
    } catch (cmdErr: any) {
      log.error(`Failed to execute /${ctx.name}:`, cmdErr);
      await ctx.editDeferredReply({ content: `❌ Error processing request: ${cmdErr.message}` });
    }
  });
}

/**
 * The account and view a menu pick asks for: the picked value in place of that menu's part of the state.
 * A Gold Pass button keeps the view and names the boost to step.
 */
export function readStatusPick(
  customId: string,
  picked: string | undefined
): { tag: string; view: StatusView; boost?: keyof CostBoosts } {
  if (customId.startsWith(OLD_MENU)) {
    // Old /upgrades messages showed both villages; they open on the Home Village
    return {
      tag: customId.slice(OLD_MENU.length),
      view: { village: 'home', area: (picked as StatusArea) || 'overview' },
    };
  }
  const [menu, tag, village, area] = customId.slice(MENU.length).split(':');
  const view = { village: village as Village, area: area as StatusArea };
  if (menu === 'account') return { tag: picked || tag, view };
  if (menu === 'village') return { tag, view: { ...view, village: picked as Village } };
  if (menu === 'builder' || menu === 'research') return { tag, view, boost: menu };
  return { tag, view: { ...view, area: picked as StatusArea } };
}

export function isStatusMenu(customId: string): boolean {
  return customId.startsWith(MENU) || customId.startsWith(OLD_MENU);
}

/**
 * Redraws a /status message with what was picked in one of its menus. The interaction has already been
 * answered with "deferred update", so this edits the message the menu is on.
 */
export async function showStatusView(interaction: any): Promise<void> {
  const reply = interactionReply({
    applicationId: interaction.application_id || config.discord.clientId,
    interactionToken: interaction.token,
  });
  const { tag, view, boost } = readStatusPick(String(interaction.data.custom_id), interaction.data.values?.[0]);
  try {
    const discordUserId = (interaction.user || interaction.member?.user)?.id;
    const user = discordUserId ? await FirestoreService.getUser(discordUserId) : null;
    const account = user?.accounts.find((a) => a.playerTag.toUpperCase() === tag.toUpperCase());
    if (!user || !account) {
      await reply.followup({ content: `⚠️ \`${tag}\` isn't linked to your profile any more.`, flags: 64 });
      return;
    }
    if (boost) {
      account.goldPass = nextBoostStep(account, boost);
      await FirestoreService.saveUser(user);
    }
    const message = await loadStatusMessage(user.accounts, account, view, (a) =>
      getPlayerWithFallback(CocService.shared(), a)
    );
    // A message sent before the new layouts still has embeds, which Discord wants cleared to switch it
    if (!(await reply.edit(message)) && !(await reply.edit({ ...message, content: null, embeds: [] }))) {
      await reply.followup({ content: "⚠️ Couldn't redraw this message. Run `/status` again.", flags: 64 });
    }
  } catch (err: any) {
    log.error(`[Discord] Could not show ${view.village}/${view.area} of /status for ${tag}:`, err);
    await reply.followup({ content: `❌ Couldn't load that: ${err.message || 'API error'}`, flags: 64 });
  }
}
