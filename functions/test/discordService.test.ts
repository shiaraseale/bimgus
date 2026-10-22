import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import { DiscordService } from '../src/services/discordService';

describe('DiscordService DRY_RUN_DISCORD', () => {
  const originalEnv = process.env.DRY_RUN_DISCORD;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.DRY_RUN_DISCORD;
    } else {
      process.env.DRY_RUN_DISCORD = originalEnv;
    }
  });

  it('logs, redacts token, and skips network requests when DRY_RUN_DISCORD=1 on webhooks', async () => {
    process.env.DRY_RUN_DISCORD = '1';
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const axiosPostSpy = vi.spyOn(axios, 'post');

    const result = await DiscordService.sendWebhook(
      'https://discord.com/api/webhooks/123456789/secret-webhook-token',
      { content: 'Test notification' }
    );

    expect(result).toBe(true);
    expect(axiosPostSpy).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('[DiscordService DRY_RUN] Would send webhook to target "https://discord.com/api/webhooks/123456789/[REDACTED]"'),
      expect.stringContaining('Test notification')
    );
    // Ensure the secret token was not logged
    const loggedMessage = logSpy.mock.calls[0]?.[0] || '';
    expect(loggedMessage).not.toContain('secret-webhook-token');

    // Test discordapp.com and /api/v10/ URLs
    await DiscordService.sendWebhook(
      'https://discordapp.com/api/v10/webhooks/987654321/another-secret-token',
      { content: 'Versioned notification' }
    );
    const versionedLog = logSpy.mock.calls[1]?.[0] || '';
    expect(versionedLog).toContain('https://discordapp.com/api/v10/webhooks/987654321/[REDACTED]');
    expect(versionedLog).not.toContain('another-secret-token');
  });

  it('logs and skips network requests when DRY_RUN_DISCORD=1 on DMs', async () => {
    process.env.DRY_RUN_DISCORD = '1';
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const axiosPostSpy = vi.spyOn(axios, 'post');

    const result = await DiscordService.sendDm('1234567890', {
      content: 'Upgrade completed!',
    });

    expect(result).toBe(true);
    expect(axiosPostSpy).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('[Discord DM DRY_RUN] Would send DM to user "1234567890"'),
      expect.stringContaining('Upgrade completed!')
    );
  });
});
