import { InteractionResponseType } from 'discord-interactions';
import { FirestoreService } from '../../../services/firestoreService';
import commandWords from '../../../templates/commands.json';
import { fill } from '../../../templates';

const words = commandWords.sixthBuilder;
const DONE = 'bob_defense_done:';
const UNDONE = 'bob_defense_undone:';

/** The "Mark Defense Lv 9 Completed / Incomplete" button for B.O.B task 3 (manual override). */
export function bobDefenseButton(playerTag: string, completed: boolean, short: boolean = false) {
  return completed
    ? {
        type: 2 as const,
        style: 2 as const,
        label: short ? words.markUndoneShort : words.markUndone,
        custom_id: `${UNDONE}${playerTag}`,
        emoji: { name: '🔄' },
      }
    : {
        type: 2 as const,
        style: 3 as const,
        label: short ? words.markDoneShort : words.markDone,
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
      content: fill(success ? (isDone ? words.markedDone : words.markedUndone) : words.markFailed, { tag }),
      flags: 64,
    },
  };
}
