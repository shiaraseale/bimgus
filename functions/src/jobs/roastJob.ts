/**
 * /roast, run outside the interaction request (2.7). The interaction handler replies "thinking…",
 * queues this as a Cloud Task (which gets full CPU, unlike work done after an HTTP response), and
 * this edits the reply. It builds the roast from the 2-minute snapshot instead of live API calls.
 */
import axios from 'axios';
import { config } from '../config';
import { CocService } from '../services/cocService';
import { FirestoreService } from '../services/firestoreService';
import { GeminiRoastService, PlayerRoastData } from '../services/geminiRoastService';
import { LinkedAccount } from '../types/user';

export interface RoastTaskData {
  targetUserId: string;
  targetUsername: string;
  applicationId: string;
  interactionToken: string;
}

// A snapshot older than this (polling stopped, or the account was just linked) gets one live call
const SNAPSHOT_MAX_AGE_MS = 15 * 60 * 1000;
const LIVE_CALL_TIMEOUT_MS = 2000;

let instanceIsWarm = false;

async function accountRoastData(acc: LinkedAccount, cocService: CocService, warSnap: any, now: number): Promise<{ data: PlayerRoastData; live: boolean }> {
  const snap = acc.lastSnapshot;
  const data: PlayerRoastData = {
    name: acc.name || 'Clasher',
    tag: acc.playerTag,
    townHallLevel: acc.townHallLevel || 1,
    builderHallLevel: acc.builderHallLevel,
    trophies: 0,
    warStars: 0,
    donations: 0,
    donationsReceived: 0,
    attackWins: 0,
    defenseWins: 0,
    heroes: [],
  };

  const fresh = snap?.stats && now - new Date(snap.updatedAt).getTime() <= SNAPSHOT_MAX_AGE_MS;
  let live = false;
  if (fresh && snap?.stats) {
    Object.assign(data, snap.stats);
    data.name = snap.name || data.name;
    data.townHallLevel = snap.townHallLevel;
    data.builderHallLevel = snap.builderHallLevel;
    data.heroes = Object.entries(snap.heroes || {}).map(([key, h]) => ({ name: h.name ?? key.replace(/^(home|builder):/, ''), level: h.level }));
  } else {
    live = true;
    try {
      const fp: any = await Promise.race([
        cocService.getPlayer(acc.playerTag),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), LIVE_CALL_TIMEOUT_MS)),
      ]);
      Object.assign(data, {
        name: fp.name,
        townHallLevel: fp.townHallLevel,
        builderHallLevel: fp.builderHallLevel,
        trophies: fp.trophies,
        warStars: fp.warStars,
        donations: fp.donations,
        donationsReceived: fp.donationsReceived,
        attackWins: fp.attackWins || 0,
        defenseWins: fp.defenseWins || 0,
        warPreference: fp.warPreference,
        heroes: (fp.heroes || []).map((h: any) => ({ name: h.name, level: h.level })),
      });
    } catch {
      if (snap?.heroes) {
        data.heroes = Object.entries(snap.heroes).map(([key, h]) => ({ name: h.name ?? key.replace(/^(home|builder):/, ''), level: h.level }));
      }
    }
  }

  const audit = warSnap?.postWarAudit;
  if (audit) {
    const tag = acc.playerTag.toUpperCase();
    const missed = audit.zeroAttacks?.find((m: any) => m.tag.toUpperCase() === tag);
    const partial = audit.partialAttacks?.find((m: any) => m.tag.toUpperCase() === tag);
    if (missed) data.warPerformance = 'Missed all attacks in clan war (0 attacks used)';
    else if (partial) data.warPerformance = `Only used ${partial.attacksUsed} attack for ${partial.starsGained} stars in clan war`;
  }
  return { data, live };
}

/** Edits the original "thinking…" reply; retries once if Discord hasn't registered the reply yet. */
async function editReply(task: RoastTaskData, content: string): Promise<void> {
  const url = `https://discord.com/api/v10/webhooks/${task.applicationId}/${task.interactionToken}/messages/@original`;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await axios.patch(url, { content }, { headers: { 'Content-Type': 'application/json' }, timeout: 10000 });
      return;
    } catch (err: any) {
      if (attempt === 1 && err.response?.status === 404) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        continue;
      }
      console.error('[Roast] Failed to edit the reply:', err.response?.data || err.message);
      return;
    }
  }
}

export async function runRoastTask(task: RoastTaskData, now: number = Date.now()): Promise<void> {
  const cold = !instanceIsWarm;
  instanceIsWarm = true;
  const started = Date.now();
  const timings: Record<string, number> = {};
  const time = async <T>(stage: string, fn: () => Promise<T>): Promise<T> => {
    const t = Date.now();
    try {
      return await fn();
    } finally {
      timings[stage] = Date.now() - t;
    }
  };

  const mention = `<@${task.targetUserId}>`;
  let liveCalls = 0;
  try {
    const userDoc = await time('userRead', () => FirestoreService.getUser(task.targetUserId));
    let accounts: PlayerRoastData[] | undefined;
    if (userDoc?.accounts?.length) {
      const warSnap = await time('warSnapshot', () => FirestoreService.getWarSnapshot(config.coc.clanTag).catch(() => null));
      const cocService = CocService.shared();
      const results = await time('accounts', () =>
        Promise.all(userDoc.accounts.map((acc) => accountRoastData(acc, cocService, warSnap, now)))
      );
      liveCalls = results.filter((r) => r.live).length;
      accounts = results.map((r) => r.data);
    }

    const roast = await time('gemini', () =>
      GeminiRoastService.generateRoast({ discordMention: mention, discordUsername: task.targetUsername, accounts })
    );
    await time('discordEdit', () => editReply(task, roast.includes(mention) ? roast : `${mention} ${roast}`));
  } catch (err: any) {
    console.error('[Roast] Error executing roast:', err);
    await editReply(task, `❌ Bimgus got too heated and fumbled the roast: ${err.message || 'Unknown error'}`);
  } finally {
    // One structured line per roast (2.7 step 1), to see which stage is slow
    console.log(JSON.stringify({ message: '[Roast] timings', cold, liveCalls, totalMs: Date.now() - started, ...timings }));
  }
}
