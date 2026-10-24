import { describe, it, expect, vi, beforeEach } from 'vitest';
import apiFixture from './fixtures/api-player-th12.json';
import { changedIgnoringUpdatedAt } from '../src/utils/changes';
import { runPlayerTrackingJob } from '../src/jobs/playerTrackingJob';
import { FirestoreService } from '../src/services/firestoreService';
import { CocService } from '../src/services/cocService';
import { PlayerTrackingService } from '../src/services/playerTrackingService';
import { UserDoc } from '../src/types/user';

describe('only write when something changed (3.4)', () => {
  it('ignores updatedAt when comparing', () => {
    expect(changedIgnoringUpdatedAt({ a: 1, updatedAt: 'x' }, { a: 1, updatedAt: 'y' })).toBe(false);
    expect(changedIgnoringUpdatedAt({ a: 1, updatedAt: 'x' }, { a: 2, updatedAt: 'x' })).toBe(true);
    expect(changedIgnoringUpdatedAt(null, { a: 1 })).toBe(true);
  });

  describe('player tracking', () => {
    let save: ReturnType<typeof vi.spyOn>;
    const userWithSnapshotAge = (ageMs: number): UserDoc => ({
      discordUserId: '42',
      createdAt: '',
      updatedAt: '',
      accounts: [
        {
          playerTag: '#ANON12345',
          name: apiFixture.name,
          townHallLevel: 12,
          isPrimary: true,
          lastSnapshot: PlayerTrackingService.createSnapshot(apiFixture, new Date(Date.now() - ageMs)),
        },
      ],
    });

    beforeEach(() => {
      vi.restoreAllMocks();
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.spyOn(CocService, 'shared').mockReturnValue({
        getPlayer: vi.fn(async () => JSON.parse(JSON.stringify(apiFixture))),
        getCurrentWar: vi.fn(async () => ({ state: 'notInWar' })),
      } as any);
      save = vi.spyOn(FirestoreService, 'saveUser').mockResolvedValue(undefined as any);
    });

    it('does not save a user whose data is unchanged', async () => {
      vi.spyOn(FirestoreService, 'getAllUsers').mockResolvedValue([userWithSnapshotAge(60_000)]);
      await runPlayerTrackingJob();
      expect(save).not.toHaveBeenCalled();
    });

    it('still refreshes a snapshot over 10 minutes old (for /roast)', async () => {
      vi.spyOn(FirestoreService, 'getAllUsers').mockResolvedValue([userWithSnapshotAge(11 * 60_000)]);
      await runPlayerTrackingJob();
      expect(save).toHaveBeenCalledTimes(1);
    });
  });
});

describe('saveUser removes fields nothing reads any more (4.1)', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('drops manual timers, the apprentice timer, old imports and activeAccountTag', async () => {
    const set = vi.fn(async () => {});
    vi.spyOn((FirestoreService as any).usersCol, 'doc').mockReturnValue({ set });
    await FirestoreService.saveUser({
      discordUserId: '42',
      createdAt: '',
      updatedAt: '',
      activeAccountTag: 'ALL',
      accounts: [
        {
          playerTag: '#A',
          name: 'A',
          townHallLevel: 12,
          isPrimary: true,
          activeUpgrades: [],
          apprenticeTimer: {},
          villageData: { homeDefenses: [] },
        },
        { playerTag: '#B', name: 'B', townHallLevel: 9, isPrimary: false, villageData: { version: 2, items: [] } },
      ],
    } as any);
    const [doc, opts] = set.mock.calls[0] as any;
    expect(opts).toEqual({ merge: true });
    expect(doc.accounts[0]).toEqual({ playerTag: '#A', name: 'A', townHallLevel: 12, isPrimary: true });
    expect(doc.accounts[1].villageData).toEqual({ version: 2, items: [] });
    expect(doc.activeAccountTag.constructor.name).toMatch(/DeleteTransform|FieldValue/);
  });

  it('/unlink without a tag only works for a single account', async () => {
    vi.spyOn(FirestoreService, 'getUser').mockResolvedValue({
      discordUserId: '42',
      createdAt: '',
      updatedAt: '',
      accounts: [
        { playerTag: '#A', name: 'A', townHallLevel: 1, isPrimary: true },
        { playerTag: '#B', name: 'B', townHallLevel: 1, isPrimary: false },
      ],
    } as any);
    const result = await FirestoreService.unlinkAccount('42');
    expect(result).toMatchObject({ success: false, needsTag: true, remainingAccounts: 2 });
  });
});
