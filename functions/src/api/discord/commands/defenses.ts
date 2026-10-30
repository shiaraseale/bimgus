import { DiscordService } from '../../../services/discordService';
import { CocAssetService } from '../../../services/cocAssetService';
import {
  MAX_BUILDER_HALL,
  MAX_TOWN_HALL,
  countForHall,
  formatLevelCost,
  formatNextCost,
  getById,
  getLevel,
  getMaxLevelForHall,
  itemsIn,
} from '../../../services/gameDataService';
import { PlayerTrackingService } from '../../../services/playerTrackingService';
import { VillageImportService } from '../../../services/villageImportService';
import { goldPassBoosts } from '../../../services/goldPass';
import { layoutMessage } from '../../../services/discordLayout';
import { DiscordButtonComponent } from '../../../types/discord';
import { bobDefenseButton } from '../components/bobDefense';
import { CommandContext, forEachLinkedAccount } from '../context';
import {
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
  name: 'defenses',
  description: 'Check defense max caps, gear-ups, and Hall upgrade status for your Town Hall / Builder Hall',
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

// Room for the text across both cards (Discord allows 4,000 characters per message)
const CARDS_BUDGET = 3700;

export async function execute(ctx: CommandContext): Promise<any> {
  const { sendAccountMessage, getPlayerWithFallback } = ctx;
  return forEachLinkedAccount(ctx, 'defense data', async (account, idx) => {
    const { player: freshPlayer, isCached } = await getPlayerWithFallback(account);
    const th = freshPlayer.townHallLevel;
    const bh = freshPlayer.builderHallLevel || 0;
    const village = VillageImportService.read(account.villageData);
    const halls = { townHall: th, builderHall: bh };
    const boosts = goldPassBoosts(account);
    // Without an import, list every defense the hall allows with its cap and the cost of its last level
    const hallCapLines = (village: 'home' | 'builder', hallLevel: number) =>
      itemsIn(village, ['defense'])
        .map((item) => ({ item, count: countForHall(item, hallLevel), max: getMaxLevelForHall(item, hallLevel) }))
        .filter((d) => d.count > 0 && d.max > 0)
        .map((d) => {
          const last = getLevel(d.item, d.max);
          return `• ${d.count}x **${d.item.displayName}**: Max Lv ${d.max}${last ? ` — ${formatLevelCost(d.item, last)}` : ''}`;
        });

    // Running timers, under each village's own card
    const timers = activeInProgress(village);
    const upgrading = (v: 'home' | 'builder'): CardSection[] => {
      const own = timers.filter((u) => u.village === v);
      if (own.length === 0) return [];
      return [
        {
          title: `⏳ Upgrading (${own.length})`,
          lines: VillageImportService.formatInProgressUpgrades(own).split('\n'),
        },
      ];
    };

    // Town Hall Status
    const townHall = getById(1000001);
    const thUpgradeCost = townHall ? formatNextCost(townHall, th, boosts) : '';
    const thUpgradeStr =
      th >= MAX_TOWN_HALL
        ? `🏆 **Town Hall**: Maxed (TH${MAX_TOWN_HALL})`
        : `• **Town Hall**: Lv ${th}/${th + 1}${thUpgradeCost ? ` — ${thUpgradeCost}` : ''}`;

    // High Gear achievement
    const highGear = (freshPlayer.achievements || []).find((a: any) => a.name === 'High Gear');
    const gearUpsCount = highGear ? Math.min(3, highGear.value || 0) : 0;
    const gearUpsStr =
      gearUpsCount >= 3
        ? '✅ **Home Defense Gear-Ups**: 3/3 (Cannon, Archer Tower, Mortar)'
        : `• **Defense Gear-Ups**: ${gearUpsCount}/3 (Cannon, Archer Tower, Mortar)`;

    // Defense lines: use imported village data if available, otherwise show target caps
    const importedHome = village
      ? VillageImportService.groupsFor(village, 'home', HOME_DEFENSE_CATEGORIES, halls, boosts)
      : [];
    const homeCapLines =
      importedHome.length > 0 ? importedHome.map(VillageImportService.formatGroupLine) : hallCapLines('home', th);
    const importedBuildings = village
      ? VillageImportService.groupsFor(village, 'home', BUILDING_CATEGORIES, halls, boosts)
      : [];

    const cards: VillageCard[] = [
      {
        village: 'home',
        hallLevel: th,
        sections: [
          ...upgrading('home'),
          { title: '🏰 Town Hall & Gear-Ups', lines: [thUpgradeStr, gearUpsStr] },
          {
            title: `🛡️ ${importedHome.length > 0 ? 'Current Defenses & Next Upgrades' : `Defense Upgrades to Max TH${th}`}`,
            lines: homeCapLines.length > 0 ? homeCapLines : ['No defenses recorded.'],
          },
          ...(importedBuildings.length > 0
            ? [
                {
                  title: '🏛️ Other Buildings & Storages',
                  lines: importedBuildings.map(VillageImportService.formatGroupLine),
                },
              ]
            : []),
        ],
      },
    ];

    let bob: any = null;
    if (bh > 0) {
      const builderHall = getById(1000034);
      const bhUpgradeCost = builderHall ? formatNextCost(builderHall, bh) : '';
      const bhUpgradeStr =
        bh >= MAX_BUILDER_HALL
          ? `🏆 **Builder Hall**: Maxed (BH${MAX_BUILDER_HALL})`
          : `• **Builder Hall**: Lv ${bh}/${bh + 1}${bhUpgradeCost ? ` — ${bhUpgradeCost}` : ''}`;

      bob = PlayerTrackingService.calculateSixthBuilderProgress(
        freshPlayer,
        village,
        account.bobDefenseCompleted || false
      );
      const bobDefStr = bob.tasks.bbDefenseLv9.completed
        ? '✅ **B.O.B Defense Lv 9**: Completed'
        : `🔄 **B.O.B Defense Lv 9**: 0/1 (Upgrade any BB defense to Lv 9)`;

      const importedBb = village
        ? VillageImportService.groupsFor(village, 'builder', BB_DEFENSE_CATEGORIES, halls)
        : [];
      const bbCapLines =
        importedBb.length > 0 ? importedBb.map(VillageImportService.formatGroupLine) : hallCapLines('builder', bh);

      cards.push({
        village: 'builder',
        hallLevel: bh,
        sections: [
          ...upgrading('builder'),
          { title: '🔨 Builder Hall & B.O.B', lines: [bhUpgradeStr, bobDefStr] },
          {
            title: `🛡️ ${importedBb.length > 0 ? 'Current Defenses & Next Upgrades' : `Defense Upgrades to Max BH${bh}`}`,
            lines: bbCapLines.length > 0 ? bbCapLines : ['No builder defenses recorded.'],
          },
        ],
      });
    }

    const hasImportedHome = importedHome.length > 0;
    const hasImportedBb = Boolean(village && village.builderHallLevel > 0);
    const hasImported = Boolean(village);
    const jsonNotice = getVillageJsonTimestampNotice(village);
    cards[0].intro = [
      isCached ? '⚠️ *CoC API is currently under maintenance. Displaying your last saved snapshot.*' : '',
      hasImportedHome
        ? hasImportedBb
          ? `Exact defenses for **Town Hall ${th}** and **Builder Hall ${bh}**.`
          : `Exact defenses for **Town Hall ${th}**.`
        : `Defense level limits and Hall upgrade requirements for **Town Hall ${th}**${bh > 0 ? ` and **Builder Hall ${bh}**` : ''}.\n*(The Supercell API doesn't include building levels.)*\n${NO_IMPORT_TEXT}`,
      jsonNotice || '',
    ]
      .filter(Boolean)
      .join('\n');

    const defButtons: DiscordButtonComponent[] = [];
    if (bh >= 1 && bob) {
      const toggleBtn = bobDefenseButton(account.playerTag, bob.tasks.bbDefenseLv9.completed, true);
      defButtons.push(toggleBtn);
    }
    defButtons.push(DiscordService.openGameLinkButton('Open CoC'));

    // A card per village, each list in full
    const shownCards = villageCards(cards, CARDS_BUDGET, {
      author: `[${account.name}] Defense ${hasImported ? 'Levels & Upgrades' : '& Hall Maxing Targets'}`,
      thumbnail: CocAssetService.getTownHallUrl(th),
      footer: `Account: ${account.name} (${account.playerTag})`,
    });
    await sendAccountMessage(idx, layoutMessage(...shownCards, DiscordService.createActionRow(defButtons)));
  });
}
