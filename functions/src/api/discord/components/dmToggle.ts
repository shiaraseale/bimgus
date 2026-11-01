import { InteractionResponseType } from 'discord-interactions';
import { FirestoreService } from '../../../services/firestoreService';
import { COLORS } from '../../../services/discordService';
import { card, layoutMessage, withFlags } from '../../../services/discordLayout';
import dmWords from '../../../templates/dms.json';
import { fill } from '../../../templates';

const words = dmWords.toggle;
const OFF = 'dms_off:';
const ON = 'dms_on:';

/** A button on each DM that turns DMs off for that account (or back on, after turning them off). */
export function dmToggleButton(playerTag: string, enable: boolean = false) {
  return enable
    ? {
        type: 2 as const,
        style: 3 as const,
        label: words.turnOn,
        custom_id: `${ON}${playerTag}`,
        emoji: { name: '🔔' },
      }
    : {
        type: 2 as const,
        style: 2 as const,
        label: words.turnOff,
        custom_id: `${OFF}${playerTag}`,
        emoji: { name: '🔕' },
      };
}

export function isDmToggleButton(customId: string): boolean {
  return customId.startsWith(OFF) || customId.startsWith(ON);
}

export async function handleDmToggleButton(customId: string, discordUserId: string) {
  const enable = customId.startsWith(ON);
  const tag = customId.slice((enable ? ON : OFF).length);
  const changed = await FirestoreService.setDmsEnabled(discordUserId, enable, tag);
  if (!changed) {
    return {
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: fill(words.notLinked, { tag }),
        flags: 64,
      },
    };
  }
  const name = changed[0]?.name ?? tag;
  const reply = card({
    accent: enable ? COLORS.GREEN : COLORS.RED,
    title: enable ? words.onTitle : words.offTitle,
    body: fill(enable ? words.onBody : words.offBody, { name }),
    buttons: enable ? undefined : [dmToggleButton(tag, true)],
  });
  return {
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: withFlags(layoutMessage(reply), true),
  };
}
