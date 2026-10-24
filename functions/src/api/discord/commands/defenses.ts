import { DiscordService, COLORS } from '../../../services/discordService';
import { CocAssetService } from '../../../services/cocAssetService';
import { MAX_BUILDER_HALL, MAX_TOWN_HALL, countForHall, formatLevelCost, formatNextCost, getById, getLevel, getMaxLevelForHall, itemsIn } from '../../../services/gameDataService';
import { PlayerTrackingService } from '../../../services/playerTrackingService';
import { VillageImportService } from '../../../services/villageImportService';
import { bobDefenseButton } from '../components/bobDefense';
import { CommandContext, forEachLinkedAccount } from '../context';
import { getVillageJsonTimestampNotice, NO_IMPORT_TEXT, HOME_DEFENSE_CATEGORIES, BB_DEFENSE_CATEGORIES, BUILDING_CATEGORIES, activeInProgress } from '../ui';

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

export async function execute(ctx: CommandContext): Promise<any> {
  const { sendAccountMessage, getPlayerWithFallback } = ctx;
  return forEachLinkedAccount(ctx, 'defense data', async (account, idx) => {
    const { player: freshPlayer, isCached } = await getPlayerWithFallback(account);
    const th = freshPlayer.townHallLevel;
    const bh = freshPlayer.builderHallLevel || 0;
    const village = VillageImportService.read(account.villageData);
    const halls = { townHall: th, builderHall: bh };
    // Without an import, list every defense the hall allows with its cap and the cost of its last level
    const hallCapLines = (village: 'home' | 'builder', hallLevel: number) =>
      itemsIn(village, ['defense'])
        .map((item) => ({ item, count: countForHall(item, hallLevel), max: getMaxLevelForHall(item, hallLevel) }))
        .filter((d) => d.count > 0 && d.max > 0)
        .map((d) => {
          const last = getLevel(d.item, d.max);
          return `• ${d.count}x **${d.item.displayName}**: Max Lv ${d.max}${last ? ` — ${formatLevelCost(d.item, last)}` : ''}`;
        });

    const activeInProgressList = activeInProgress(account, village);

    // Town Hall Status
    const townHall = getById(1000001);
    const thUpgradeCost = townHall ? formatNextCost(townHall, th) : '';
    const thUpgradeStr = th >= MAX_TOWN_HALL
      ? `🏆 **Town Hall**: Maxed (TH${MAX_TOWN_HALL})`
      : `• **Town Hall**: 0/1${thUpgradeCost ? ` — ${thUpgradeCost}` : ''}`;

    // High Gear achievement
    const highGear = (freshPlayer.achievements || []).find((a: any) => a.name === 'High Gear');
    const gearUpsCount = highGear ? Math.min(3, highGear.value || 0) : 0;
    const gearUpsStr = gearUpsCount >= 3
      ? '✅ **Home Defense Gear-Ups**: 3/3 (Cannon, Archer Tower, Mortar)'
      : `• **Defense Gear-Ups**: ${gearUpsCount}/3 (Cannon, Archer Tower, Mortar)`;

    // Defense lines: use imported village data if available, otherwise show target caps
    const importedHome = village ? VillageImportService.groupsFor(village, 'home', HOME_DEFENSE_CATEGORIES, halls) : [];
    const homeCapLines = importedHome.length > 0
      ? importedHome.map(VillageImportService.formatGroupLine)
      : hallCapLines('home', th);

    const fields: any[] = [];

    if (activeInProgressList.length > 0) {
      const timerText = VillageImportService.formatInProgressUpgrades(activeInProgressList);
      fields.push({
        name: `⏳ In-Progress Upgrades (${activeInProgressList.length})`,
        value: timerText.length > 1024 ? timerText.slice(0, 1020) + '...' : timerText,
        inline: false,
      });
    }

    const homeHeader = [
      thUpgradeStr,
      gearUpsStr,
      '',
      `🛡️ **${importedHome.length > 0 ? 'Current Defenses & Next Upgrades' : `Defense Upgrades to Max TH${th}`}:**`,
    ].join('\n');

    const homeChunks: string[] = [];
    let curChunk = '';
    for (const line of homeCapLines) {
      if ((curChunk + line + '\n').length > 850 && curChunk.length > 0) {
        homeChunks.push(curChunk.trim());
        curChunk = '';
      }
      curChunk += line + '\n';
    }
    if (curChunk.trim().length > 0) {
      homeChunks.push(curChunk.trim());
    }

    if (homeChunks.length <= 1) {
      fields.push({
        name: `🏰 Home Village Defenses (TH${th})`,
        value: [homeHeader, homeChunks[0] || 'No defenses recorded.'].join('\n'),
        inline: false,
      });
    } else {
      fields.push({
        name: `🏰 Home Village Defenses (TH${th})`,
        value: [homeHeader, homeChunks[0]].join('\n'),
        inline: false,
      });
      for (let c = 1; c < homeChunks.length; c++) {
        fields.push({
          name: `🏰 Home Village Defenses (TH${th} Cont. ${c + 1})`,
          value: homeChunks[c],
          inline: false,
        });
      }
    }

    const importedBuildings = village ? VillageImportService.groupsFor(village, 'home', BUILDING_CATEGORIES, halls) : [];
    if (importedBuildings.length > 0) {
      fields.push(
        ...VillageImportService.linesToFields(
          `🏛️ Other Buildings & Storages (TH${th})`,
          importedBuildings.map(VillageImportService.formatGroupLine)
        )
      );
    }

    let bob: any = null;
    if (bh > 0) {
      const builderHall = getById(1000034);
      const bhUpgradeCost = builderHall ? formatNextCost(builderHall, bh) : '';
      const bhUpgradeStr = bh >= MAX_BUILDER_HALL
        ? `🏆 **Builder Hall**: Maxed (BH${MAX_BUILDER_HALL})`
        : `• **Builder Hall**: 0/1${bhUpgradeCost ? ` — ${bhUpgradeCost}` : ''}`;

      bob = PlayerTrackingService.calculateSixthBuilderProgress(
        freshPlayer,
        village,
        account.bobDefenseCompleted || false
      );
      const bobDefStr = bob.tasks.bbDefenseLv9.completed
        ? '✅ **B.O.B Defense Lv 9**: Completed'
        : `🔄 **B.O.B Defense Lv 9**: 0/1 (Upgrade any BB defense to Lv 9)`;

      const importedBb = village ? VillageImportService.groupsFor(village, 'builder', BB_DEFENSE_CATEGORIES, halls) : [];
      const bbCapLines = importedBb.length > 0
        ? importedBb.map(VillageImportService.formatGroupLine)
        : hallCapLines('builder', bh);

      const bbHeader = [
        bhUpgradeStr,
        bobDefStr,
        '',
        `🛡️ **${importedBb.length > 0 ? 'Current Defenses & Next Upgrades' : `Defense Upgrades to Max BH${bh}`}:**`,
      ].join('\n');

      const bbChunks: string[] = [];
      let curBbChunk = '';
      for (const line of bbCapLines) {
        if ((curBbChunk + line + '\n').length > 850 && curBbChunk.length > 0) {
          bbChunks.push(curBbChunk.trim());
          curBbChunk = '';
        }
        curBbChunk += line + '\n';
      }
      if (curBbChunk.trim().length > 0) {
        bbChunks.push(curBbChunk.trim());
      }

      if (bbChunks.length <= 1) {
        fields.push({
          name: `🔨 Builder Base Defenses (BH${bh})`,
          value: [bbHeader, bbChunks[0] || 'No builder defenses recorded.'].join('\n'),
          inline: false,
        });
      } else {
        fields.push({
          name: `🔨 Builder Base Defenses (BH${bh})`,
          value: [bbHeader, bbChunks[0]].join('\n'),
          inline: false,
        });
        for (let c = 1; c < bbChunks.length; c++) {
          fields.push({
            name: `🔨 Builder Base Defenses (BH${bh} Cont. ${c + 1})`,
            value: bbChunks[c],
            inline: false,
          });
        }
      }
    }

    for (const f of fields) {
      if (f.value.length > 1024) f.value = f.value.slice(0, 1020) + '...';
    }

    const hasImportedHome = importedHome.length > 0;
    const hasImportedBb = Boolean(village && village.builderHallLevel > 0);
    const hasImported = Boolean(village);
    const jsonNotice = getVillageJsonTimestampNotice(village);
    const desc = [
      isCached ? '⚠️ *CoC API is currently under maintenance. Displaying your last saved snapshot.*\n' : '',
      hasImportedHome
        ? (hasImportedBb
            ? `Exact defenses for **Town Hall ${th}** and **Builder Hall ${bh}**.`
            : `Exact defenses for **Town Hall ${th}**.`)
        : `Defense level limits and Hall upgrade requirements for **Town Hall ${th}**${bh > 0 ? ` and **Builder Hall ${bh}**` : ''}.\n*(The Supercell API doesn't include building levels.)*\n${NO_IMPORT_TEXT}`,
      jsonNotice || '',
    ].filter(Boolean).join('\n');

    const embed = {
      title: `🛡️ [${account.name}] Defense ${hasImported ? 'Levels & Upgrades' : '& Hall Maxing Targets'}`,
      description: desc,
      color: COLORS.GOLD,
      fields,
      thumbnail: { url: CocAssetService.getTownHallUrl(th) },
      footer: { text: `Account: ${account.name} (${account.playerTag}) • Bimgus Tracker` },
      timestamp: new Date().toISOString(),
    };

    const defButtons: any[] = [];
    if (bh >= 1 && bob) {
      const toggleBtn = bobDefenseButton(account.playerTag, bob.tasks.bbDefenseLv9.completed, true);
      defButtons.push(toggleBtn);
    }
    defButtons.push(DiscordService.openGameLinkButton('Open CoC'));

    await sendAccountMessage(idx, {
      embeds: [embed],
      components: [DiscordService.createActionRow(defButtons)],
    });
  });
}
