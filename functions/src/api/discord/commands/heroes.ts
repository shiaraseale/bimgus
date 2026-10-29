import { DiscordService, COLORS } from '../../../services/discordService';
import { CocAssetService } from '../../../services/cocAssetService';
import { EMOJIS } from '../../../constants/emojis';
import { PlayerTrackingService } from '../../../services/playerTrackingService';
import { card, layoutMessage } from '../../../services/discordLayout';
import { CommandContext, forEachLinkedAccount } from '../context';
import { formatProgressBar } from '../ui';

/** Slash command definition, registered by scripts/registerCommands.ts */
export const definition = {
  name: 'heroes',
  description: 'Check hero maxing progress for your current Town Hall or Builder Hall',
  contexts: [0, 1],
  integration_types: [0],
  options: [
    {
      name: 'account',
      description: 'Specific player tag to check (leave blank for all linked accounts)',
      type: 3, // STRING
      required: false,
    },
    {
      name: 'village',
      description: 'Which village to inspect (home, builder, or both)',
      type: 3, // STRING
      required: false,
      choices: [
        { name: 'Both Villages', value: 'both' },
        { name: 'Home Village', value: 'home' },
        { name: 'Builder Base', value: 'builder' },
      ],
    },
  ],
};

// Runs as a Cloud Task (3.7): its work happens after the "thinking…" reply
export const runsAsTask = true;

export async function execute(ctx: CommandContext): Promise<any> {
  const { optionsMap, sendAccountMessage, getPlayerWithFallback } = ctx;
  const villageFilter = optionsMap['village'] || 'both';
  return forEachLinkedAccount(ctx, 'heroes', async (account, idx) => {
    const { player: freshPlayer, isCached } = await getPlayerWithFallback(account);
    const heroSummary = PlayerTrackingService.calculateHeroesProgress(freshPlayer);

    const blocks: string[] = [];
    // One line per hero: "• **Archer Queen** 60/65 `[█████████░] 92%`"
    const heroLine = (h: any) =>
      `• **${h.name}** ${h.level}/${h.maxLevel} ${h.levelsRemaining === 0 ? '🏆' : `\`${formatProgressBar(h.percentage, 10)}\``}`;

    if (villageFilter === 'home' || villageFilter === 'both') {
      blocks.push(
        `**🏰 Home Village Heroes (TH${freshPlayer.townHallLevel}) — ${heroSummary.overallHomePercentage}% Maxed**\n` +
          (heroSummary.homeHeroes.length > 0
            ? heroSummary.homeHeroes.map(heroLine).join('\n')
            : 'No Home Village heroes unlocked yet.')
      );
    }

    if (villageFilter === 'builder' || villageFilter === 'both') {
      blocks.push(
        `**🔨 Builder Base Heroes (BH${freshPlayer.builderHallLevel || 'N/A'}) — ${heroSummary.overallBuilderPercentage}% Maxed**\n` +
          (heroSummary.builderHeroes.length > 0
            ? heroSummary.builderHeroes.map(heroLine).join('\n')
            : 'No Builder Base heroes unlocked yet.')
      );
    }

    const message = layoutMessage(
      card({
        accent: heroSummary.homeMaxed ? COLORS.GOLD : COLORS.BLUE,
        title: `${EMOJIS.CROWN} [${account.name}] Hero Maxing Overview`,
        body: [
          isCached ? '⚠️ *CoC API is currently under maintenance. Displaying your last saved snapshot.*' : '',
          `⚡ **${heroSummary.totalHomeLevelsRemaining}** home and **${heroSummary.totalBuilderLevelsRemaining}** Builder Base hero levels left`,
        ]
          .filter(Boolean)
          .join('\n'),
        thumbnail: CocAssetService.getHeroUrl('Archer Queen'),
        blocks,
        footer: `Account: ${account.name} (${account.playerTag})`,
        buttons: [DiscordService.openGameLinkButton('Open CoC')],
      })
    );

    await sendAccountMessage(idx, message);
  });
}
