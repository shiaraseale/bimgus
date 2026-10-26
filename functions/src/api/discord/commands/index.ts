import * as help from './help';
import * as link from './link';
import * as unlink from './unlink';
import * as accounts from './accounts';
import * as dms from './dms';
import * as sixthBuilder from './sixthBuilder';
import * as heroes from './heroes';
import * as upgrades from './upgrades';
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
  upgrades,
  defenses,
  spells,
  troops,
  roast,
  importVillage,
];

export const COMMANDS_BY_NAME = new Map(COMMANDS.map((c) => [c.definition.name, c]));
