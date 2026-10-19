/* KawaCity, a modified version of micropolisJS.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { Database, fileTimestamp, migrate } from '../db/database';
import { MIGRATIONS } from '../db/migrations';
import { purgeExpired } from '../db/purge';
import { newPublicId } from '../security/tokens';
import { cleanUp, temporaryDirectory, testDatabase } from '../testing';

afterAll(cleanUp);

const addUser = (db: Database, name: string) => db.run(
  `INSERT INTO users (public_id, username, username_key, username_skeleton, email, email_key, password_hash, locale,
                      created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'x', 'en', 0, 0)`,
  newPublicId(), name, name.toLowerCase(), name.toLowerCase(), `${name}@example.com`,
  `${name.toLowerCase()}@example.com`).lastInsertRowid;

describe('Database', () => {
  test('Every connection checks foreign keys and uses the write-ahead log', () => {
    const file = path.join(temporaryDirectory(), 'kawacity.db');
    const db = new Database(file);
    expect(db.get<{foreign_keys: number}>('PRAGMA foreign_keys')?.foreign_keys).toBe(1);
    expect(db.get<{journal_mode: string}>('PRAGMA journal_mode')?.journal_mode).toBe('wal');
    expect(db.get<{timeout: number}>('PRAGMA busy_timeout')?.timeout).toBe(5000);
    expect(db.get<{synchronous: number}>('PRAGMA synchronous')?.synchronous).toBe(1);
    expect(db.get<{secure_delete: number}>('PRAGMA secure_delete')?.secure_delete).toBe(1);
    db.close();
    expect(db.isOpen).toBe(false);
  });

  test('What is deleted cannot be read back from the file', () => {
    const file = path.join(temporaryDirectory(), 'kawacity.db');
    const db = new Database(file);
    migrate(db, MIGRATIONS, {backupDirectory: '/nonexistent', now: 0});
    addUser(db, 'Stays');
    const gone = addUser(db, 'GonePlayer');
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    db.run('DELETE FROM users WHERE id = ?', gone);
    db.close();

    const bytes = readFileSync(file).toString('latin1');
    expect(bytes).toContain('stays@example.com');
    for (const text of ['GonePlayer', 'goneplayer', 'GonePlayer@example.com', 'goneplayer@example.com'])
      expect(bytes).not.toContain(text);
  });

  test('Migrations create the schema once', () => {
    const db = new Database(':memory:');
    expect(db.isEmpty()).toBe(true);
    expect(migrate(db, MIGRATIONS, {backupDirectory: '/nonexistent', now: 0})).toEqual(
      {from: 0, to: MIGRATIONS.length, backup: null});
    expect(db.schemaVersion()).toBe(MIGRATIONS.length);
    expect(migrate(db, MIGRATIONS, {backupDirectory: '/nonexistent', now: 0})).toEqual(
      {from: MIGRATIONS.length, to: MIGRATIONS.length, backup: null});

    const tables = db.all<{name: string}>("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE " +
                                          "'sqlite_%' ORDER BY name").map(row => row.name);
    expect(tables).toEqual(['captcha_used', 'cities', 'city_invitations', 'city_members', 'email_tokens',
                            'region_invitations', 'region_members', 'regions', 'sessions', 'settings', 'signup_tokens',
                            'users']);
    db.close();
  });

  test('A database of version 1 (the accounts) gains the shared cities, its accounts kept', () => {
    const db = new Database(':memory:');
    migrate(db, MIGRATIONS.slice(0, 1), {backupDirectory: '/nonexistent', now: 0});
    const alice = addUser(db, 'Alice');
    expect(migrate(db, MIGRATIONS, {backupDirectory: '/nonexistent', now: 0}))
      .toEqual({from: 1, to: MIGRATIONS.length, backup: null});
    expect(db.get<{n: number}>('SELECT count(*) AS n FROM users')?.n).toBe(1);

    // A city goes with its owner, its members and invitations with it; a region's cities stay
    const region = db.run(`INSERT INTO regions (public_id, owner_id, name, width, height, created_at, updated_at)
                           VALUES (?, ?, 'R', 2, 2, 0, 0)`, newPublicId(), alice).lastInsertRowid;
    const bob = addUser(db, 'Bob');
    const city = (owner: number, x: number) => db.run(
      `INSERT INTO cities (public_id, owner_id, name, state, region_id, region_x, region_y, created_at, updated_at)
       VALUES (?, ?, 'C', x'01', ?, ?, 0, 0, 0)`, newPublicId(), owner, region, x).lastInsertRowid;
    const own = city(alice, 0);
    const other = city(bob, 1);
    expect(() => city(bob, 1)).toThrow(/UNIQUE/);
    expect(() => db.run(`INSERT INTO regions (public_id, owner_id, name, width, height, created_at, updated_at)
                         VALUES (?, ?, 'R', 5, 2, 0, 0)`, newPublicId(), alice)).toThrow(/CHECK/);
    db.run(`INSERT INTO city_members (city_id, user_id, role, joined_at) VALUES (?, ?, 'viewer', 0)`, own, bob);
    expect(() => db.run(`INSERT INTO city_invitations (public_id, city_id, inviter_id, invitee_id, role, created_at)
                         VALUES (?, ?, ?, ?, 'owner', 0)`, newPublicId(), own, alice, bob)).toThrow(/CHECK/);
    db.run('DELETE FROM users WHERE id = ?', alice);
    expect(db.get<{n: number}>('SELECT count(*) AS n FROM city_members')?.n).toBe(0);
    expect(db.all<{id: number; region_id: number | null}>('SELECT id, region_id FROM cities'))
      .toEqual([{id: other, region_id: null}]);
    db.close();
  });

  test('A database newer than the code is refused', () => {
    const db = testDatabase();
    db.exec('PRAGMA user_version = 99');
    expect(() => migrate(db, MIGRATIONS, {backupDirectory: '/nonexistent', now: 0})).toThrow(/schema version 99/);
    db.close();
  });

  test('A database that holds data is copied before it is migrated', () => {
    const directory = temporaryDirectory();
    const db = new Database(path.join(directory, 'kawacity.db'));
    migrate(db, MIGRATIONS, {backupDirectory: path.join(directory, 'backups'), now: 0});
    addUser(db, 'Alice');

    const next = [...MIGRATIONS, 'CREATE TABLE extra (id INTEGER PRIMARY KEY AUTOINCREMENT)'];
    const result = migrate(db, next, {backupDirectory: path.join(directory, 'backups'), now: Date.UTC(2026, 9, 18)});
    const from = MIGRATIONS.length;
    const to = from + 1;
    expect(result.backup).toBe(path.join(directory, 'backups', `before-v${from}-to-v${to}.db`));
    expect(statSync(result.backup!).mode & 0o777).toBe(0o600);

    const copy = new Database(result.backup!);
    expect(copy.schemaVersion()).toBe(from);
    expect(copy.get<{n: number}>('SELECT count(*) AS n FROM users')?.n).toBe(1);
    copy.close();

    // The same migration again (after a restore) does not overwrite the first copy
    db.exec(`DROP TABLE extra; PRAGMA user_version = ${from}`);
    const again = migrate(db, next, {backupDirectory: path.join(directory, 'backups'), now: Date.UTC(2026, 9, 18)});
    expect(again.backup).toBe(path.join(directory, 'backups', `before-v${from}-to-v${to}-20261018T000000Z.db`));
    expect(readdirSync(path.join(directory, 'backups')).length).toBe(2);
    db.close();
  });

  test('A copy is readable by its owner only from the start, in a directory of its own', () => {
    const directory = temporaryDirectory();
    const db = new Database(path.join(directory, 'kawacity.db'));
    migrate(db, MIGRATIONS, {backupDirectory: path.join(directory, 'backups'), now: 0});
    addUser(db, 'Alice');

    // What the copy's file is when SQLite starts writing it: a usual umask would make a new file readable by all
    const connection = (db as unknown as {connection: DatabaseSync}).connection;
    const prepare = connection.prepare.bind(connection);
    let modeWhenWritten: number | null = null;
    connection.prepare = ((sql: string) => {
      const statement = prepare(sql);
      return !sql.startsWith('VACUUM INTO') ? statement : {
        run: (target: string) => {
          modeWhenWritten = existsSync(target) ? statSync(target).mode & 0o777 : null;
          return statement.run(target);
        },
      } as unknown as StatementSync;
    }) as typeof connection.prepare;

    const umask = process.umask(0o022);
    try {
      const file = path.join(directory, 'backups', 'copy.db');
      db.backupTo(file);
      expect(modeWhenWritten).toBe(0o600);
      expect(statSync(file).mode & 0o777).toBe(0o600);
      expect(statSync(path.dirname(file)).mode & 0o777).toBe(0o700);
      const copy = new Database(file);
      expect(copy.get<{n: number}>('SELECT count(*) AS n FROM users')?.n).toBe(1);
      copy.close();

      // Never over a file that is there
      expect(() => db.backupTo(file)).toThrow(/EEXIST/);
    } finally {
      process.umask(umask);
      db.close();
    }
  });

  test('An empty database is not copied', () => {
    const directory = temporaryDirectory();
    const db = new Database(path.join(directory, 'kawacity.db'));
    expect(migrate(db, MIGRATIONS, {backupDirectory: path.join(directory, 'backups'), now: 0}).backup).toBeNull();
    expect(existsSync(path.join(directory, 'backups'))).toBe(false);
    db.close();
  });

  test('Foreign keys are enforced and cascade', () => {
    const db = testDatabase();
    expect(() => db.run('INSERT INTO sessions VALUES (?, ?, 0, 0, 1)', 'hash', 999)).toThrow(/FOREIGN KEY/);

    const user = addUser(db, 'Bob');
    db.run('INSERT INTO sessions VALUES (?, ?, 0, 0, 1)', 'hash', user);
    db.run('DELETE FROM users WHERE id = ?', user);
    expect(db.get<{n: number}>('SELECT count(*) AS n FROM sessions')?.n).toBe(0);
    db.close();
  });

  test('Ids are never reused', () => {
    const db = testDatabase();
    const first = addUser(db, 'Carol');
    const second = addUser(db, 'Dave');
    db.run('DELETE FROM users WHERE id = ?', second);
    expect(addUser(db, 'Erin')).toBe(second + 1);
    expect(first).toBe(1);
    db.close();
  });

  test('Transactions commit, roll back on errors, nest, and must be synchronous', () => {
    const db = testDatabase();
    db.transaction(() => {
      addUser(db, 'Frank');
      expect(db.inTransaction).toBe(true);
    });
    expect(db.inTransaction).toBe(false);

    expect(() => db.transaction(() => {
      addUser(db, 'Grace');
      throw new Error('stop');
    })).toThrow('stop');

    db.transaction(() => {
      addUser(db, 'Heidi');
      expect(() => db.transaction(() => {
        addUser(db, 'Ivan');
        throw new Error('inner');
      })).toThrow('inner');
    });

    expect(() => db.transaction(() => Promise.resolve(addUser(db, 'Judy')))).toThrow(/synchronous/);

    const names = db.all<{username: string}>('SELECT username FROM users ORDER BY id').map(row => row.username);
    expect(names).toEqual(['Frank', 'Heidi']);
    db.close();
  });

  test('Expired rows are purged', () => {
    const db = testDatabase();
    const user = addUser(db, 'Kim');
    const day = 24 * 60 * 60 * 1000;
    const now = 100 * day;
    db.run('INSERT INTO sessions VALUES (?, ?, 0, ?, ?)', 'live', user, now - day, now + day);
    db.run('INSERT INTO sessions VALUES (?, ?, 0, ?, ?)', 'idle', user, now - 8 * day, now + day);
    db.run('INSERT INTO sessions VALUES (?, ?, 0, ?, ?)', 'ended', user, now, now);
    db.run('INSERT INTO signup_tokens VALUES (?, ?, ?, ?, 0, ?)', 'a', 'e@x.com', 'e@x.com', 'en', now - 1);
    db.run('INSERT INTO signup_tokens VALUES (?, ?, ?, ?, 0, ?)', 'b', 'e@x.com', 'e@x.com', 'en', now + 1);
    db.run("INSERT INTO email_tokens VALUES (?, ?, 'reset', NULL, NULL, 0, ?)", 'c', user, now - 1);
    db.run('INSERT INTO captcha_used VALUES (?, ?)', 'salt1', now - 1);
    db.run('INSERT INTO captcha_used VALUES (?, ?)', 'salt2', now + 1);

    expect(purgeExpired(db, now, 7 * day)).toEqual({sessions: 2, signupTokens: 1, emailTokens: 1, captchas: 1});
    expect(db.all<{token_hash: string}>('SELECT token_hash FROM sessions').map(row => row.token_hash)).toEqual(['live']);
    db.close();
  });

  test('File timestamps', () => {
    expect(fileTimestamp(Date.UTC(2026, 9, 18, 12, 34, 56, 789))).toBe('20261018T123456Z');
  });
});
