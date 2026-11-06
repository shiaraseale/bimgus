import { DiscordService, COLORS } from '../../../services/discordService';
import { CocAssetService } from '../../../services/cocAssetService';
import { PlayerTrackingService } from '../../../services/playerTrackingService';
import { card, columnRows, layoutMessage } from '../../../services/discordLayout';
import commandWords from '../../../templates/commands.json';
import shared from '../../../templates/shared.json';
import { accountFooter, fill, isolate } from '../../../templates';
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

const words = commandWords.heroes;

export async function execute(ctx: CommandContext): Promise<any> {
  const { optionsMap, sendAccountMessage, getPlayerWithFallback } = ctx;
  const villageFilter = optionsMap['village'] || 'both';
  return forEachLinkedAccount(ctx, 'heroes', async (account, idx) => {
    const { player: freshPlayer, isCached } = await getPlayerWithFallback(account);
    const heroSummary = PlayerTrackingService.calculateHeroesProgress(freshPlayer);

    const blocks: string[] = [];
    // One row per hero: "`Archer Queen  60/65  [█████████░] 92%`", the percent padded to keep the bars in line
    const heroLines = (heroes: any[]) =>
      columnRows(
        heroes.map((h) => ({
          label: h.name,
          value: `${h.level}/${h.maxLevel}`,
          after:
            h.levelsRemaining === 0
              ? '🏆'
              : formatProgressBar(h.percentage, 10).replace(/\d+%$/, (percent) => percent.padStart(3)),
        }))
      );

    if (villageFilter === 'home' || villageFilter === 'both') {
      blocks.push(
        `${fill(words.homeHeading, { level: freshPlayer.townHallLevel, percent: heroSummary.overallHomePercentage })}\n` +
          (heroSummary.homeHeroes.length > 0 ? heroLines(heroSummary.homeHeroes).join('\n') : words.noHomeHeroes)
      );
    }

    if (villageFilter === 'builder' || villageFilter === 'both') {
      blocks.push(
        `${fill(words.builderHeading, { level: freshPlayer.builderHallLevel || words.noBuilderHall, percent: heroSummary.overallBuilderPercentage })}\n` +
          (heroSummary.builderHeroes.length > 0
            ? heroLines(heroSummary.builderHeroes).join('\n')
            : words.noBuilderHeroes)
      );
    }

    const message = layoutMessage(
      card({
        accent: heroSummary.homeMaxed ? COLORS.GOLD : COLORS.BLUE,
        title: fill(words.title, { name: isolate(account.name) }),
        body: [
          isCached ? shared.maintenance : '',
          fill(words.levelsLeft, {
            home: heroSummary.totalHomeLevelsRemaining,
            builder: heroSummary.totalBuilderLevelsRemaining,
          }),
        ]
          .filter(Boolean)
          .join('\n'),
        thumbnail: CocAssetService.getHeroUrl('Archer Queen'),
        blocks,
        footer: accountFooter(account),
        buttons: [DiscordService.openGameLinkButton()],
      })
    );

    await sendAccountMessage(idx, message);
  });
}
