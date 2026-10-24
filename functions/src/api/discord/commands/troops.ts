import { DiscordService, COLORS } from '../../../services/discordService';
import { CocAssetService } from '../../../services/cocAssetService';
import { PlayerTrackingService } from '../../../services/playerTrackingService';
import { CommandContext, forEachLinkedAccount } from '../context';

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

export async function execute(ctx: CommandContext): Promise<any> {
  const { optionsMap, sendAccountMessage, getPlayerWithFallback } = ctx;
  const villageFilter = optionsMap['village'] || 'both';
  return forEachLinkedAccount(ctx, 'troop data', async (account, idx) => {
    const { player: freshPlayer, isCached } = await getPlayerWithFallback(account);
    const outstanding = PlayerTrackingService.calculateOutstandingUpgrades(freshPlayer);

    const homeTroops = outstanding.byCategory.home.troops;
    const builderTroops = outstanding.byCategory.builder.troops;

    const fields: any[] = [];

    if (villageFilter === 'home' || villageFilter === 'both') {
      const formatHomeList = () => {
        if (homeTroops.length === 0) return `🎉 All Home Village troops maxed for TH${freshPlayer.townHallLevel}!`;
        const lines = homeTroops.map((t) => {
          const costStr = t.nextCost ? ` — ${t.nextCost}` : '';
          return `• **${t.name}**: Lv ${t.currentLevel}/${t.maxLevel}${costStr}`;
        });
        const full = lines.join('\n');
        if (full.length <= 1000) return full;
        let truncated = '';
        for (const l of lines) {
          if ((truncated + l + '\n').length > 950) {
            truncated += `... and ${lines.length - truncated.split('\n').filter(Boolean).length} more`;
            break;
          }
          truncated += l + '\n';
        }
        return truncated.trim();
      };

      fields.push({
        name: `🏰 Home Village Troops (TH${freshPlayer.townHallLevel}) — ${homeTroops.length} Upgrades Remaining`,
        value: formatHomeList(),
        inline: false,
      });
    }

    if ((villageFilter === 'builder' || villageFilter === 'both') && freshPlayer.builderHallLevel) {
      const formatBuilderList = () => {
        if (builderTroops.length === 0) return `🎉 All Builder Base troops maxed for BH${freshPlayer.builderHallLevel}!`;
        const lines = builderTroops.map((t) => {
          const costStr = t.nextCost ? ` — ${t.nextCost}` : '';
          return `• **${t.name}**: Lv ${t.currentLevel}/${t.maxLevel}${costStr}`;
        });
        const full = lines.join('\n');
        if (full.length <= 1000) return full;
        let truncated = '';
        for (const l of lines) {
          if ((truncated + l + '\n').length > 950) {
            truncated += `... and ${lines.length - truncated.split('\n').filter(Boolean).length} more`;
            break;
          }
          truncated += l + '\n';
        }
        return truncated.trim();
      };

      fields.push({
        name: `🔨 Builder Base Troops (BH${freshPlayer.builderHallLevel}) — ${builderTroops.length} Upgrades Remaining`,
        value: formatBuilderList(),
        inline: false,
      });
    }

    for (const f of fields) {
      if (f.value.length > 1024) f.value = f.value.slice(0, 1020) + '...';
    }

    const totalTroopLevels =
      (villageFilter === 'builder' ? 0 : homeTroops.reduce((acc, t) => acc + t.levelsRemaining, 0)) +
      (villageFilter === 'home' ? 0 : builderTroops.reduce((acc, t) => acc + t.levelsRemaining, 0));

    const embed = {
      title: `⚔️ [${account.name}] Laboratory & Barracks Troop Research`,
      description: [
        isCached ? '⚠️ *CoC API is currently under maintenance. Displaying your last saved snapshot.*\n' : '',
        `Troop research remaining to max current levels:`,
        '',
        totalTroopLevels === 0
          ? '🎉 **All troops are currently maxed for your Hall level!**'
          : `⚡ **Total Outstanding Troop Levels**: **${totalTroopLevels}**`,
      ].filter(Boolean).join('\n'),
      color: totalTroopLevels === 0 ? COLORS.GREEN : COLORS.BLUE,
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
