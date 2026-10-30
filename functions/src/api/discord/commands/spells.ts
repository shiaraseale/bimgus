import { DiscordService, COLORS } from '../../../services/discordService';
import { CocAssetService } from '../../../services/cocAssetService';
import { PlayerTrackingService } from '../../../services/playerTrackingService';
import { goldPassBoosts } from '../../../services/goldPass';
import { card, layoutMessage } from '../../../services/discordLayout';
import { CommandContext, forEachLinkedAccount } from '../context';

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
      if (list.length === 0) return '✅ All maxed for this Town Hall!';
      return list
        .map((s) => {
          const costStr = s.nextCost ? ` — ${s.nextCost}` : '';
          return `• **${s.name}**: Lv ${s.currentLevel}/${s.maxLevel}${costStr}`;
        })
        .join('\n');
    };

    const totalSpellLevels = spells.reduce((acc, s) => acc + s.levelsRemaining, 0);

    const message = layoutMessage(
      card({
        accent: totalSpellLevels === 0 ? COLORS.GREEN : COLORS.PURPLE,
        title: `🧪 [${account.name}] Spell Laboratory Upgrades`,
        body: [
          isCached ? '⚠️ *CoC API is currently under maintenance. Displaying your last saved snapshot.*\n' : '',
          totalSpellLevels === 0
            ? `🎉 **All spells are maxed for TH${freshPlayer.townHallLevel}!**`
            : `⚡ **${totalSpellLevels}** spell levels left for TH${freshPlayer.townHallLevel}`,
        ]
          .filter(Boolean)
          .join('\n'),
        thumbnail: CocAssetService.getTownHallUrl(freshPlayer.townHallLevel),
        blocks: [
          `**💧 Elixir Spells (${elixirSpells.length} remaining)**\n${formatSpellList(elixirSpells)}`,
          `**⬛ Dark Elixir Spells (${darkSpells.length} remaining)**\n${formatSpellList(darkSpells)}`,
        ],
        footer: `Account: ${account.name} (${account.playerTag})`,
        buttons: [DiscordService.openGameLinkButton('Open CoC')],
      })
    );

    await sendAccountMessage(idx, message);
  });
}
