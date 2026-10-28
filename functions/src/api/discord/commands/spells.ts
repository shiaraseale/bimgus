import { DiscordService, COLORS } from '../../../services/discordService';
import { CocAssetService } from '../../../services/cocAssetService';
import { PlayerTrackingService } from '../../../services/playerTrackingService';
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
    const outstanding = PlayerTrackingService.calculateOutstandingUpgrades(freshPlayer);
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

    const fields: any[] = [
      {
        name: `💧 Elixir Spells (${elixirSpells.length} remaining)`,
        value: formatSpellList(elixirSpells),
        inline: false,
      },
      {
        name: `⬛ Dark Elixir Spells (${darkSpells.length} remaining)`,
        value: formatSpellList(darkSpells),
        inline: false,
      },
    ];

    for (const f of fields) {
      if (f.value.length > 1024) f.value = f.value.slice(0, 1020) + '...';
    }

    const totalSpellLevels = spells.reduce((acc, s) => acc + s.levelsRemaining, 0);

    const embed = {
      title: `🧪 [${account.name}] Spell Laboratory Upgrades`,
      description: [
        isCached ? '⚠️ *CoC API is currently under maintenance. Displaying your last saved snapshot.*\n' : '',
        totalSpellLevels === 0
          ? `🎉 **All spells are maxed for TH${freshPlayer.townHallLevel}!**`
          : `⚡ **${totalSpellLevels}** spell levels left for TH${freshPlayer.townHallLevel}`,
      ]
        .filter(Boolean)
        .join('\n'),
      color: totalSpellLevels === 0 ? COLORS.GREEN : COLORS.PURPLE,
      fields,
      thumbnail: { url: CocAssetService.getTownHallUrl(freshPlayer.townHallLevel) },
      footer: { text: `Account: ${account.name} (${account.playerTag}) • Bimgus Tracker` },
      timestamp: new Date().toISOString(),
    };

    await sendAccountMessage(idx, {
      embeds: [embed],
      components: [DiscordService.createActionRow([DiscordService.openGameLinkButton('Open CoC')])],
    });
  });
}
