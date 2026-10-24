import axios from 'axios';
import { config } from '../config';

export const BOT_COMMANDS = [
  {
    name: 'help',
    description: 'Show a list of all available Bimgus commands and how to use them',
    contexts: [0, 1],
    integration_types: [0],
  },
  {
    name: 'link',
    description: 'Link your Clash of Clans player account to your Discord profile',
    contexts: [0, 1],
    integration_types: [0],
    options: [
      {
        name: 'tag',
        description: 'Your Clash of Clans player tag (e.g. #ABC123)',
        type: 3, // STRING
        required: true,
      },
      {
        name: 'dms',
        description: 'Receive private DMs when war rosters lock in (default: true)',
        type: 5, // BOOLEAN
        required: false,
      },
    ],
  },
  {
    name: 'unlink',
    description: 'Unlink a Clash of Clans account from your Discord profile and stop tracking',
    contexts: [0, 1],
    integration_types: [0],
    options: [
      {
        name: 'tag',
        description: 'Specific player tag to unlink (leave blank to unlink active account)',
        type: 3, // STRING
        required: false,
      },
    ],
  },
  {
    name: 'accounts',
    description: 'View and manage your linked Clash of Clans accounts (multi-account support)',
    contexts: [0, 1],
    integration_types: [0],
  },
  {
    name: 'sixth-builder',
    description: 'Check how close you are to unlocking the 6th Builder (B.O.B)',
    contexts: [0, 1],
    integration_types: [0],
    options: [
      {
        name: 'account',
        description: 'Specific player tag to check (leave blank for active account)',
        type: 3, // STRING
        required: false,
      },
    ],
  },
  {
    name: 'heroes',
    description: 'Check hero maxing progress for your current Town Hall or Builder Hall',
    contexts: [0, 1],
    integration_types: [0],
    options: [
      {
        name: 'account',
        description: 'Specific player tag to check (leave blank for active account)',
        type: 3, // STRING
        required: false,
      },
      {
        name: 'village',
        description: 'Which village to inspect (home, builder, or both)',
        type: 3, // STRING
        required: false,
        choices: [
          { name: 'Both Villages', value: 'both' },
          { name: 'Home Village', value: 'home' },
          { name: 'Builder Base', value: 'builder' },
        ],
      },
    ],
  },
  {
    name: 'upgrades',
    description: 'Show live progression and all outstanding upgrades read directly from Clash of Clans',
    contexts: [0, 1],
    integration_types: [0],
    options: [
      {
        name: 'account',
        description: 'Specific player tag to check (leave blank for all linked accounts)',
        type: 3, // STRING
        required: false,
      },
    ],
  },
  {
    name: 'defenses',
    description: 'Check defense max caps, gear-ups, and Hall upgrade status for your Town Hall / Builder Hall',
    contexts: [0, 1],
    integration_types: [0],
    options: [
      {
        name: 'account',
        description: 'Specific player tag to check (leave blank for all linked accounts)',
        type: 3, // STRING
        required: false,
      },
    ],
  },
  {
    name: 'spells',
    description: 'Check spell laboratory upgrades remaining to max your current Town Hall',
    contexts: [0, 1],
    integration_types: [0],
    options: [
      {
        name: 'account',
        description: 'Specific player tag to check (leave blank for all linked accounts)',
        type: 3, // STRING
        required: false,
      },
    ],
  },
  {
    name: 'troops',
    description: 'Check troop research upgrades remaining to max your current Town Hall / Builder Hall',
    contexts: [0, 1],
    integration_types: [0],
    options: [
      {
        name: 'account',
        description: 'Specific player tag to check (leave blank for all linked accounts)',
        type: 3, // STRING
        required: false,
      },
      {
        name: 'village',
        description: 'Which village to inspect (home, builder, or both)',
        type: 3, // STRING
        required: false,
        choices: [
          { name: 'Both Villages', value: 'both' },
          { name: 'Home Village', value: 'home' },
          { name: 'Builder Base', value: 'builder' },
        ],
      },
    ],
  },
  {
    name: 'roast',
    description: 'Tag a server member and let Bimgus deliver a savage Clash of Clans roast',
    contexts: [0], // Guild channels
    integration_types: [0],
    options: [
      {
        name: 'user',
        description: 'The member to roast',
        type: 6, // USER
        required: true,
      },
    ],
  },
  {
    name: 'import-village',
    description: 'Import your village JSON export (one per account; it includes both villages)',
    contexts: [0, 1],
    integration_types: [0],
    options: [
      {
        name: 'file',
        description: 'Village JSON export (one file covers both villages of an account)',
        type: 11, // ATTACHMENT
        required: false,
      },
      {
        name: 'file2',
        description: 'Export for another account (optional)',
        type: 11, // ATTACHMENT
        required: false,
      },
      {
        name: 'file3',
        description: 'Export for another account (optional)',
        type: 11, // ATTACHMENT
        required: false,
      },
      {
        name: 'file4',
        description: 'Export for another account (optional)',
        type: 11, // ATTACHMENT
        required: false,
      },
      {
        name: 'file5',
        description: 'Export for another account (optional)',
        type: 11, // ATTACHMENT
        required: false,
      },
      {
        name: 'file6',
        description: 'Export for another account (optional)',
        type: 11, // ATTACHMENT
        required: false,
      },
      {
        name: 'json_text',
        description: 'Or paste village JSON export text directly',
        type: 3, // STRING
        required: false,
      },
      {
        name: 'account',
        description: 'Specific player tag to link this export to (optional, defaults to matched tag)',
        type: 3, // STRING
        required: false,
      },
    ],
  },
];

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

  console.log(`[RegisterCommands] Registering ${BOT_COMMANDS.length} global commands for DMs & Guilds...`);
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
    console.log(`[RegisterCommands] Registering ${BOT_COMMANDS.length} guild commands for server ${rawGuildId}...`);
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

  console.log(`[RegisterCommands] Successfully registered commands!`);
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
      console.log('Result:', res.message);
      process.exit(0);
    })
    .catch((err) => {
      console.error('Registration failed:', err.response?.data || err.message);
      process.exit(1);
    });
}
