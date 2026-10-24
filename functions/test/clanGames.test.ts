import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DiscordService } from '../src/services/discordService';
import { CocService } from '../src/services/cocService';
import { processClanGamesDiff } from '../src/diff/clanGamesDiff';
import { isClanGamesActive } from '../src/diff/clanGamesWindow';
import { BotConfigDoc } from '../src/types/db';
import { ClanMember } from '../src/types/coc';

const utc = (iso: string) => new Date(`${iso}Z`);

describe('isClanGamesActive', () => {
  it('starts at 08:00 UTC on the 22nd', () => {
    expect(isClanGamesActive(utc('2026-11-22T00:00:00'))).toBe(false);
    expect(isClanGamesActive(utc('2026-11-22T07:59:59'))).toBe(false);
    expect(isClanGamesActive(utc('2026-11-22T08:00:00'))).toBe(true);
  });

  it('runs until the end of the 28th', () => {
    expect(isClanGamesActive(utc('2026-11-25T03:00:00'))).toBe(true);
    expect(isClanGamesActive(utc('2026-11-28T23:59:59'))).toBe(true);
    expect(isClanGamesActive(utc('2026-11-29T00:00:00'))).toBe(false);
  });

  it('is inactive on other days', () => {
    expect(isClanGamesActive(utc('2026-11-21T12:00:00'))).toBe(false);
    expect(isClanGamesActive(utc('2026-11-01T08:00:00'))).toBe(false);
  });
});

describe('processClanGamesDiff start announcement', () => {
  const config = {
    webhooks: { clanGames: 'https://discord.com/api/webhooks/1/test' },
    notificationsEnabled: { clanGamesStart: true, clanGamesTiers: true, clanGamesMaxers: true },
  } as unknown as BotConfigDoc;
  const members = [{ tag: '#P1', name: 'Player', role: 'member' }] as ClanMember[];
  const coc = {
    getPlayer: vi.fn(async () => ({ achievements: [{ name: 'Games Champion', value: 1000 }] })),
  } as unknown as CocService;

  let sendWebhook: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.restoreAllMocks();
    sendWebhook = vi.spyOn(DiscordService, 'sendWebhook').mockResolvedValue(true);
  });

  const startMessages = () =>
    sendWebhook.mock.calls.filter(([, payload]: any[]) => payload.embeds?.[0]?.title?.includes('Have Begun'));

  it('does not announce at 07:59 UTC on the 22nd', async () => {
    const snapshot = await processClanGamesDiff(members, null, config, coc, '#CLAN', utc('2026-11-22T07:59:00'));
    expect(startMessages()).toHaveLength(0);
    expect(snapshot.isActive).toBe(false);
    expect(snapshot.announcedStart).toBe(false);
  });

  it('announces once at 08:00 UTC and not again on the next poll', async () => {
    const first = await processClanGamesDiff(members, null, config, coc, '#CLAN', utc('2026-11-22T08:00:00'));
    expect(startMessages()).toHaveLength(1);
    expect(first.announcedStart).toBe(true);
    expect(first.memberBaselinePoints).toEqual({ '#P1': 1000 });

    await processClanGamesDiff(members, first, config, coc, '#CLAN', utc('2026-11-22T08:02:00'));
    expect(startMessages()).toHaveLength(1);
  });

  it('announces after a pre-08:00 poll on the same day', async () => {
    const early = await processClanGamesDiff(members, null, config, coc, '#CLAN', utc('2026-11-22T07:58:00'));
    await processClanGamesDiff(members, early, config, coc, '#CLAN', utc('2026-11-22T08:00:30'));
    expect(startMessages()).toHaveLength(1);
  });
});
