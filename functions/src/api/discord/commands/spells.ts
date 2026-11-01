import { DiscordService, COLORS } from '../../../services/discordService';
import { CocAssetService } from '../../../services/cocAssetService';
import { PlayerTrackingService } from '../../../services/playerTrackingService';
import { goldPassBoosts } from '../../../services/goldPass';
import { card, columnRows, layoutMessage } from '../../../services/discordLayout';
import commandWords from '../../../templates/commands.json';
import shared from '../../../templates/shared.json';
import { accountFooter, fill } from '../../../templates';
import { CommandContext, forEachLinkedAccount } from '../context';
import { itemRow } from '../ui';

/** Slash command definition, registered by scripts/registerCommands.ts */
export const definition = {
  name: 'spells',
  description: 'Check spell laboratory upgrades remaining to max your current Town Hall',
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

const words = commandWords.spells;

export async function execute(ctx: CommandContext): Promise<any> {
  const { sendAccountMessage, getPlayerWithFallback } = ctx;
  return forEachLinkedAccount(ctx, 'spell data', async (account, idx) => {
    const { player: freshPlayer, isCached } = await getPlayerWithFallback(account);
    const outstanding = PlayerTrackingService.calculateOutstandingUpgrades(
      freshPlayer,
      false,
      null,
      goldPassBoosts(account)
    );
    const spells = outstanding.byCategory.home.spells;

    const elixirSpells = spells.filter((s) => s.resourceType === 'elixir');
    const darkSpells = spells.filter((s) => s.resourceType === 'darkElixir');

    const formatSpellList = (list: typeof spells) => {
      if (list.length === 0) return words.listMaxed;
      return columnRows(list.map(itemRow)).join('\n');
    };

    const totalSpellLevels = spells.reduce((acc, s) => acc + s.levelsRemaining, 0);

    const message = layoutMessage(
      card({
        accent: totalSpellLevels === 0 ? COLORS.GREEN : COLORS.PURPLE,
        title: fill(words.title, { name: account.name }),
        body: [
          isCached ? `${shared.maintenance}\n` : '',
          totalSpellLevels === 0
            ? fill(words.allMaxed, { level: freshPlayer.townHallLevel })
            : fill(words.levelsLeft, { levels: totalSpellLevels, level: freshPlayer.townHallLevel }),
        ]
          .filter(Boolean)
          .join('\n'),
        thumbnail: CocAssetService.getTownHallUrl(freshPlayer.townHallLevel),
        blocks: [
          `${fill(words.elixirHeading, { count: elixirSpells.length })}\n${formatSpellList(elixirSpells)}`,
          `${fill(words.darkHeading, { count: darkSpells.length })}\n${formatSpellList(darkSpells)}`,
        ],
        footer: accountFooter(account),
        buttons: [DiscordService.openGameLinkButton()],
      })
    );

    await sendAccountMessage(idx, message);
  });
}
