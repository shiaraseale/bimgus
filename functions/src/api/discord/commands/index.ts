import * as help from './help';
import * as link from './link';
import * as unlink from './unlink';
import * as accounts from './accounts';
import * as dms from './dms';
import * as sixthBuilder from './sixthBuilder';
import * as heroes from './heroes';
import * as status from './status';
import * as defenses from './defenses';
import * as spells from './spells';
import * as troops from './troops';
import * as roast from './roast';
import * as importVillage from './importVillage';

/** Every slash command: its Discord definition, whether it runs as a task, and its handler. */
export const COMMANDS = [
  help,
  link,
  unlink,
  accounts,
  dms,
  sixthBuilder,
  heroes,
  status,
  defenses,
  spells,
  troops,
  roast,
  importVillage,
];

// Old names still answered, for Discord clients that haven't picked up the re-registered list yet
const RENAMED: Record<string, (typeof COMMANDS)[number]> = { upgrades: status };

export const COMMANDS_BY_NAME = new Map([
  ...COMMANDS.map((c) => [c.definition.name, c] as const),
  ...Object.entries(RENAMED),
]);
