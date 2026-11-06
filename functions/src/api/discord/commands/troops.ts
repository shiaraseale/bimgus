import { DiscordService, COLORS } from '../../../services/discordService';
import { CocAssetService } from '../../../services/cocAssetService';
import { PlayerTrackingService } from '../../../services/playerTrackingService';
import { goldPassBoosts } from '../../../services/goldPass';
import { VillageImportService } from '../../../services/villageImportService';
import { card, columnRows, layoutMessage } from '../../../services/discordLayout';
import commandWords from '../../../templates/commands.json';
import shared from '../../../templates/shared.json';
import { accountFooter, fill, isolate } from '../../../templates';
import { CommandContext, forEachLinkedAccount } from '../context';
import { CardSection, itemRow } from '../ui';

/** Slash command definition, registered by scripts/registerCommands.ts */
export const definition = {
  name: 'troops',
  description: 'Check troop research upgrades remaining to max your current Town Hall / Builder Hall',
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

const words = commandWords.troops;

// Room for the troop lists (Discord allows 4,000 characters per message)
const LISTS_BUDGET = 3500;

export async function execute(ctx: CommandContext): Promise<any> {
  const { optionsMap, sendAccountMessage, getPlayerWithFallback } = ctx;
  const villageFilter = optionsMap['village'] || 'both';
  return forEachLinkedAccount(ctx, 'troop data', async (account, idx) => {
    const { player: freshPlayer, isCached } = await getPlayerWithFallback(account);
    const outstanding = PlayerTrackingService.calculateOutstandingUpgrades(
      freshPlayer,
      false,
      null,
      goldPassBoosts(account)
    );

    const homeTroops = outstanding.byCategory.home.troops;
    const builderTroops = outstanding.byCategory.builder.troops;

    const sections: CardSection[] = [];

    if (villageFilter === 'home' || villageFilter === 'both') {
      sections.push({
        title: fill(words.homeHeading, { level: freshPlayer.townHallLevel, count: homeTroops.length }),
        lines:
          homeTroops.length > 0
            ? columnRows(homeTroops.map(itemRow))
            : [fill(words.homeMaxed, { level: freshPlayer.townHallLevel })],
      });
    }

    if ((villageFilter === 'builder' || villageFilter === 'both') && freshPlayer.builderHallLevel) {
      sections.push({
        title: fill(words.builderHeading, { level: freshPlayer.builderHallLevel, count: builderTroops.length }),
        lines:
          builderTroops.length > 0
            ? columnRows(builderTroops.map(itemRow))
            : [fill(words.builderMaxed, { level: freshPlayer.builderHallLevel })],
      });
    }

    const totalTroopLevels =
      (villageFilter === 'builder' ? 0 : homeTroops.reduce((acc, t) => acc + t.levelsRemaining, 0)) +
      (villageFilter === 'home' ? 0 : builderTroops.reduce((acc, t) => acc + t.levelsRemaining, 0));

    const message = layoutMessage(
      card({
        accent: totalTroopLevels === 0 ? COLORS.GREEN : COLORS.BLUE,
        title: fill(words.title, { name: isolate(account.name) }),
        body: [
          isCached ? `${shared.maintenance}\n` : '',
          totalTroopLevels === 0 ? words.allMaxed : fill(words.levelsLeft, { levels: totalTroopLevels }),
        ]
          .filter(Boolean)
          .join('\n'),
        thumbnail: CocAssetService.getTownHallUrl(freshPlayer.townHallLevel),
        // Long lists are trimmed to fit the message, ending "... and N more"
        blocks: VillageImportService.fitSections(sections, LISTS_BUDGET, (hidden) => fill(words.more, { hidden })).map(
          (sec) => `**${sec.title}**\n${sec.lines.join('\n')}`
        ),
        footer: accountFooter(account),
        buttons: [DiscordService.openGameLinkButton()],
      })
    );

    await sendAccountMessage(idx, message);
  });
}
