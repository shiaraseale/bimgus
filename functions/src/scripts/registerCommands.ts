import axios from 'axios';
import { config } from '../config';
import { COMMANDS } from '../api/discord/commands';
import { log } from '../utils/log';

// Built from the command modules, so a definition can't drift from its handler (4.2)
export const BOT_COMMANDS = COMMANDS.map((c) => c.definition);

/**
 * Registers Slash Commands with Discord's REST API.
 * If guildId is provided, registers as instant Guild Commands.
 * Otherwise, registers as Global Application Commands.
 */
export async function registerDiscordCommands(
  customBotToken?: string,
  customClientId?: string,
  customGuildId?: string
): Promise<{ success: boolean; message: string; commands: any[] }> {
  const botToken = customBotToken || config.discord.botToken;
  const clientId = customClientId || config.discord.clientId;
  const rawGuildId = customGuildId !== undefined ? customGuildId : config.discord.guildId;
  const isRealGuild = Boolean(rawGuildId && rawGuildId !== 'your_discord_server_id' && /^\d+$/.test(rawGuildId));

  if (!botToken) {
    throw new Error('DISCORD_BOT_TOKEN is missing. Provide it in .env or request body.');
  }
  if (!clientId) {
    throw new Error('DISCORD_CLIENT_ID is missing. Provide it in .env or request body.');
  }

  log.info(`[RegisterCommands] Registering ${BOT_COMMANDS.length} global commands for DMs & Guilds...`);
  const globalEndpoint = `https://discord.com/api/v10/applications/${clientId}/commands`;
  const globalRes = await axios.put(globalEndpoint, BOT_COMMANDS, {
    headers: {
      Authorization: `Bot ${botToken}`,
      'Content-Type': 'application/json',
    },
    timeout: 10000,
  });

  let guildResData: any[] = [];
  if (isRealGuild) {
    log.info(`[RegisterCommands] Registering ${BOT_COMMANDS.length} guild commands for server ${rawGuildId}...`);
    const guildEndpoint = `https://discord.com/api/v10/applications/${clientId}/guilds/${rawGuildId}/commands`;
    const guildRes = await axios.put(guildEndpoint, BOT_COMMANDS, {
      headers: {
        Authorization: `Bot ${botToken}`,
        'Content-Type': 'application/json',
      },
      timeout: 10000,
    });
    guildResData = guildRes.data;
  }

  log.info(`[RegisterCommands] Successfully registered commands!`);
  return {
    success: true,
    message: `Registered ${globalRes.data.length} global commands and ${guildResData.length} guild commands successfully!`,
    commands: globalRes.data,
  };
}

// Allow standalone execution via `ts-node` or `node`
if (require.main === module) {
  registerDiscordCommands()
    .then((res) => {
      log.info('Result:', res.message);
      process.exit(0);
    })
    .catch((err) => {
      log.error('Registration failed:', err.response?.data || err.message);
      process.exit(1);
    });
}
