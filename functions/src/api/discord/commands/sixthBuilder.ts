import { DiscordService, COLORS } from '../../../services/discordService';
import { CocAssetService } from '../../../services/cocAssetService';
import { PlayerTrackingService } from '../../../services/playerTrackingService';
import { VillageImportService } from '../../../services/villageImportService';
import { bobDefenseButton } from '../components/bobDefense';
import { CommandContext, forEachLinkedAccount } from '../context';
import { formatProgressBar, getVillageJsonTimestampNotice } from '../ui';

/** Slash command definition, registered by scripts/registerCommands.ts */
export const definition = {
  name: 'sixth-builder',
  description: 'Check how close you are to unlocking the 6th Builder (B.O.B)',
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
  return forEachLinkedAccount(ctx, '6th Builder data', async (account, idx) => {
    const { player: freshPlayer, isCached } = await getPlayerWithFallback(account);
    const village = VillageImportService.read(account.villageData);
    const bob = PlayerTrackingService.calculateSixthBuilderProgress(
      freshPlayer,
      village,
      account.bobDefenseCompleted || false
    );

    const gearUpEmoji = bob.tasks.gearUps.completed ? '✅' : '🔄';
    const troopEmoji = bob.tasks.bbTroopLv18.completed ? '✅' : '🔄';
    const defEmoji = bob.tasks.bbDefenseLv9.completed ? '✅' : '🔄';
    const heroEmoji = bob.tasks.bbHeroesLv45.completed ? '✅' : '🔄';

    const statusBanner = bob.unlocked
      ? '🎉 **Congratulations! You have unlocked the 6th Builder (B.O.B)!**'
      : `⏳ **Overall Progress**: ${formatProgressBar(bob.overallPercentage)}`;

    const bbJsonNotice = village && village.builderHallLevel > 0
      ? getVillageJsonTimestampNotice(village, 'Builder Base defenses based on the export taken')
      : null;

    const embed = {
      title: `🛠️ [${account.name}] 6th Builder (B.O.B) Tracker`,
      description: [
        isCached ? '⚠️ *CoC API is currently under maintenance. Displaying your last saved snapshot.*\n' : '',
        statusBanner,
        bbJsonNotice ? `${bbJsonNotice}\n` : '',
        '',
        `${gearUpEmoji} **1. Gear Up 3 Buildings** (${bob.tasks.gearUps.current}/${bob.tasks.gearUps.target})`,
        `   ${bob.tasks.gearUps.description}`,
        '',
        `${troopEmoji} **2. Upgrade BB Troop to Level 18** (Lv ${bob.tasks.bbTroopLv18.current}/${bob.tasks.bbTroopLv18.target})`,
        `   ${bob.tasks.bbTroopLv18.description}`,
        '',
        `${defEmoji} **3. Upgrade BB Defense to Level 9** (${bob.tasks.bbDefenseLv9.current}/${bob.tasks.bbDefenseLv9.target})`,
        `   ${bob.tasks.bbDefenseLv9.description}`,
        '',
        `${heroEmoji} **4. Total BB Hero Level 45** (${bob.tasks.bbHeroesLv45.current}/${bob.tasks.bbHeroesLv45.target})`,
        `   ${bob.tasks.bbHeroesLv45.description}`,
      ].join('\n'),
      color: bob.unlocked ? COLORS.GOLD : COLORS.BLUE,
      thumbnail: {
        url: CocAssetService.getBobUrl(
          bob.unlocked ? 4 : Object.values(bob.tasks).filter((t: any) => t.completed).length
        ),
      },
      footer: { text: `Account: ${account.name} (${account.playerTag}) • Bimgus Tracker` },
      timestamp: new Date().toISOString(),
    };

    const bobButtons: any[] = [];
    if ((freshPlayer.builderHallLevel || 0) >= 1) {
      const toggleBtn = bobDefenseButton(account.playerTag, bob.tasks.bbDefenseLv9.completed);
      bobButtons.push(toggleBtn);
    }
    bobButtons.push(DiscordService.openGameLinkButton('Open CoC'));

    await sendAccountMessage(idx, {
      embeds: [embed],
      components: [DiscordService.createActionRow(bobButtons)],
    });
  });
}
