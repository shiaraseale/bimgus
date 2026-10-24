import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import apiFixture from './fixtures/api-player-th12.json';
import { config } from '../src/config';
import { runRoastTask } from '../src/jobs/roastJob';
import { FirestoreService } from '../src/services/firestoreService';
import { CocService } from '../src/services/cocService';
import { PlayerTrackingService } from '../src/services/playerTrackingService';
import { UserDoc } from '../src/types/user';

const task = { targetUserId: '7', targetUsername: 'Target', applicationId: 'app', interactionToken: 'tok' };

describe('/roast task', () => {
  const now = Date.parse('2026-10-24T12:00:00Z');
  const originalKey = config.gemini.apiKey;
  let patched: any[];
  let getPlayer: ReturnType<typeof vi.spyOn>;

  const userWithSnapshot = (ageMs: number): UserDoc => ({
    discordUserId: '7',
    createdAt: '',
    updatedAt: '',
    accounts: [{
      playerTag: '#ANON12345', name: 'Tester', townHallLevel: 12, isPrimary: true,
      lastSnapshot: PlayerTrackingService.createSnapshot(apiFixture, new Date(now - ageMs)),
    }],
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    config.gemini.apiKey = 'test-key';
    patched = [];
    vi.spyOn(axios, 'patch').mockImplementation(async (url: string, body: any) => { patched.push({ url, body }); return {} as any; });
    vi.spyOn(FirestoreService, 'getWarSnapshot').mockResolvedValue(null as any);
    getPlayer = vi.spyOn(CocService.prototype, 'getPlayer').mockResolvedValue(apiFixture as any);
    return () => { config.gemini.apiKey = originalKey; };
  });

  it('uses the snapshot, not the CoC API, and edits the original reply', async () => {
    vi.spyOn(FirestoreService, 'getUser').mockResolvedValue(userWithSnapshot(60_000));
    const post = vi.spyOn(axios, 'post').mockResolvedValue({
      data: { steps: [{ type: 'model_output', content: [{ type: 'text', text: '<@7> your walls are a welcome mat.' }] }] },
    } as any);

    await runRoastTask(task, now);

    expect(getPlayer).not.toHaveBeenCalled();
    const body = post.mock.calls[0][1] as any;
    expect(body.generation_config).toEqual({ thinking_level: 'low', max_output_tokens: 1024 });
    expect(body.input).toContain(`War Stars: ${apiFixture.warStars}`);
    expect(patched).toEqual([{ url: expect.stringContaining('/webhooks/app/tok/messages/@original'), body: { content: '<@7> your walls are a welcome mat.' } }]);
  });

  it('makes one live call when the snapshot is stale', async () => {
    vi.spyOn(FirestoreService, 'getUser').mockResolvedValue(userWithSnapshot(60 * 60_000));
    vi.spyOn(axios, 'post').mockResolvedValue({ data: {} } as any);
    await runRoastTask(task, now);
    expect(getPlayer).toHaveBeenCalledTimes(1);
  });

  it('falls back to a canned roast when Gemini times out', async () => {
    vi.spyOn(FirestoreService, 'getUser').mockResolvedValue(userWithSnapshot(60_000));
    vi.spyOn(axios, 'post').mockRejectedValue(new Error('timeout of 6000ms exceeded'));
    await runRoastTask(task, now);
    expect(patched).toHaveLength(1);
    expect(patched[0].body.content).toMatch(/^<@7> /);
    expect(patched[0].body.content.length).toBeGreaterThan(20);
  });
});
