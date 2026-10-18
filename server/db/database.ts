/* KawaCity, a modified version of micropolisJS.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

import { chmodSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync, SQLInputValue, SQLOutputValue, StatementSync } from 'node:sqlite';

// The database: SQLite through node:sqlite, synchronous. Statements are prepared once and kept. Everything that must
// happen together goes in transaction(), which must not await: nothing else can run in the middle.

export type SqlValue = SQLInputValue;
export type Row = Record<string, SQLOutputValue>;

export interface RunResult {
  changes: number;
  lastInsertRowid: number;
}

// Set on every connection: foreign keys checked (and cascaded), write-ahead log, wait up to 5 s for a lock (an admin
// command running next to the server)
const PRAGMAS = 'PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; ' +
                'PRAGMA synchronous = NORMAL;';

export class Database {
  readonly file: string;
  private readonly connection: DatabaseSync;
  private readonly statements = new Map<string, StatementSync>();
  private depth = 0;
  private open = true;

  // ':memory:' for a database that lives in memory (tests)
  constructor(file: string) {
    this.file = file;
    this.connection = new DatabaseSync(file, {enableForeignKeyConstraints: true});
    this.connection.exec(PRAGMAS);
  }

  get isOpen(): boolean {
    return this.open;
  }

  get inTransaction(): boolean {
    return this.depth > 0;
  }

  exec(sql: string): void {
    this.connection.exec(sql);
  }

  private statement(sql: string): StatementSync {
    let statement = this.statements.get(sql);
    if (!statement) {
      statement = this.connection.prepare(sql);
      this.statements.set(sql, statement);
    }
    return statement;
  }

  // The first row, typed as the caller says (the columns the SQL selects)
  get<T extends object = Row>(sql: string, ...params: SqlValue[]): T | undefined {
    return this.statement(sql).get(...params) as T | undefined;
  }

  all<T extends object = Row>(sql: string, ...params: SqlValue[]): T[] {
    return this.statement(sql).all(...params) as T[];
  }

  run(sql: string, ...params: SqlValue[]): RunResult {
    const result = this.statement(sql).run(...params);
    return {changes: Number(result.changes), lastInsertRowid: Number(result.lastInsertRowid)};
  }

  // Runs fn in a transaction (a savepoint when nested): committed if it returns, rolled back if it throws
  transaction<T>(fn: () => T): T {
    const savepoint = this.depth > 0 ? `nested_${this.depth}` : null;
    this.exec(savepoint ? `SAVEPOINT ${savepoint}` : 'BEGIN IMMEDIATE');
    this.depth++;

    let result: T;
    try {
      result = fn();
      if (result instanceof Promise)
        throw new Error('a transaction must be synchronous: await nothing inside it');
    } catch (e) {
      this.depth--;
      this.rollback(savepoint);
      throw e;
    }

    this.depth--;
    try {
      this.exec(savepoint ? `RELEASE ${savepoint}` : 'COMMIT');
    } catch (e) {
      this.rollback(savepoint);
      throw e;
    }
    return result;
  }

  private rollback(savepoint: string | null): void {
    try {
      this.exec(savepoint ? `ROLLBACK TO ${savepoint}; RELEASE ${savepoint}` : 'ROLLBACK');
    } catch (e) {
      // Already rolled back by SQLite itself
    }
  }

  // The schema version (PRAGMA user_version): how many migrations were applied
  schemaVersion(): number {
    return Number(this.get<{user_version: number}>('PRAGMA user_version')?.user_version ?? 0);
  }

  isEmpty(): boolean {
    return this.get<{n: number}>("SELECT count(*) AS n FROM sqlite_schema WHERE type = 'table'")?.n === 0;
  }

  // A consistent copy of the database, even while the server writes to it, readable by its owner only. The file must
  // not exist yet.
  backupTo(file: string): void {
    mkdirSync(path.dirname(file), {recursive: true});
    this.connection.prepare('VACUUM INTO ?').run(file);
    chmodSync(file, 0o600);
  }

  close(): void {
    if (!this.open)
      return;

    this.open = false;
    this.statements.clear();
    this.connection.close();
  }
}

export interface MigrationResult {
  from: number;
  to: number;
  // The copy made before migrating a database that was not empty
  backup: string | null;
}

export interface MigrateOptions {
  // Where the copy taken before migrating goes (DATA_DIR/backups)
  backupDirectory: string;
  now: number;
}

// A UTC time for file names: 20261018T120000Z
export function fileTimestamp(time: number): string {
  return new Date(time).toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
}

// Brings the database to the last version of `migrations` (the SQL of version n is migrations[n - 1]), each version
// in its own transaction. A database that holds anything is first copied to before-v<from>-to-v<to>.db.
export function migrate(db: Database, migrations: readonly string[], options: MigrateOptions): MigrationResult {
  const from = db.schemaVersion();
  const to = migrations.length;
  if (from > to)
    throw new Error(`the database is at schema version ${from}, newer than this version of KawaCity knows (${to}): ` +
                    'run a newer version, or restore a backup');
  if (from === to)
    return {from, to, backup: null};

  let backup: string | null = null;
  if (!db.isEmpty() && db.file !== ':memory:') {
    const name = `before-v${from}-to-v${to}`;
    backup = path.join(options.backupDirectory, name + '.db');
    if (existsSync(backup))
      backup = path.join(options.backupDirectory, `${name}-${fileTimestamp(options.now)}.db`);
    db.backupTo(backup);
  }

  for (let version = from + 1; version <= to; version++) {
    db.transaction(() => {
      db.exec(migrations[version - 1]);
      db.exec(`PRAGMA user_version = ${version}`);
    });
  }

  return {from, to, backup};
}
