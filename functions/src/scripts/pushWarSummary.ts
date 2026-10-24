import { CocService } from '../services/cocService';
import { FirestoreService } from '../services/firestoreService';
import { config } from '../config';
import { sendWarSummaryDiscord } from '../diff/warDiff';
import { log } from '../utils/log';

export async function pushWarSummary(targetClanTag?: string): Promise<{ success: boolean; message: string }> {
  const clanTag = targetClanTag || config.coc.clanTag;
  if (!clanTag) throw new Error('No clan tag: set COC_CLAN_TAG in functions/.env or pass one');
  log.info(`[pushWarSummary] Fetching live war status for ${clanTag}...`);

  const coc = CocService.shared();
  const currentWar = await coc.getCurrentWar(clanTag);

  if (!currentWar || currentWar.state === 'notInWar') {
    return {
      success: false,
      message: `Clan ${clanTag} is not currently in a war.`,
    };
  }

  // Obtain webhook URL from Firestore config (with env fallback)
  let webhookUrl = config.webhooks.warRoom;
  try {
    const clanConfig = await FirestoreService.getConfig(clanTag);
    if (clanConfig.webhooks?.warRoom) {
      webhookUrl = clanConfig.webhooks.warRoom;
    }
  } catch (err: any) {
    log.warn(`[pushWarSummary] Could not read Firestore config (${err.message}), using env fallback.`);
  }

  if (!webhookUrl) {
    return {
      success: false,
      message: `No war room webhook configured for ${clanTag}.`,
    };
  }

  log.info(`[pushWarSummary] Broadcasting war summary to Discord war-room...`);
  await sendWarSummaryDiscord(webhookUrl, currentWar);

  return {
    success: true,
    message: `War summary successfully broadcast to Discord for ${currentWar.clan.name} vs ${currentWar.opponent.name}!`,
  };
}

// If executed directly from command line (e.g. npx ts-node pushWarSummary.ts #TAG)
if (require.main === module) {
  const customTag = process.argv[2];
  pushWarSummary(customTag)
    .then((res) => {
      log.info(res.message);
      process.exit(res.success ? 0 : 1);
    })
    .catch((err) => {
      log.error('[pushWarSummary] Execution error:', err);
      process.exit(1);
    });
}
