import { InteractionResponseType } from 'discord-interactions';
import { FirestoreService } from '../../../services/firestoreService';

const DONE = 'bob_defense_done:';
const UNDONE = 'bob_defense_undone:';

/** The "Mark Defense Lv 9 Completed / Incomplete" button for B.O.B task 3 (manual override). */
export function bobDefenseButton(playerTag: string, completed: boolean, short: boolean = false) {
  return completed
    ? {
        type: 2 as const,
        style: 2 as const,
        label: short ? 'Mark BB Def Lv 9 Incomplete' : 'Mark Defense Lv 9 Incomplete',
        custom_id: `${UNDONE}${playerTag}`,
        emoji: { name: '🔄' },
      }
    : {
        type: 2 as const,
        style: 3 as const,
        label: short ? 'Mark BB Def Lv 9 Done' : 'Mark Defense Lv 9 Completed',
        custom_id: `${DONE}${playerTag}`,
        emoji: { name: '✅' },
      };
}

export function isBobDefenseButton(customId: string): boolean {
  return customId.startsWith(DONE) || customId.startsWith(UNDONE);
}

export async function handleBobDefenseButton(customId: string, discordUserId: string) {
  const isDone = customId.startsWith(DONE);
  const tag = customId.slice((isDone ? DONE : UNDONE).length);
  const success = await FirestoreService.setBobDefenseCompleted(discordUserId, tag, isDone);
  return {
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: {
      content: success
        ? isDone
          ? `✅ Builder Base Defense Lv 9 has been marked as **completed** for \`${tag}\`! Run \`/sixth-builder\` to view your updated progress.`
          : `🔄 Builder Base Defense Lv 9 has been marked as **incomplete** for \`${tag}\`. Run \`/sixth-builder\` to view your updated progress.`
        : `⚠️ Could not find linked account \`${tag}\` under your profile.`,
      flags: 64,
    },
  };
}
