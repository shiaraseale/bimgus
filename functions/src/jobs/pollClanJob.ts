import { CocService } from '../services/cocService';
import { FirestoreService } from '../services/firestoreService';
import { processClanDiff } from '../diff/clanDiff';
import { processWarDiff } from '../diff/warDiff';
import { processRaidDiff } from '../diff/raidDiff';
import { processCwlDiff } from '../diff/cwlDiff';
import { processClanGamesDiff } from '../diff/clanGamesDiff';
import { runPlayerTrackingJob } from './playerTrackingJob';
import { config } from '../config';

export async function runPollClanJob(clanTagOverride?: string): Promise<{ success: boolean; message: string }> {
  const targetTag = clanTagOverride || config.coc.clanTag;
  if (!targetTag) {
    return { success: false, message: 'No clan tag configured. Set COC_CLAN_TAG in environment or Firestore.' };
  }

  const cocService = CocService.shared();
  const botConfig = await FirestoreService.getConfig(targetTag);

  try {
    // 1. Poll Clan Roster & General Info
    console.log(`[Poll] Fetching clan ${targetTag}...`);
    const clanData = await cocService.getClan(targetTag);
    const prevClanSnapshot = await FirestoreService.getClanSnapshot(targetTag);
    const newClanSnapshot = await processClanDiff(clanData, prevClanSnapshot, botConfig);
    await FirestoreService.saveClanSnapshot(newClanSnapshot);

    // 2. Poll Current War
    console.log(`[Poll] Fetching current war for ${targetTag}...`);
    try {
      const warData = await cocService.getCurrentWar(targetTag);
      const prevWarSnapshot = await FirestoreService.getWarSnapshot(targetTag);
      const newWarSnapshot = await processWarDiff(warData, prevWarSnapshot, botConfig);
      if (newWarSnapshot) {
        await FirestoreService.saveWarSnapshot(targetTag, newWarSnapshot);
      }
    } catch (warErr: any) {
      console.warn(`[Poll] Could not fetch current war (clan war log may be private or not in war): ${warErr.message}`);
    }

    // 3. Poll Clan War Leagues (CWL)
    console.log(`[Poll] Checking CWL status for ${targetTag}...`);
    try {
      const cwlGroup = await cocService.getCwlGroup(targetTag);
      if (cwlGroup && cwlGroup.state !== 'notInWar') {
        console.log(`[Poll] Clan is active in CWL! Season: ${cwlGroup.season}, State: ${cwlGroup.state}`);
        const prevCwlSnapshot = await FirestoreService.getCwlSnapshot(targetTag);
        const newCwlSnapshot = await processCwlDiff(cwlGroup, targetTag, prevCwlSnapshot, botConfig, cocService);
        if (newCwlSnapshot) {
          await FirestoreService.saveCwlSnapshot(targetTag, newCwlSnapshot);
        }
      } else {
        console.log(`[Poll] Clan not in CWL (state: ${cwlGroup?.state || 'none'})`);
      }
    } catch (cwlErr: any) {
      if (cwlErr.response?.status !== 404) {
        console.warn(`[Poll] CWL poll error: ${cwlErr.message}`);
      }
    }

    // 4. Poll Clan Capital Raids
    try {
      const raidData = await cocService.getCapitalRaidSeasons(targetTag, 1);
      if (raidData.items && raidData.items.length > 0) {
        const latestRaid = raidData.items[0];
        const prevRaidSnapshot = await FirestoreService.getRaidSnapshot(targetTag);
        const newRaidSnapshot = await processRaidDiff(latestRaid, prevRaidSnapshot, botConfig, targetTag);
        await FirestoreService.saveRaidSnapshot(targetTag, newRaidSnapshot);
      }
    } catch (raidErr: any) {
      console.warn(`[Poll] Could not fetch raid seasons: ${raidErr.message}`);
    }

    // 5. Poll Clan Games (active 22nd - 28th)
    try {
      const prevCgSnapshot = await FirestoreService.getClanGamesSnapshot(targetTag);
      const newCgSnapshot = await processClanGamesDiff(clanData.memberList, prevCgSnapshot, botConfig, cocService, targetTag);
      await FirestoreService.saveClanGamesSnapshot(targetTag, newCgSnapshot);
    } catch (cgErr: any) {
      console.warn(`[Poll] Clan Games check skipped: ${cgErr.message}`);
    }

    // 6. Poll Linked Players & Send Upgrade DMs / Timer Reminders
    try {
      const trackingResult = await runPlayerTrackingJob();
      console.log(`[Poll] Player tracking completed: ${trackingResult.checkedAccounts} accounts checked, ${trackingResult.dmsSent} DMs sent`);
    } catch (ptErr: any) {
      console.warn(`[Poll] Player tracking job error: ${ptErr.message}`);
    }

    return { success: true, message: `Successfully polled clan ${targetTag}` };
  } catch (err: any) {
    console.error(`[Poll] Error during polling job: ${err.message}`);
    return { success: false, message: err.message };
  }
}
