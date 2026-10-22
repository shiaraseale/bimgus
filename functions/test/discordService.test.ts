import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DiscordService } from '../src/services/discordService';

describe('DiscordService DRY_RUN_DISCORD', () => {
  const originalEnv = process.env.DRY_RUN_DISCORD;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env.DRY_RUN_DISCORD = originalEnv;
  });

  it('logs and skips sending webhooks when DRY_RUN_DISCORD=1', async () => {
    process.env.DRY_RUN_DISCORD = '1';
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const result = await DiscordService.sendWebhook('https://discord.com/api/webhooks/test', {
      content: 'Test notification',
    });

    expect(result).toBe(true);
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('[DiscordService DRY_RUN] Would send webhook to target'),
      expect.stringContaining('Test notification')
    );
  });

  it('logs and skips sending DMs when DRY_RUN_DISCORD=1', async () => {
    process.env.DRY_RUN_DISCORD = '1';
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const result = await DiscordService.sendDm('1234567890', {
      content: 'Upgrade completed!',
    });

    expect(result).toBe(true);
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('[Discord DM DRY_RUN] Would send DM to user'),
      expect.stringContaining('Upgrade completed!')
    );
  });
});
