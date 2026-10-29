import { config } from '../config';

/**
 * Custom application emojis for Bimgus Discord Bot, for authentic Clash of Clans aesthetics.
 * Each ID comes from EMOJI_<KEY>_ID in functions/.env, because the emojis belong to one bot's
 * application; an empty one falls back to a Unicode emoji, so a fresh copy works without them.
 */
function emoji(key: string, name: string, fallback: string): string {
  const id = config.discord.emojiId(key);
  return /^\d+$/.test(id) ? `<:${name}:${id}>` : fallback;
}

export const EMOJIS = {
  CROWN: emoji('CROWN', 'crown', '👑'),
  ANVIL: emoji('ANVIL', 'anvil', '⚒️'),
  STAR: emoji('STAR', 'star', '⭐'),
  GOLD: emoji('GOLD', 'gold', '🟡'),
  ELIXIR: emoji('ELIXIR', 'elixir', '🟣'),
  DARK_ELIXIR: emoji('DARK_ELIXIR', 'dark_elixir', '⚫'),
  BUILDER_GOLD: emoji('BUILDER_GOLD', 'builder_gold', '🟨'),
  BUILDER_ELIXIR: emoji('BUILDER_ELIXIR', 'builder_elixir', '🟪'),
  SHINY_ORE: emoji('SHINY_ORE', 'shiny_ore', '🔹'),
  GLOWY_ORE: emoji('GLOWY_ORE', 'glowy_ore', '🔮'),
  STARRY_ORE: emoji('STARRY_ORE', 'starry_ore', '🌟'),
  CAPITAL_GOLD: emoji('CAPITAL_GOLD', 'capital_gold', '🪙'),
  RAID: emoji('RAID', 'raid', '⚔️'),
} as const;
