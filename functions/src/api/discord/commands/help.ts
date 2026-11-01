import { COLORS } from '../../../services/discordService';
import { card, layoutMessage } from '../../../services/discordLayout';
import commandWords from '../../../templates/commands.json';
import { fill } from '../../../templates';
import { CommandContext } from '../context';

/** Slash command definition, registered by scripts/registerCommands.ts */
export const definition = {
  name: 'help',
  description: 'Show a list of all available Bimgus commands and how to use them',
  contexts: [0, 1],
  integration_types: [0],
};

export const runsAsTask = false;

const words = commandWords.help;

export async function execute(ctx: CommandContext): Promise<any> {
  const { respondPersonal } = ctx;
  return respondPersonal(
    layoutMessage(
      card({
        accent: COLORS.GOLD,
        title: words.title,
        body: words.body,
        thumbnail:
          'https://raw.githubusercontent.com/ClashKingInc/ClashKingAssets/main/clashofclans/troops/home/barbarian/barbarian.webp',
        blocks: words.groups.map((group) => group.map(({ name, text }) => `**${fill(name)}**\n${text}`).join('\n\n')),
        footer: words.footer,
      })
    )
  );
}
