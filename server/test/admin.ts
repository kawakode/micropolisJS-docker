/* KawaCity, a modified version of micropolisJS.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { AdminContext, findCommand, helpText, registerCommand, runAdminCommand } from '../admin/commands';
import { FakeClock } from '../clock';
import { Database, migrate } from '../db/database';
import { MIGRATIONS } from '../db/migrations';
import { cleanUp, temporaryDirectory, testConfig } from '../testing';

afterAll(cleanUp);

const adminContext = (dataDir: string) => {
  const out: string[] = [];
  const err: string[] = [];
  const opened: Database[] = [];
  const context: AdminContext = {
    config: testConfig({DATA_DIR: dataDir}),
    clock: new FakeClock(Date.UTC(2026, 9, 18, 12, 0, 0)),
    databaseFile: path.join(dataDir, 'kawacity.db'),
    openDatabase(upgrade = true) {
      if (opened.length === 0) {
        const db = new Database(path.join(dataDir, 'kawacity.db'));
        if (upgrade)
          migrate(db, MIGRATIONS, {backupDirectory: path.join(dataDir, 'backups'), now: 0});
        opened.push(db);
      }
      return opened[0];
    },
    out: line => { out.push(line); },
    err: line => { err.push(line); },
  };
  return {context, out, err, close: () => opened.forEach(db => db.close())};
};

describe('Admin commands', () => {
  test('Commands are found by their words, the longest name first', () => {
    registerCommand({name: 'test thing', usage: '<x>', description: 'a test', run: () => 0});
    expect(findCommand(['test', 'thing', 'a'])?.command.name).toBe('test thing');
    expect(findCommand(['test', 'thing', 'a'])?.args).toEqual(['a']);
    expect(findCommand(['backup'])?.command.name).toBe('backup');
    expect(findCommand(['nothing'])).toBeNull();
    expect(() => registerCommand({name: 'backup', usage: '', description: '', run: () => 0})).toThrow(/twice/);
    expect(helpText().some(line => /^ {2}backup \[file\] +copies the database/.test(line))).toBe(true);
  });

  test('An unknown command shows the help', async () => {
    const {context, err} = adminContext(temporaryDirectory());
    expect(await runAdminCommand(['frobnicate'], context)).toBe(2);
    expect(err[0]).toBe('Unknown command: frobnicate');
    expect(err.some(line => line.startsWith('Usage:'))).toBe(true);
  });

  test('A failing command reports its error', async () => {
    registerCommand({name: 'test fail', usage: '', description: '', run: () => { throw new Error('no way'); }});
    const {context, err} = adminContext(temporaryDirectory());
    expect(await runAdminCommand(['test', 'fail'], context)).toBe(1);
    expect(err).toEqual(['test fail: no way']);
  });

  test('backup copies the database into DATA_DIR/backups', async () => {
    const dataDir = temporaryDirectory();
    const {context, out, err, close} = adminContext(dataDir);

    expect(await runAdminCommand(['backup'], context)).toBe(1);
    expect(err[0]).toMatch(/^There is no database at/);

    const db = context.openDatabase();
    db.run("INSERT INTO settings VALUES ('k', 'v')");

    expect(await runAdminCommand(['backup'], context)).toBe(0);
    const file = path.join(dataDir, 'backups', 'kawacity-20261018T120000Z.db');
    expect(out).toEqual([`Backed up to ${file}`]);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const copy = new Database(file);
    expect(copy.get<{value: string}>("SELECT value FROM settings WHERE key = 'k'")?.value).toBe('v');
    copy.close();

    // Not twice to the same file
    expect(await runAdminCommand(['backup'], context)).toBe(1);

    expect(await runAdminCommand(['backup', 'before-upgrade.db'], context)).toBe(0);
    expect(existsSync(path.join(dataDir, 'backups', 'before-upgrade.db'))).toBe(true);

    const elsewhere = path.join(temporaryDirectory(), 'copy.db');
    expect(await runAdminCommand(['backup', elsewhere], context)).toBe(0);
    expect(existsSync(elsewhere)).toBe(true);

    expect(await runAdminCommand(['backup', 'a', 'b'], context)).toBe(2);
    close();
  });
});
