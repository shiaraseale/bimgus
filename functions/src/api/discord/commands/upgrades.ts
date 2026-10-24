import { DiscordService, COLORS } from '../../../services/discordService';
import { CocAssetService } from '../../../services/cocAssetService';
import { MAX_BUILDER_HALL } from '../../../services/gameDataService';
import { EMOJIS } from '../../../constants/emojis';
import { PlayerTrackingService } from '../../../services/playerTrackingService';
import { VillageImportService, ParsedDefenseGroup } from '../../../services/villageImportService';
import { bobDefenseButton } from '../components/bobDefense';
import { CommandContext, forEachLinkedAccount } from '../context';
import { formatProgressBar, getVillageJsonTimestampNotice, NO_IMPORT_TEXT, HOME_DEFENSE_CATEGORIES, BB_DEFENSE_CATEGORIES, BUILDING_CATEGORIES, activeInProgress, numberedFields } from '../ui';

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

export async function execute(ctx: CommandContext): Promise<any> {
  const { sendAccountMessage, getPlayerWithFallback } = ctx;
  return forEachLinkedAccount(ctx, 'upgrades', async (account, idx) => {
    const { player: freshPlayer, isCached } = await getPlayerWithFallback(account);
    const village = VillageImportService.read(account.villageData);
    const outstanding = PlayerTrackingService.calculateOutstandingUpgrades(
      freshPlayer,
      account.bobDefenseCompleted || false,
      village
    );
    const home = outstanding.byCategory.home;
    const bb = outstanding.byCategory.builder;
    const bob = bb.sixthBuilder;

    const formatItems = (
      items: Array<{ name: string; currentLevel: number; maxLevel: number; nextCost?: string }>,
      emptyText: string
    ) => {
      if (items.length === 0) return emptyText || '✅ Maxed!';
      const lines = items.map((i) => {
        const costStr = i.nextCost ? ` — ${i.nextCost}` : '';
        if (i.name === 'Town Hall' || i.name === 'Builder Hall') {
          return `• **${i.name}**: ${i.currentLevel}/${i.maxLevel}${costStr}`;
        }
        return `• **${i.name}**: Lv ${i.currentLevel}/${i.maxLevel}${costStr}`;
      });
      const text = lines.join('\n');
      if (text.length <= 900) return text;
      let accumulated = '';
      for (const line of lines) {
        if ((accumulated + line + '\n').length > 850) {
          accumulated += `... and ${lines.length - accumulated.split('\n').filter(Boolean).length} more`;
          break;
        }
        accumulated += line + '\n';
      }
      return accumulated.trim() || emptyText || '✅ Maxed!';
    };

    const gearUpEmoji = bob.tasks.gearUps.completed ? '✅' : '🔄';
    const troopEmoji = bob.tasks.bbTroopLv18.completed ? '✅' : '🔄';
    const defEmoji = bob.tasks.bbDefenseLv9.completed ? '✅' : '🔄';
    const heroEmoji = bob.tasks.bbHeroesLv45.completed ? '✅' : '🔄';

    const sixthBuilderText = [
      bob.unlocked
        ? '🎉 **B.O.B Unlocked! (6th Builder Active)**'
        : `⏳ **Progress (${bob.overallPercentage}%)**: ${formatProgressBar(bob.overallPercentage, 6)}`,
      `${gearUpEmoji} **Gear-Ups**: ${bob.tasks.gearUps.current}/3`,
      `${troopEmoji} **Troop Lv 18**: ${bob.tasks.bbTroopLv18.highestTroopName} (${bob.tasks.bbTroopLv18.current}/18)`,
      `${defEmoji} **Defense Lv 9**: ${bob.tasks.bbDefenseLv9.completed ? '1/1' : '0/1 (e.g. Mega Tesla)'}`,
      `${heroEmoji} **Heroes Lv 45**: ${bob.tasks.bbHeroesLv45.current}/45`,
    ].join('\n');

    const activeInProgressList = activeInProgress(account, village);

    const halls = { townHall: freshPlayer.townHallLevel, builderHall: freshPlayer.builderHallLevel || 0 };
    const importedHome: ParsedDefenseGroup[] = village
      ? VillageImportService.groupsFor(village, 'home', HOME_DEFENSE_CATEGORIES, halls)
      : [];
    const unmaxedHomeDef = importedHome.filter((d) => !d.isMaxed);

    const importedHomeBuildings: ParsedDefenseGroup[] = village
      ? VillageImportService.groupsFor(village, 'home', BUILDING_CATEGORIES, halls)
      : [];
    const unmaxedHomeBuildings = importedHomeBuildings.filter((d) => !d.isMaxed);

    const importedBb: ParsedDefenseGroup[] = village
      ? VillageImportService.groupsFor(village, 'builder', [...BB_DEFENSE_CATEGORIES, ...BUILDING_CATEGORIES], halls)
      : [];
    const unmaxedBbDef = importedBb.filter((d) => !d.isMaxed);

    const unmaxedBuildingLines = unmaxedHomeBuildings.map(VillageImportService.formatGroupLine);
    const thGearUpText = formatItems(home.buildings, '');
    const homeBuildingLines = [thGearUpText, ...unmaxedBuildingLines].filter(Boolean);
    const homeBuildingFields: any[] = [];
    const totalBuildingsCount = home.buildings.length + unmaxedHomeBuildings.length;

    if (homeBuildingLines.length === 0) {
      homeBuildingFields.push({
        name: `🏛️ Buildings & Storages (0)`,
        value: '✅ All buildings, storages & gear-ups maxed!',
        inline: false,
      });
    } else {
      homeBuildingFields.push(...numberedFields('🏛️ Buildings & Storages', totalBuildingsCount, homeBuildingLines));
    }

    const bbBuildingText = formatItems(bb.buildings, `✅ Builder Hall maxed for BH${freshPlayer.builderHallLevel || MAX_BUILDER_HALL}!`);

    const homeDefFields: any[] = [];
    if (importedHome.length > 0) {
      if (unmaxedHomeDef.length > 0) {
        const homeDefLines = unmaxedHomeDef.map(VillageImportService.formatGroupLine);
        homeDefFields.push(...numberedFields('🛡️ Defenses', unmaxedHomeDef.length, homeDefLines));
      } else {
        homeDefFields.push({
          name: `🛡️ Defenses (0)`,
          value: `✅ All home defenses maxed for TH${freshPlayer.townHallLevel}!`,
          inline: false,
        });
      }
    } else {
      homeDefFields.push({
        name: `🛡️ Defenses`,
        value: NO_IMPORT_TEXT,
        inline: false,
      });
    }

    const bbDefFields: any[] = [];
    if (importedBb.length > 0) {
      if (unmaxedBbDef.length > 0) {
        const bbDefLines = unmaxedBbDef.map(VillageImportService.formatGroupLine);
        bbDefFields.push(...numberedFields('🛡️ BB Defenses', unmaxedBbDef.length, bbDefLines));
      } else {
        bbDefFields.push({
          name: `🛡️ BB Defenses (0)`,
          value: `✅ All BB defenses maxed for BH${freshPlayer.builderHallLevel || MAX_BUILDER_HALL}!`,
          inline: false,
        });
      }
    } else {
      bbDefFields.push({
        name: `🛡️ BB Defenses`,
        value: NO_IMPORT_TEXT,
        inline: false,
      });
    }

    let totalOutstandingLevels = outstanding.totalRemainingLevels;
    if (importedHome.length > 0) {
      for (const d of unmaxedHomeDef) {
        totalOutstandingLevels += d.count * Math.max(0, d.maxLevel - d.currentLevel);
      }
    }
    if (importedHomeBuildings.length > 0) {
      for (const d of unmaxedHomeBuildings) {
        totalOutstandingLevels += d.count * Math.max(0, d.maxLevel - d.currentLevel);
      }
    }
    if (importedBb.length > 0) {
      for (const d of unmaxedBbDef) {
        totalOutstandingLevels += d.count * Math.max(0, d.maxLevel - d.currentLevel);
      }
    }

    const fields: any[] = [];

    if (activeInProgressList.length > 0) {
      const timerText = VillageImportService.formatInProgressUpgrades(activeInProgressList);
      fields.push({
        name: `⏳ In-Progress Upgrades (${activeInProgressList.length})`,
        value: timerText.length > 1024 ? timerText.slice(0, 1020) + '...' : timerText,
        inline: false,
      });
    }

    fields.push(
      // PART 1: HOME VILLAGE
      {
        name: `🏰 ━━━━ HOME VILLAGE (TH${freshPlayer.townHallLevel}) ━━━━`,
        value: `Research & upgrades remaining to max Town Hall ${freshPlayer.townHallLevel}:`,
        inline: false,
      },
      ...homeBuildingFields,
      ...homeDefFields,
      {
        name: `${EMOJIS.CROWN} Heroes (${home.heroes.length})`,
        value: formatItems(home.heroes, `✅ All heroes maxed for TH${freshPlayer.townHallLevel}!`),
        inline: false,
      },
      {
        name: `${EMOJIS.ANVIL} Hero Equipment (${home.equipment.length})`,
        value: formatItems(home.equipment, `✅ All equipment maxed for TH${freshPlayer.townHallLevel}!`),
        inline: false,
      },
      {
        name: `🧪 Spells (${home.spells.length})`,
        value: formatItems(home.spells, `✅ All spells maxed for TH${freshPlayer.townHallLevel}!`),
        inline: false,
      },
      {
        name: `⚔️ Troops (${home.troops.length})`,
        value: formatItems(home.troops, `✅ All troops maxed for TH${freshPlayer.townHallLevel}!`),
        inline: false,
      },

      // PART 2: BUILDER BASE
      {
        name: `🔨 ━━━━ BUILDER BASE (BH${freshPlayer.builderHallLevel || 'N/A'}) ━━━━`,
        value: `Research & upgrades remaining to max Builder Hall ${freshPlayer.builderHallLevel || 'N/A'}:`,
        inline: false,
      },
      {
        name: `🤖 6th Builder (B.O.B) Tracker`,
        value: sixthBuilderText,
        inline: false,
      },
      {
        name: `🏛️ BB Buildings (${bb.buildings.length})`,
        value: bbBuildingText,
        inline: false,
      },
      ...bbDefFields,
      {
        name: `${EMOJIS.CROWN} BB Heroes (${bb.heroes.length})`,
        value: formatItems(bb.heroes, `✅ All BB heroes maxed for BH${freshPlayer.builderHallLevel || MAX_BUILDER_HALL}!`),
        inline: false,
      },
      {
        name: `⚔️ BB Troops (${bb.troops.length})`,
        value: formatItems(bb.troops, `✅ All BB troops maxed for BH${freshPlayer.builderHallLevel || MAX_BUILDER_HALL}!`),
        inline: false,
      }
    );

    for (const f of fields) {
      if (!f.value || !f.value.trim()) f.value = '✅ Maxed!';
      if (f.value.length > 1024) f.value = f.value.slice(0, 1020) + '...';
    }

    const jsonNotice = getVillageJsonTimestampNotice(village, 'Defenses & buildings based on the export taken');

    const embed = {
      title: `🏰 [${account.name}] Live Upgrades & Maxing Overview`,
      description: [
        isCached ? '⚠️ *CoC API is currently under maintenance. Displaying your last saved snapshot.*\n' : '',
        'Real-time progression synchronized directly from official Clash of Clans API.',
        jsonNotice || '',
        `*Total Outstanding Levels: **${totalOutstandingLevels}***`,
      ].filter(Boolean).join('\n'),
      fields,
      color: COLORS.GOLD,
      thumbnail: {
        url:
          CocAssetService.getPlayerLeagueUrl(freshPlayer) ||
          CocAssetService.getTownHallUrl(freshPlayer.townHallLevel),
      },
      footer: { text: `Town Hall ${freshPlayer.townHallLevel} • Builder Hall ${freshPlayer.builderHallLevel || 'N/A'} • Account: ${account.name} (${account.playerTag})` },
      timestamp: new Date().toISOString(),
    };

    const upgradeButtons: any[] = [];
    if ((freshPlayer.builderHallLevel || 0) >= 1) {
      const toggleBtn = bobDefenseButton(account.playerTag, bob.tasks.bbDefenseLv9.completed, true);
      upgradeButtons.push(toggleBtn);
    }
    upgradeButtons.push(DiscordService.openGameLinkButton('Open CoC'));

    await sendAccountMessage(idx, {
      embeds: [embed],
      components: [DiscordService.createActionRow(upgradeButtons)],
    });
  });
}
