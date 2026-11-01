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
import { columnRows, layoutMessage } from '../../../services/discordLayout';
import commandWords from '../../../templates/commands.json';
import shared from '../../../templates/shared.json';
import { accountFooter, fill } from '../../../templates';
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

const words = commandWords.defenses;

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
      columnRows(
        itemsIn(village, ['defense'])
          .map((item) => ({ item, count: countForHall(item, hallLevel), max: getMaxLevelForHall(item, hallLevel) }))
          .filter((d) => d.count > 0 && d.max > 0)
          .map((d) => {
            const last = getLevel(d.item, d.max);
            return {
              label: `${d.count}x ${d.item.displayName}`,
              value: fill(words.capLevel, { max: d.max }),
              after: last ? formatLevelCost(d.item, last) : undefined,
            };
          })
      );

    // Running timers, under each village's own card
    const timers = activeInProgress(village);
    const upgrading = (v: 'home' | 'builder'): CardSection[] => {
      const own = timers.filter((u) => u.village === v);
      if (own.length === 0) return [];
      return [
        {
          title: fill(shared.upgrading, { count: own.length }),
          lines: VillageImportService.formatInProgressUpgrades(own).split('\n'),
        },
      ];
    };

    // Town Hall Status
    const townHall = getById(1000001);
    const thUpgradeCost = townHall ? formatNextCost(townHall, th, boosts) : '';
    const thUpgradeStr =
      th >= MAX_TOWN_HALL
        ? fill(words.townHallMaxed, { level: MAX_TOWN_HALL })
        : fill(thUpgradeCost ? words.townHallNextCost : words.townHallNext, {
            level: th,
            next: th + 1,
            cost: thUpgradeCost,
          });

    // High Gear achievement
    const highGear = (freshPlayer.achievements || []).find((a: any) => a.name === 'High Gear');
    const gearUpsCount = highGear ? Math.min(3, highGear.value || 0) : 0;
    const gearUpsStr = gearUpsCount >= 3 ? words.gearUpsDone : fill(words.gearUps, { count: gearUpsCount });

    // Defense lines: use imported village data if available, otherwise show target caps
    const importedHome = village
      ? VillageImportService.groupsFor(village, 'home', HOME_DEFENSE_CATEGORIES, halls, boosts)
      : [];
    const homeCapLines =
      importedHome.length > 0 ? columnRows(importedHome.map(VillageImportService.groupRow)) : hallCapLines('home', th);
    const importedBuildings = village
      ? VillageImportService.groupsFor(village, 'home', BUILDING_CATEGORIES, halls, boosts)
      : [];

    const cards: VillageCard[] = [
      {
        village: 'home',
        hallLevel: th,
        sections: [
          ...upgrading('home'),
          { title: words.townHallSection, lines: [thUpgradeStr, gearUpsStr] },
          {
            title: importedHome.length > 0 ? words.importedSection : fill(words.homeCapsSection, { level: th }),
            lines: homeCapLines.length > 0 ? homeCapLines : [words.noDefenses],
          },
          ...(importedBuildings.length > 0
            ? [
                {
                  title: words.otherBuildings,
                  lines: columnRows(importedBuildings.map(VillageImportService.groupRow)),
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
          ? fill(words.builderHallMaxed, { level: MAX_BUILDER_HALL })
          : fill(bhUpgradeCost ? words.builderHallNextCost : words.builderHallNext, {
              level: bh,
              next: bh + 1,
              cost: bhUpgradeCost,
            });

      bob = PlayerTrackingService.calculateSixthBuilderProgress(
        freshPlayer,
        village,
        account.bobDefenseCompleted || false
      );
      const bobDefStr = bob.tasks.bbDefenseLv9.completed ? words.bobDone : words.bobLeft;

      const importedBb = village
        ? VillageImportService.groupsFor(village, 'builder', BB_DEFENSE_CATEGORIES, halls)
        : [];
      const bbCapLines =
        importedBb.length > 0 ? columnRows(importedBb.map(VillageImportService.groupRow)) : hallCapLines('builder', bh);

      cards.push({
        village: 'builder',
        hallLevel: bh,
        sections: [
          ...upgrading('builder'),
          { title: words.builderSection, lines: [bhUpgradeStr, bobDefStr] },
          {
            title: importedBb.length > 0 ? words.importedSection : fill(words.builderCapsSection, { level: bh }),
            lines: bbCapLines.length > 0 ? bbCapLines : [words.noBuilderDefenses],
          },
        ],
      });
    }

    const hasImportedHome = importedHome.length > 0;
    const hasImportedBb = Boolean(village && village.builderHallLevel > 0);
    const hasImported = Boolean(village);
    const jsonNotice = getVillageJsonTimestampNotice(village);
    cards[0].intro = [
      isCached ? shared.maintenance : '',
      hasImportedHome
        ? hasImportedBb
          ? fill(words.exactBoth, { th, bh })
          : fill(words.exactHome, { th })
        : fill(bh > 0 ? words.capsBoth : words.capsHome, { th, bh, noImport: NO_IMPORT_TEXT }),
      jsonNotice || '',
    ]
      .filter(Boolean)
      .join('\n');

    const defButtons: DiscordButtonComponent[] = [];
    if (bh >= 1 && bob) {
      const toggleBtn = bobDefenseButton(account.playerTag, bob.tasks.bbDefenseLv9.completed, true);
      defButtons.push(toggleBtn);
    }
    defButtons.push(DiscordService.openGameLinkButton());

    // A card per village, each list in full
    const shownCards = villageCards(cards, CARDS_BUDGET, {
      author: fill(hasImported ? words.authorImported : words.authorCaps, { name: account.name }),
      thumbnail: CocAssetService.getTownHallUrl(th),
      footer: accountFooter(account),
      buttons: defButtons,
    });
    await sendAccountMessage(idx, layoutMessage(...shownCards));
  });
}
