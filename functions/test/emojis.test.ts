import { describe, it, expect, vi, afterEach } from 'vitest';

// EMOJIS is built when the module loads, so each test sets the env and loads it fresh
async function loadEmojis(env: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value as string);
  vi.resetModules();
  return (await import('../src/constants/emojis')).EMOJIS;
}

describe('EMOJIS', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('uses the application emoji when its ID is set', async () => {
    const EMOJIS = await loadEmojis({ EMOJI_CROWN_ID: '1234567890123456789' });
    expect(EMOJIS.CROWN).toBe('<:crown:1234567890123456789>');
  });

  it('falls back to a Unicode emoji when the ID is empty or not a number', async () => {
    const EMOJIS = await loadEmojis({ EMOJI_STAR_ID: '', EMOJI_RAID_ID: 'your_emoji_id' });
    expect(EMOJIS.STAR).toBe('⭐');
    expect(EMOJIS.RAID).toBe('⚔️');
  });
});
