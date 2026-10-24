import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { AddressInfo } from 'net';
import { Server } from 'http';
import { dashboardApp } from '../src/api/dashboardApi';
import { FirestoreService } from '../src/services/firestoreService';
import { CocService } from '../src/services/cocService';

describe('dashboardApi', () => {
  let server: Server;
  let baseUrl: string;
  const originalAdminKey = process.env.ADMIN_API_KEY;
  const TEST_ADMIN_KEY = 'test-secret-key-12345';

  beforeAll(async () => {
    process.env.ADMIN_API_KEY = TEST_ADMIN_KEY;
    server = dashboardApp.listen(0);
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    if (originalAdminKey === undefined) {
      delete process.env.ADMIN_API_KEY;
    } else {
      process.env.ADMIN_API_KEY = originalAdminKey;
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('ping endpoint', () => {
    it('returns 204 No Content for GET /api/ping without requiring auth', async () => {
      const res = await fetch(`${baseUrl}/api/ping`);
      expect(res.status).toBe(204);
      const body = await res.text();
      expect(body).toBe('');
    });
  });

  describe('public data from the poll\'s saved copies (3.6)', () => {
    const fresh = (data: any) => ({ data, updatedAt: new Date().toISOString() });
    const stale = (data: any) => ({ data, updatedAt: new Date(Date.now() - 20 * 60_000).toISOString() });
    let getClan: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      getClan = vi.fn(async () => ({ tag: '#TESTCLAN', name: 'Live' }));
      vi.spyOn(CocService, 'shared').mockReturnValue({ getClan, getCurrentWar: vi.fn(async () => ({ state: 'notInWar' })), getCwlGroup: vi.fn(async () => ({ state: 'notInWar' })) } as any);
    });

    it('serves a fresh saved clan without a live call, and lets the CDN cache it', async () => {
      vi.spyOn(FirestoreService, 'getRaw').mockResolvedValue(fresh({ tag: '#TESTCLAN', name: 'Saved' }));
      const res = await fetch(`${baseUrl}/api/clan/%23TESTCLAN`);
      expect((await res.json()).data.name).toBe('Saved');
      expect(getClan).not.toHaveBeenCalled();
      expect(res.headers.get('cache-control')).toBe('public, max-age=60, s-maxage=60');
    });

    it('goes live when the saved copy is old (the poll may be failing)', async () => {
      vi.spyOn(FirestoreService, 'getRaw').mockResolvedValue(stale({ tag: '#TESTCLAN', name: 'Saved' }));
      const res = await fetch(`${baseUrl}/api/clan/%23TESTCLAN`);
      expect((await res.json()).data.name).toBe('Live');
    });

    it('shows the active CWL war when there is no regular war', async () => {
      vi.spyOn(FirestoreService, 'getRaw').mockImplementation(async (_tag: string, key: string) =>
        key === 'war' ? fresh({ state: 'notInWar' }) : fresh({ state: 'inWar', isCwl: true, cwlRound: 3 })
      );
      const res = await fetch(`${baseUrl}/api/clan/%23TESTCLAN/war`);
      expect((await res.json()).data).toMatchObject({ isCwl: true, cwlRound: 3 });
    });

    it('keeps admin routes uncached', async () => {
      const res = await fetch(`${baseUrl}/api/clan/%23TESTCLAN/config`);
      expect(res.headers.get('cache-control')).toContain('no-store');
    });
  });

  it('/api/meta says which clan this deployment tracks (4.4)', async () => {
    const res = await fetch(`${baseUrl}/api/meta`);
    expect(res.status).toBe(200);
    expect((await res.json()).data).toHaveProperty('clanTag');
  });

  describe('route mounts (item 1.3)', () => {
    it('no longer serves routes outside /api', async () => {
      expect((await fetch(`${baseUrl}/ping`)).status).toBe(404);
      expect((await fetch(`${baseUrl}/clan/%23TESTCLAN`)).status).toBe(404);
      const interactions = await fetch(`${baseUrl}/discord/interactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 1 }),
      });
      expect(interactions.status).toBe(404);
    });
  });

  describe('admin key lockdown (item 1.1)', () => {
    it('rejects GET /api/clan/:tag/config when X-Admin-Key is missing', async () => {
      const res = await fetch(`${baseUrl}/api/clan/%23TESTCLAN/config`);
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toContain('Unauthorized');
    });

    it('rejects GET /api/clan/:tag/config when X-Admin-Key is invalid', async () => {
      const res = await fetch(`${baseUrl}/api/clan/%23TESTCLAN/config`, {
        headers: { 'X-Admin-Key': 'wrong-key' },
      });
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toContain('Unauthorized');
    });

    it('returns sanitized booleans for webhooks on GET /api/clan/:tag/config with valid X-Admin-Key', async () => {
      vi.spyOn(FirestoreService, 'getConfig').mockResolvedValue({
        clanTag: '#TESTCLAN',
        webhooks: {
          clanActivity: 'https://discord.com/api/webhooks/123/secret-activity-token',
          warRoom: 'https://discord.com/api/webhooks/456/secret-war-token',
          cwlHub: '',
          raidWeekend: '',
          clanGames: '',
        },
        notificationsEnabled: {} as any,
        warReminderHours: [4, 1],
      });

      const res = await fetch(`${baseUrl}/api/clan/%23TESTCLAN/config`, {
        headers: { 'X-Admin-Key': TEST_ADMIN_KEY },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);

      // Webhooks must be booleans indicating presence, NEVER raw URLs
      expect(data.data.webhooks).toEqual({
        clanActivity: true,
        warRoom: true,
        cwlHub: false,
        raidWeekend: false,
        clanGames: false,
      });

      // Verify no sensitive tokens were returned anywhere in response
      const jsonStr = JSON.stringify(data);
      expect(jsonStr).not.toContain('secret-activity-token');
      expect(jsonStr).not.toContain('secret-war-token');
    });

    it('rejects POST /api/clan/:tag/poll when X-Admin-Key is missing', async () => {
      const res = await fetch(`${baseUrl}/api/clan/%23TESTCLAN/poll`, {
        method: 'POST',
      });
      expect(res.status).toBe(401);
    });

    it('rejects POST /api/test-webhook when X-Admin-Key is missing', async () => {
      const res = await fetch(`${baseUrl}/api/test-webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ webhookUrl: 'https://discord.com/api/webhooks/test' }),
      });
      expect(res.status).toBe(401);
    });

    it('rejects POST /api/discord/register-commands when X-Admin-Key is missing', async () => {
      const res = await fetch(`${baseUrl}/api/discord/register-commands`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(401);
    });

    it('rejects POST /api/clan/:tag/config when X-Admin-Key is missing', async () => {
      const res = await fetch(`${baseUrl}/api/clan/%23TESTCLAN/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notificationsEnabled: {} }),
      });
      expect(res.status).toBe(401);
    });

    it('updates config and preserves existing webhook URLs on POST /api/clan/:tag/config with valid key', async () => {
      const existingConfig = {
        clanTag: '#TESTCLAN',
        webhooks: {
          clanActivity: 'https://discord.com/api/webhooks/original-activity',
          warRoom: 'https://discord.com/api/webhooks/original-war',
          cwlHub: '',
          raidWeekend: '',
          clanGames: '',
        },
        notificationsEnabled: { memberJoinedLeft: true } as any,
        warReminderHours: [4, 1],
      };

      vi.spyOn(FirestoreService, 'getConfig').mockResolvedValue(existingConfig);
      const updateSpy = vi.spyOn(FirestoreService, 'updateConfig').mockResolvedValue(undefined);

      // Client sends boolean flags or empty strings in webhooks (e.g. from UI)
      const res = await fetch(`${baseUrl}/api/clan/%23TESTCLAN/config`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Admin-Key': TEST_ADMIN_KEY,
        },
        body: JSON.stringify({
          webhooks: {
            clanActivity: true, // boolean from UI shouldn't overwrite original URL
            warRoom: 'https://discord.com/api/webhooks/new-war', // new URL replaces
          },
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);

      // Verify updateConfig was called with merged webhooks
      expect(updateSpy).toHaveBeenCalledWith('#TESTCLAN', {
        webhooks: {
          clanActivity: 'https://discord.com/api/webhooks/original-activity',
          warRoom: 'https://discord.com/api/webhooks/new-war',
          cwlHub: '',
          raidWeekend: '',
          clanGames: '',
        },
      });
    });

    it('rejects POST /api/clan/:tag/cwl-summary/broadcast when X-Admin-Key is missing', async () => {
      const res = await fetch(`${baseUrl}/api/clan/%23TESTCLAN/cwl-summary/broadcast`, {
        method: 'POST',
      });
      expect(res.status).toBe(401);
    });

    it('rejects POST /api/clan/:tag/war-summary/broadcast when X-Admin-Key is missing', async () => {
      const res = await fetch(`${baseUrl}/api/clan/%23TESTCLAN/war-summary/broadcast`, {
        method: 'POST',
      });
      expect(res.status).toBe(401);
    });
  });
});
