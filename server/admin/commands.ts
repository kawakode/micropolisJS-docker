/* KawaCity, a modified version of micropolisJS.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Clock } from '../clock';
import type { Config } from '../config';
import { Database, fileTimestamp } from '../db/database';

// Admin commands, run from the server's bundle instead of starting the server, for instance:
//   docker compose exec kawacity node server/main.cjs backup
// They work next to a running server (SQLite takes care of the locking), and never open a port.
//
// A command is registered under the words that name it ('backup', 'user add'); the words that follow are its
// arguments. It writes its results with out() and its problems with err(), and returns the process's exit code.

export interface AdminContext {
  readonly config: Config;
  readonly clock: Clock;
  // DATA_DIR/kawacity.db
  readonly databaseFile: string;
  // The database, opened on first use, and brought to the current schema unless migrate is false
  openDatabase(migrate?: boolean): Database;
  out(line: string): void;
  err(line: string): void;
}

export interface AdminCommand {
  name: string;
  // Its arguments, as the help shows them: '<username> <email>', '[file]'
  usage: string;
  description: string;
  run(args: readonly string[], context: AdminContext): number | Promise<number>;
}

// Exit codes
export const OK = 0;
export const FAILED = 1;
export const BAD_USAGE = 2;

const commands = new Map<string, AdminCommand>();

export function registerCommand(command: AdminCommand): void {
  if (commands.has(command.name))
    throw new Error(`admin command registered twice: ${command.name}`);
  commands.set(command.name, command);
}

// The command named by the first words of argv (the longest name wins), and its arguments
export function findCommand(argv: readonly string[]): {command: AdminCommand; args: readonly string[]} | null {
  for (let words = Math.min(argv.length, 3); words > 0; words--) {
    const command = commands.get(argv.slice(0, words).join(' '));
    if (command)
      return {command, args: argv.slice(words)};
  }
  return null;
}

export function helpText(): string[] {
  const list = [...commands.values()].sort((a, b) => a.name.localeCompare(b.name));
  const width = Math.max(...list.map(c => (c.name + ' ' + c.usage).trim().length));
  return [
    'Usage: node server/main.cjs [command]',
    'Without a command, starts the server. The commands, which read the same environment variables:',
    ...list.map(c => '  ' + (c.name + ' ' + c.usage).trim().padEnd(width) + '  ' + c.description),
  ];
}

export async function runAdminCommand(argv: readonly string[], context: AdminContext): Promise<number> {
  const found = findCommand(argv);
  if (!found) {
    context.err(`Unknown command: ${argv.join(' ')}`);
    helpText().forEach(line => context.err(line));
    return BAD_USAGE;
  }

  try {
    return await found.command.run(found.args, context);
  } catch (error) {
    context.err(`${found.command.name}: ${error instanceof Error ? error.message : String(error)}`);
    return FAILED;
  }
}

// The commands

registerCommand({
  name: 'help',
  usage: '',
  description: 'shows this help',
  run(_args, context) {
    helpText().forEach(line => context.out(line));
    return OK;
  },
});

registerCommand({
  name: 'backup',
  usage: '[file]',
  description: 'copies the database (safe while the server runs) to DATA_DIR/backups/kawacity-<UTC time>.db, ' +
               'or to the file given (a relative name is taken in DATA_DIR/backups)',
  run(args, context) {
    if (args.length > 1) {
      context.err('Usage: backup [file]');
      return BAD_USAGE;
    }

    if (!existsSync(context.databaseFile)) {
      context.err(`There is no database at ${context.databaseFile}: nothing to back up`);
      return FAILED;
    }

    const directory = path.join(context.config.dataDir, 'backups');
    const file = args.length === 1 ? path.resolve(directory, args[0]) :
      path.join(directory, `kawacity-${fileTimestamp(context.clock.now())}.db`);
    if (existsSync(file)) {
      context.err(`${file} already exists: choose another name`);
      return FAILED;
    }

    context.openDatabase(false).backupTo(file);
    context.out(`Backed up to ${file}`);
    return OK;
  },
});
