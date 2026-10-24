import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/diff/clanDiff', () => ({ processClanDiff: vi.fn(async () => ({ tag: '#C' })) }));
vi.mock('../src/diff/warDiff', () => ({ processWarDiff: vi.fn(async () => null) }));
vi.mock('../src/diff/raidDiff', () => ({ processRaidDiff: vi.fn(async () => ({})) }));
vi.mock('../src/diff/cwlDiff', () => ({ processCwlDiff: vi.fn(async () => null) }));
vi.mock('../src/diff/clanGamesDiff', () => ({ processClanGamesDiff: vi.fn(async () => ({})) }));
vi.mock('../src/jobs/playerTrackingJob', () => ({
  runPlayerTrackingJob: vi.fn(async () => ({ success: true, checkedAccounts: 3, dmsSent: 0 })),
}));
vi.mock('../src/jobs/warPingJob', () => ({ runWarPingJob: vi.fn(async () => ({ success: true, message: 'ok' })) }));

import { runPollClanJob, tasksForTick } from '../src/jobs/pollClanJob';
import { CocService } from '../src/services/cocService';
import { FirestoreService } from '../src/services/firestoreService';
import { runPlayerTrackingJob } from '../src/jobs/playerTrackingJob';
import { runWarPingJob } from '../src/jobs/warPingJob';
import { processClanGamesDiff } from '../src/diff/clanGamesDiff';

const at = (iso: string) => new Date(`${iso}Z`);

describe('tasksForTick (3.1)', () => {
  it('runs CWL and raids every other tick, everything else every tick', () => {
    const a = tasksForTick(at('2026-10-24T12:00:00'));
    const b = tasksForTick(at('2026-10-24T12:02:00'));
    expect(a.cwl).not.toBe(b.cwl);
    expect(a.raids).toBe(a.cwl);
    for (const t of [a, b]) expect(t).toMatchObject({ war: true, playerTracking: true, clanGames: true });
  });

  it('runs war reminders at :00 and :30 only', () => {
    const minutes = Array.from({ length: 30 }, (_, i) => i * 2); // every tick in an hour
    const reminders = minutes.filter(
      (m) => tasksForTick(at(`2026-10-24T12:${String(m).padStart(2, '0')}:05`)).warReminders
    );
    expect(reminders).toEqual([0, 30]);
  });

  it('runs everything (but not reminders) for a manual sync', () => {
    expect(tasksForTick(at('2026-10-24T12:02:00'), true)).toMatchObject({
      cwl: true,
      raids: true,
      warReminders: false,
    });
  });
});

describe('runPollClanJob', () => {
  const coc = {
    getClan: vi.fn(async () => ({ tag: '#C', memberList: [] })),
    getCurrentWar: vi.fn(async () => ({ state: 'notInWar' })),
    getCwlGroup: vi.fn(async () => ({ state: 'notInWar' })),
    getCapitalRaidSeasons: vi.fn(async () => ({ items: [] })),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(CocService, 'shared').mockReturnValue(coc as any);
    for (const m of [
      'getConfig',
      'getClanSnapshot',
      'saveClanSnapshot',
      'getWarSnapshot',
      'saveWarSnapshot',
      'getCwlSnapshot',
      'saveCwlSnapshot',
      'getRaidSnapshot',
      'saveRaidSnapshot',
      'getClanGamesSnapshot',
      'saveClanGamesSnapshot',
      'saveRaw',
    ] as const) {
      vi.spyOn(FirestoreService, m as any).mockResolvedValue(
        m === 'getConfig' ? { webhooks: {}, notificationsEnabled: {} } : null
      );
    }
  });

  it('keeps going when one task fails', async () => {
    coc.getCurrentWar.mockRejectedValueOnce(new Error('timeout of 10000ms exceeded'));
    const result = await runPollClanJob('#C', { scheduleTime: at('2026-10-24T12:00:00') });
    expect(result.success).toBe(true);
    expect(runPlayerTrackingJob).toHaveBeenCalled();
    expect(processClanGamesDiff).toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('[Poll] War failed'));
  });

  it('saves the war before player tracking and the reminders run (they set flags on it)', async () => {
    const order: string[] = [];
    (FirestoreService.getWarSnapshot as any).mockImplementation(async () => {
      order.push('war');
      return null;
    });
    (runPlayerTrackingJob as any).mockImplementation(async () => {
      order.push('tracking');
      return { checkedAccounts: 0, dmsSent: 0 };
    });
    (runWarPingJob as any).mockImplementation(async () => {
      order.push('reminders');
      return { success: true, message: 'ok' };
    });
    coc.getCurrentWar.mockResolvedValueOnce({ state: 'inWar' } as any);
    await runPollClanJob(undefined, { scheduleTime: at('2026-10-24T12:30:00') });
    expect(order).toEqual(['war', 'tracking', 'reminders']);
  });

  it('runs the war reminders from the 2-minute job at :30', async () => {
    await runPollClanJob(undefined, { scheduleTime: at('2026-10-24T12:30:00') });
    expect(runWarPingJob).toHaveBeenCalledTimes(1);
    await runPollClanJob(undefined, { scheduleTime: at('2026-10-24T12:32:00') });
    expect(runWarPingJob).toHaveBeenCalledTimes(1);
  });
});
