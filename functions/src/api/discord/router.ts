import { Router, Request, Response } from 'express';
import { InteractionType, InteractionResponseType, verifyKey } from 'discord-interactions';
import { config } from '../../config';
import { createCommandContext } from './context';
import { COMMANDS_BY_NAME } from './commands';
import { queueTask } from './tasks';
import { handleBobDefenseButton, isBobDefenseButton } from './components/bobDefense';

export const discordInteractionsRouter = Router();

/**
 * Handles incoming Discord HTTP interactions (Slash Commands & Message Components)
 */
discordInteractionsRouter.post('/interactions', (req: Request, res: Response) => handleInteraction(req, res));

/**
 * Replays an interaction inside a Cloud Task (3.7): the request already replied "thinking…", so the
 * handler runs with deferring switched off, and this waits for its background work to finish.
 */
export async function runCommandTask(interaction: any): Promise<void> {
  const work: Array<Promise<void>> = [];
  const req: any = { body: interaction, fromTask: true, work, get: () => undefined };
  const res: any = { json: () => res, status: () => res, send: () => res };
  await handleInteraction(req, res);
  await Promise.all(work);
}

export async function handleInteraction(req: Request, res: Response): Promise<any> {
  const fromTask = Boolean((req as any).fromTask);
  const signature = req.get('X-Signature-Ed25519');
  const timestamp = req.get('X-Signature-Timestamp');
  const rawBody = (req as any).rawBody || JSON.stringify(req.body);

  const publicKey = config.discord.publicKey;

  // Always verify the cryptographic signature; without a public key, reject every request.
  // (A replay inside a Cloud Task was verified when Discord sent it, and tasks can only come from us.)
  if (fromTask) {
    // already verified
  } else if (!publicKey) {
    console.error('[Discord Interactions] DISCORD_PUBLIC_KEY is not configured; rejecting request');
    return res.status(401).send('Interactions endpoint not configured');
  } else if (!signature || !timestamp) {
    console.warn('[Discord Interactions] Missing signature or timestamp');
    return res.status(401).send('Missing signature headers');
  } else if (!(await verifyKey(rawBody, signature, timestamp, publicKey))) {
    console.warn('[Discord Interactions] Invalid request signature');
    return res.status(401).send('Invalid request signature');
  }

  const { type, data, member, user } = req.body;

  if (type === InteractionType.PING) {
    return res.json({ type: InteractionResponseType.PONG });
  }

  if (type === InteractionType.APPLICATION_COMMAND) {
    const ctx = createCommandContext(req, res, fromTask);
    const command = COMMANDS_BY_NAME.get(ctx.name);
    if (!command) return res.status(400).send('Unknown command');

    // Slow commands run in a Cloud Task with full CPU (3.7); if queueing fails they run here as before
    if (!fromTask && command.runsAsTask && (await queueTask('commandTask', { interaction: req.body }))) {
      return ctx.deferReply();
    }

    try {
      return await command.execute(ctx);
    } catch (cmdErr: any) {
      console.error(`[Discord Command] Error executing /${ctx.name}: ${cmdErr.message}`);
      return ctx.respondPersonal({
        content: `❌ An unexpected error occurred while executing \`/${ctx.name}\`: ${cmdErr.message}`,
      });
    }
  }

  if (type === InteractionType.MESSAGE_COMPONENT) {
    const customId: string = data.custom_id || '';
    const discordUserId = (user || member?.user)?.id;
    if (isBobDefenseButton(customId)) {
      return res.json(await handleBobDefenseButton(customId, discordUserId));
    }
    return res.status(400).send('Unknown component interaction');
  }

  return res.status(400).send('Unknown interaction type');
}
