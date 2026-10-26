import { InteractionResponseType } from 'discord-interactions';
import { FirestoreService } from '../../../services/firestoreService';

const OFF = 'dms_off:';
const ON = 'dms_on:';

/** A button on each DM that turns DMs off for that account (or back on, after turning them off). */
export function dmToggleButton(playerTag: string, enable: boolean = false) {
  return enable
    ? {
        type: 2 as const,
        style: 3 as const,
        label: 'Turn DMs back on',
        custom_id: `${ON}${playerTag}`,
        emoji: { name: '🔔' },
      }
    : {
        type: 2 as const,
        style: 2 as const,
        label: 'Turn off these DMs',
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
  const name = changed?.[0]?.name ?? tag;
  return {
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: {
      content: !changed
        ? `⚠️ \`${tag}\` isn't linked to your profile any more, so there's nothing to change.`
        : enable
          ? `🔔 DMs are back **on** for **${name}**.`
          : `🔕 DMs are now **off** for **${name}**. Use \`/dms on\` or the button below to turn them back on.`,
      ...(changed && !enable ? { components: [{ type: 1, components: [dmToggleButton(tag, true)] }] } : {}),
      flags: 64,
    },
  };
}
