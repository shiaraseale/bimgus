import { CocService } from '../services/cocService';
import { FirestoreService } from '../services/firestoreService';
import { processClanDiff } from '../diff/clanDiff';
import { processWarDiff } from '../diff/warDiff';
import { processRaidDiff } from '../diff/raidDiff';
import { processCwlDiff } from '../diff/cwlDiff';
import { processClanGamesDiff } from '../diff/clanGamesDiff';
import { runPlayerTrackingJob } from './playerTrackingJob';
import { runWarPingJob } from './warPingJob';
import { config } from '../config';
import { changedIgnoringUpdatedAt } from '../utils/changes';
import { findActiveCwlWar, withOurClanFirst } from '../diff/cwlWars';
import { log } from '../utils/log';

const TICK_MS = 2 * 60 * 1000;
// Each task gets this long before the run stops waiting for it (the function's timeout is longer)
const TASK_BUDGET_MS = 75 * 1000;

export interface PollOptions {
  // When the scheduler meant this run to happen; decides which every-other-tick and 30-minute tasks run
  scheduleTime?: Date;
  // Run everything regardless of the tick (the dashboard's "Sync" button)
  full?: boolean;
}

/** Which tasks this tick runs (3.1). One 2-minute job does everything, to stay within the free scheduler jobs. */
export function tasksForTick(scheduleTime: Date, full = false) {
  const tick = Math.floor(scheduleTime.getTime() / TICK_MS);
  const everyOtherTick = full || tick % 2 === 0;
  return {
    war: true,
    playerTracking: true,
    clanGames: true, // every tick, so the 08:00 UTC start announcement stays on time (2.1)
    cwl: everyOtherTick,
    raids: everyOtherTick,
    // Was its own 30-minute scheduled job; ticks fall on even minutes, so this is :00 and :30
    warReminders: !full && scheduleTime.getUTCMinutes() % 30 < 2,
  };
}

/** Runs one task with its own error handling and time budget, so it can't stop the others. */
async function runTask(name: string, fn: () => Promise<void>): Promise<void> {
  const started = Date.now();
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      fn(),
      new Promise<void>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`still running after ${TASK_BUDGET_MS / 1000}s`)), TASK_BUDGET_MS);
      }),
    ]);
  } catch (err: any) {
    log.warn(`[Poll] ${name} failed after ${Date.now() - started}ms: ${err.message}`);
  } finally {
    clearTimeout(timer);
  }
}

export async function runPollClanJob(
  clanTagOverride?: string,
  options: PollOptions = {}
): Promise<{ success: boolean; message: string }> {
  const targetTag = clanTagOverride || config.coc.clanTag;
  if (!targetTag) {
    return { success: false, message: 'No clan tag configured. Set COC_CLAN_TAG in environment or Firestore.' };
  }

  const cocService = CocService.shared();
  const botConfig = await FirestoreService.getConfig(targetTag);
  const tasks = tasksForTick(options.scheduleTime ?? new Date(), options.full ?? clanTagOverride !== undefined);

  try {
    // 1. Clan roster first: Clan Games needs the member list
    log.info(`[Poll] Fetching clan ${targetTag}...`);
    const clanData = await cocService.getClan(targetTag);
    const prevClanSnapshot = await FirestoreService.getClanSnapshot(targetTag);
    const newClanSnapshot = await processClanDiff(clanData, prevClanSnapshot, botConfig);
    await FirestoreService.saveRaw(targetTag, 'clan', clanData);
    if (changedIgnoringUpdatedAt(prevClanSnapshot, newClanSnapshot)) await FirestoreService.saveClanSnapshot(newClanSnapshot);

    // 2. The war next, on its own: the war snapshot it saves carries flags that player tracking (the
    // roster DMs) and the reminders set, so those must run after it, not alongside it
    if (tasks.war) {
      await runTask('War', async () => {
        try {
          const warData = await cocService.getCurrentWar(targetTag);
          const prevWarSnapshot = await FirestoreService.getWarSnapshot(targetTag);
          const newWarSnapshot = await processWarDiff(warData, prevWarSnapshot, botConfig);
          if (newWarSnapshot && changedIgnoringUpdatedAt(prevWarSnapshot, newWarSnapshot)) {
            await FirestoreService.saveWarSnapshot(targetTag, newWarSnapshot);
          }
          // The dashboard's War Room shows the full war (members and attacks), not the snapshot summary.
          // Saved every tick, even when not in war, so the dashboard knows its copy is current.
          await FirestoreService.saveRaw(targetTag, 'war', warData);
        } catch (warErr: any) {
          if (warErr.response?.status === 403) {
            log.warn('[Poll] Could not fetch current war: the war log is private');
            return;
          }
          throw warErr;
        }
      });
    }

    // 3. Everything else in parallel
    const work: Array<Promise<void>> = [];

    if (tasks.cwl) {
      work.push(runTask('CWL', async () => {
        try {
          const cwlGroup = await cocService.getCwlGroup(targetTag);
          if (!cwlGroup || cwlGroup.state === 'notInWar') {
            await FirestoreService.saveRaw(targetTag, 'cwlWar', null);
            return;
          }
          log.info(`[Poll] Clan is active in CWL! Season: ${cwlGroup.season}, State: ${cwlGroup.state}`);
          const prevCwlSnapshot = await FirestoreService.getCwlSnapshot(targetTag);
          const newCwlSnapshot = await processCwlDiff(cwlGroup, targetTag, prevCwlSnapshot, botConfig, cocService);
          if (newCwlSnapshot && changedIgnoringUpdatedAt(prevCwlSnapshot, newCwlSnapshot)) {
            await FirestoreService.saveCwlSnapshot(targetTag, newCwlSnapshot);
          }
          // The active CWL war for the dashboard (one request per round once our war tags are known)
          const active = await findActiveCwlWar(cwlGroup, targetTag, cocService, ['inWar', 'preparation'], newCwlSnapshot?.ourWarTags);
          await FirestoreService.saveRaw(
            targetTag,
            'cwlWar',
            active ? { ...withOurClanFirst(active.war, targetTag), isCwl: true, attacksPerMember: 1, cwlRound: active.roundIndex + 1, cwlSeason: cwlGroup.season } : null
          );
        } catch (cwlErr: any) {
          if (cwlErr.response?.status === 404) {
            await FirestoreService.saveRaw(targetTag, 'cwlWar', null); // not in CWL
            return;
          }
          throw cwlErr;
        }
      }));
    }

    if (tasks.raids) {
      work.push(runTask('Raids', async () => {
        const raidData = await cocService.getCapitalRaidSeasons(targetTag, 1);
        if (raidData.items && raidData.items.length > 0) {
          const prevRaidSnapshot = await FirestoreService.getRaidSnapshot(targetTag);
          const newRaidSnapshot = await processRaidDiff(raidData.items[0], prevRaidSnapshot, botConfig, targetTag);
          if (changedIgnoringUpdatedAt(prevRaidSnapshot, newRaidSnapshot)) await FirestoreService.saveRaidSnapshot(targetTag, newRaidSnapshot);
        }
      }));
    }

    if (tasks.clanGames) {
      work.push(runTask('Clan Games', async () => {
        const prevCgSnapshot = await FirestoreService.getClanGamesSnapshot(targetTag);
        const newCgSnapshot = await processClanGamesDiff(clanData.memberList, prevCgSnapshot, botConfig, cocService, targetTag);
        if (changedIgnoringUpdatedAt(prevCgSnapshot, newCgSnapshot)) await FirestoreService.saveClanGamesSnapshot(targetTag, newCgSnapshot);
      }));
    }

    if (tasks.playerTracking) {
      work.push(runTask('Player tracking', async () => {
        const trackingResult = await runPlayerTrackingJob();
        log.info(`[Poll] Player tracking completed: ${trackingResult.checkedAccounts} accounts checked, ${trackingResult.dmsSent} DMs sent`);
      }));
    }

    await Promise.all(work);

    // 4. Reminders last, after the war and CWL snapshots for this tick are saved
    if (tasks.warReminders) {
      await runTask('War reminders', async () => {
        const result = await runWarPingJob(targetTag);
        log.info('[Poll] War reminders:', result.message);
      });
    }
    return { success: true, message: `Successfully polled clan ${targetTag}` };
  } catch (err: any) {
    log.error(`[Poll] Error during polling job: ${err.message}`);
    return { success: false, message: err.message };
  }
}
