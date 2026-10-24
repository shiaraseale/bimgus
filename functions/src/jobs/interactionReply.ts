import axios from 'axios';
import { log } from '../utils/log';

export interface InteractionReply {
  edit(messageData: any): Promise<boolean>;
  followup(messageData: any): Promise<void>;
}

/**
 * Edits and follows up a deferred interaction reply from outside the interaction request
 * (e.g. a Cloud Task). Interaction tokens stay valid for 15 minutes.
 */
export function interactionReply(task: { applicationId: string; interactionToken: string; isGuild?: boolean }): InteractionReply {
  const base = `https://discord.com/api/v10/webhooks/${task.applicationId}/${task.interactionToken}`;
  const headers = { 'Content-Type': 'application/json' };
  return {
    async edit(messageData: any) {
      // A task can start before Discord has registered the "thinking" reply; retry once on 404
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          await axios.patch(`${base}/messages/@original`, messageData, { headers, timeout: 15000 });
          return true;
        } catch (err: any) {
          if (attempt === 1 && err.response?.status === 404) {
            await new Promise((resolve) => setTimeout(resolve, 1000));
            continue;
          }
          log.error('[Discord] Failed to edit deferred reply:', JSON.stringify(err.response?.data) || err.message);
          return false;
        }
      }
      return false;
    },
    async followup(messageData: any) {
      try {
        await axios.post(base, { ...(task.isGuild ? { flags: 64 } : {}), ...messageData }, { headers, timeout: 15000 });
      } catch (err: any) {
        log.error('[Discord] Failed to send follow-up reply:', JSON.stringify(err.response?.data) || err.message);
      }
    },
  };
}
