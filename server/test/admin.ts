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
import { Users } from '../auth/users';
import type { Env } from '../config';
import { sha256Hex } from '../security/tokens';
import { cleanUp, startTestApp, temporaryDirectory, testConfig } from '../testing';

afterAll(cleanUp);

const adminContext = (dataDir: string, env: Env = {}) => {
  const out: string[] = [];
  const err: string[] = [];
  const opened: Database[] = [];
  const context: AdminContext = {
    config: testConfig({DATA_DIR: dataDir, ...env}),
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

describe('Account commands', () => {
  const linkToken = (line: string) => {
    const match = /^http:\/\/localhost:8080\/#\/reset\/([A-Za-z0-9_-]{43})$/.exec(line);
    expect(match).not.toBeNull();
    return (match as RegExpExecArray)[1];
  };

  test('user add makes an account without a password, and prints a link to choose one', async () => {
    const {context, out, err, close} = adminContext(temporaryDirectory());
    expect(await runAdminCommand(['user', 'add', 'Alice', 'Alice@Example.com'], context)).toBe(0);
    expect(out[0]).toBe('Made the account Alice <Alice@example.com>. To choose its password, its owner opens ' +
                        'within 24 h:');
    const token = linkToken(out[1]);
    const db = context.openDatabase();
    const alice = new Users(db).byUsernameKey('alice');
    expect(alice).toMatchObject({email: 'Alice@example.com', email_key: 'alice@example.com', locale: 'en',
                                 password_hash: '!', last_login_at: null});
    expect(db.get('SELECT user_id, purpose, expires_at - created_at AS life FROM email_tokens WHERE token_hash = ?',
                  sha256Hex(token))).toEqual({user_id: alice?.id, purpose: 'reset', life: 24 * 60 * 60 * 1000});

    expect(await runAdminCommand(['user', 'add', 'Bruno', 'bruno@example.com', 'fr'], context)).toBe(0);
    expect(new Users(db).byUsernameKey('bruno')?.locale).toBe('fr');

    // Refused: taken, invalid, wrong usage
    expect(await runAdminCommand(['user', 'add', 'ALICE', 'other@example.com'], context)).toBe(1);
    expect(err.pop()).toBe('The username ALICE is taken');
    expect(await runAdminCommand(['user', 'add', 'Alicia', 'alice@EXAMPLE.com'], context)).toBe(1);
    expect(err.pop()).toBe('The address alice@example.com already has an account');
    expect(await runAdminCommand(['user', 'add', 'admin', 'x@example.com'], context)).toBe(1);
    expect(err.pop()).toMatch(/^The username "admin" cannot be used \(reserved\)/);
    expect(await runAdminCommand(['user', 'add', 'Carol', 'x<v@e.com>'], context)).toBe(1);
    expect(await runAdminCommand(['user', 'add', 'Carol', 'carol@example.com', 'de'], context)).toBe(1);
    expect(await runAdminCommand(['user', 'add', 'Carol'], context)).toBe(2);
    close();
  });

  test('The link of user add sets the password on the server', async () => {
    const dataDir = temporaryDirectory();
    const {context, out, close} = adminContext(dataDir);
    await runAdminCommand(['user', 'add', 'Alice', 'alice@example.com'], context);
    const token = linkToken(out[1]);

    // The server sees the same database (here, a copy of it)
    const db = context.openDatabase();
    const t = await startTestApp({}, {db});
    expect((await t.request('/api/session')).json.features).toMatchObject({accounts: true, registration: false});
    const reset = await t.post('/api/auth/reset-password', {token, password: 'correct horse battery staple'});
    expect(reset.status).toBe(200);
    expect(new Users(db).byUsernameKey('alice')?.password_hash).toMatch(/^scrypt\$/);
    await t.close();
    close();
  });

  test('user reset prints a link for an hour, by username or address', async () => {
    const {context, out, err, close} = adminContext(temporaryDirectory());
    await runAdminCommand(['user', 'add', 'Alice', 'alice@example.com'], context);
    for (const name of ['alice', 'ALICE@example.com']) {
      out.length = 0;
      expect(await runAdminCommand(['user', 'reset', name], context)).toBe(0);
      expect(out[0]).toBe('To choose a new password for Alice <alice@example.com>, open within 1 h:');
      const token = linkToken(out[1]);
      expect(context.openDatabase().get('SELECT expires_at - created_at AS life FROM email_tokens WHERE token_hash = ?',
                                        sha256Hex(token))).toEqual({life: 60 * 60 * 1000});
    }
    expect(await runAdminCommand(['user', 'reset', 'nobody'], context)).toBe(1);
    expect(err.pop()).toBe('There is no account "nobody"');
    expect(await runAdminCommand(['user', 'reset'], context)).toBe(2);
    close();
  });

  test('user list and user delete', async () => {
    const {context, out, err, close} = adminContext(temporaryDirectory());
    expect(await runAdminCommand(['user', 'list'], context)).toBe(0);
    expect(out.pop()).toBe('No accounts');

    await runAdminCommand(['user', 'add', 'Bob', 'bob@example.com'], context);
    await runAdminCommand(['user', 'add', 'alice', 'alice@example.com', 'fr'], context);
    out.length = 0;
    expect(await runAdminCommand(['user', 'list'], context)).toBe(0);
    expect(out).toEqual([
      'USERNAME  EMAIL              LOCALE  CREATED            LAST LOGIN  NOTE',
      'alice     alice@example.com  fr      2026-10-18T12:00Z  -           no password yet',
      'Bob       bob@example.com    en      2026-10-18T12:00Z  -           no password yet',
      '2 accounts',
    ]);

    out.length = 0;
    expect(await runAdminCommand(['user', 'delete', 'BOB'], context)).toBe(0);
    expect(out).toEqual(['Deleted the account Bob <bob@example.com>']);
    expect(new Users(context.openDatabase()).list().map(user => user.username)).toEqual(['alice']);
    expect(context.openDatabase().get('SELECT count(*) AS n FROM email_tokens')).toEqual({n: 1});
    expect(await runAdminCommand(['user', 'delete', 'bob'], context)).toBe(1);
    expect(err.pop()).toBe('There is no account with the username "bob"');
    expect(await runAdminCommand(['user', 'delete', 'alice@example.com'], context)).toBe(1);
    close();
  });

  test('mail-test sends with the server\'s settings', async () => {
    const none = adminContext(temporaryDirectory());
    expect(await runAdminCommand(['mail-test', 'you@example.com'], none.context)).toBe(1);
    expect(none.err[0]).toMatch(/^No mail can be sent: set SMTP_HOST/);

    const log = adminContext(temporaryDirectory(), {MAIL_TRANSPORT: 'log'});
    expect(await runAdminCommand(['mail-test', 'You@Example.com'], log.context)).toBe(0);
    expect(log.out[0]).toBe('MAIL_TRANSPORT=log: the mail is printed instead of sent. To: You@example.com');
    expect(log.out[1]).toBe('Subject: KawaCity mail test');
    expect(log.out[2]).toContain('http://localhost:8080');
    expect(log.out.pop()).toBe('Sent a test mail to You@example.com');
    expect(await runAdminCommand(['mail-test', 'not an address'], log.context)).toBe(1);
    expect(await runAdminCommand(['mail-test'], log.context)).toBe(2);

    // An SMTP server that cannot be reached: the error is reported
    const smtp = adminContext(temporaryDirectory(), {SMTP_HOST: '127.0.0.1', SMTP_PORT: '9',
                                                     MAIL_FROM: 'k@example.com'});
    expect(await runAdminCommand(['mail-test', 'you@example.com'], smtp.context)).toBe(1);
    expect(smtp.err[0]).toMatch(/^The mail could not be sent: /);
  });

  test('The help lists them', () => {
    const help = helpText().join('\n');
    for (const name of ['user add <username> <email> [locale]', 'user reset <username|email>', 'user delete <username>',
                        'user list', 'mail-test <address>'])
      expect(help).toContain(name);
  });
});
