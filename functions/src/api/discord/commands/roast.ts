import { RoastTaskData, runRoastTask } from '../../../jobs/roastJob';
import { CommandContext } from '../context';
import { queueTask } from '../tasks';

/** Slash command definition, registered by scripts/registerCommands.ts */
export const definition = {
  name: 'roast',
  description: 'Tag a server member and let Bimgus deliver a savage Clash of Clans roast',
  contexts: [0], // Guild channels
  integration_types: [0],
  options: [
    {
      name: 'user',
      description: 'The member to roast',
      type: 6, // USER
      required: true,
    },
  ],
};

export const runsAsTask = false;

export async function execute(ctx: CommandContext): Promise<any> {
  const { optionsMap, data, applicationId, interactionToken, respondPersonal, deferReply } = ctx;
  const targetUserId = optionsMap['user'];
  if (!targetUserId) {
    return respondPersonal({ content: '⚠️ Please mention a user to roast!' });
  }

  const resolvedUser = data.resolved?.users?.[targetUserId];
  const task: RoastTaskData = {
    targetUserId,
    targetUsername: resolvedUser?.global_name || resolvedUser?.username || 'Clasher',
    applicationId,
    interactionToken,
  };

  // Queue the roast before replying: work done after the reply runs with throttled CPU
  const queued = await queueTask('roastTask', task);

  // Defer publicly in channel so everyone can enjoy the roast!
  deferReply(false);
  if (!queued) void runRoastTask(task);
  return;
}
