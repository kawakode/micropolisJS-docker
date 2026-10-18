/* KawaCity, a modified version of micropolisJS.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

import { chmodSync, existsSync, mkdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import type { Server } from 'node:http';
import path from 'node:path';
import { AdminContext, helpText, runAdminCommand } from './admin/commands';
import { createApp } from './app';
import { Clock, systemClock } from './clock';
import { Config, parseConfig } from './config';
import { Database, migrate, MigrationResult } from './db/database';
import { MIGRATIONS } from './db/migrations';
import { loadStaticFiles, StaticFiles } from './http/static';
import { createLogger, Logger } from './log';

// The server's entry point (bundled into build/server/main.cjs). The only module that reads the environment and the
// command line: with arguments, it runs an admin command (see admin/commands.ts); without, it starts the server.

// The build's id, set by webpack (see webpack.config.js)
declare const __BUILD_ID__: string | undefined;

const DATABASE_FILE = 'kawacity.db';

// How long a graceful shutdown may take before the process gives up on it
const SHUTDOWN_LIMIT_MS = 10 * 1000;

const builtId = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : undefined;

const databaseFile = (config: Config) => path.join(config.dataDir, DATABASE_FILE);

// Opens the database, readable by its owner only, and brings it to the current schema (copying it first if needed)
function openDatabase(config: Config, clock: Clock, upgrade: boolean): {db: Database; migration: MigrationResult | null} {
  const db = new Database(databaseFile(config));
  try {
    chmodSync(databaseFile(config), 0o600);
    const migration = upgrade ?
      migrate(db, MIGRATIONS, {backupDirectory: path.join(config.dataDir, 'backups'), now: clock.now()}) : null;
    return {db, migration};
  } catch (error) {
    db.close();
    throw error;
  }
}

// DATA_DIR must be writable; it is created if its parent exists (./data in development)
function checkDataDir(dataDir: string): string | null {
  try {
    if (!existsSync(dataDir))
      mkdirSync(dataDir);
    const probe = path.join(dataDir, `.write-test-${process.pid}`);
    writeFileSync(probe, '');
    unlinkSync(probe);
    return null;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? 'error';
    if (code === 'ENOENT')
      return `DATA_DIR ${dataDir} does not exist, nor does the directory it would be created in`;

    const uid = process.getuid?.();
    const gid = process.getgid?.();
    const owner = uid === undefined ? '' : ` by uid ${uid}`;
    const fix = uid === undefined ? '' : `: run chown -R ${uid}:${gid} on the host directory mounted there, or use a named volume`;
    return `DATA_DIR ${dataDir} is not writable${owner} (${code})${fix}`;
  }
}

// In a container, DATA_DIR on the same filesystem as / is not a volume: it goes away with the container
function dataDirIsEphemeral(dataDir: string): boolean {
  const inContainer = existsSync('/.dockerenv') || existsSync('/run/.containerenv');
  try {
    return inContainer && statSync(dataDir).dev === statSync('/').dev;
  } catch (e) {
    return false;
  }
}

function warnAboutConfig(config: Config, log: Logger): void {
  if (config.publicUrlDefaulted)
    log.warn('config.public_url', {message: `PUBLIC_URL is not set: using ${config.publicOrigin}. Set it to the ` +
                                            'address players open: mails link to it, and only pages from it may ' +
                                            'post to the server or connect to multiplayer.'});
  if (!config.https)
    log.warn('config.http', {message: `PUBLIC_URL ${config.publicOrigin} is plain http: passwords and sessions travel ` +
                                      'unencrypted. Use https (behind a reverse proxy) when others play here.'});

  if (config.mailTransport === 'log')
    log.warn('mail.log', {message: 'MAIL_TRANSPORT=log: mails, and the links in them, are written to this log ' +
                                   'instead of being sent. For development only.'});
  else if (config.mailTransport === 'none')
    log.info('mail.none', {message: 'SMTP_HOST is not set, so no mail is sent: players cannot create accounts or ' +
                                    'reset their passwords. Accounts can be made with the admin commands (see ' +
                                    'README.md).'});

  if (config.mailTransport !== 'none' && config.registration === 'open' && config.operatorContact === null)
    log.warn('config.operator_contact', {message: 'OPERATOR_CONTACT is not set: the privacy notice cannot say who ' +
                                                  'runs this server and how to reach them.'});

  if (process.env.UV_THREADPOOL_SIZE === undefined)
    log.info('config.threadpool', {message: 'UV_THREADPOOL_SIZE is not set: password hashing shares Node.js\'s 4 ' +
                                            'worker threads with file and network work. The image and npm start ' +
                                            'set it to 8.'});
}

const listen = (server: Server, port: number, host: string) => new Promise<void>((resolve, reject) => {
  server.once('error', reject);
  server.listen(port, host, () => {
    server.off('error', reject);
    resolve();
  });
});

async function serve(config: Config, log: Logger): Promise<number> {
  const clock = systemClock;
  warnAboutConfig(config, log);

  const dataProblem = checkDataDir(config.dataDir);
  if (dataProblem) {
    log.error('data_dir.unwritable', {message: dataProblem});
    return 1;
  }
  if (dataDirIsEphemeral(config.dataDir))
    log.warn('data_dir.not_a_volume', {message: `DATA_DIR ${config.dataDir} is not a volume: cities and accounts ` +
                                                'will be lost when the container is removed. Mount one there (see ' +
                                                'docker-compose.yml).'});

  let staticFiles: StaticFiles;
  try {
    staticFiles = loadStaticFiles(config.staticDir);
  } catch (error) {
    log.error('static_dir.invalid', {message: error instanceof Error ? error.message : String(error)});
    return 1;
  }

  let db: Database;
  try {
    const opened = openDatabase(config, clock, true);
    db = opened.db;
    const migration = opened.migration;
    if (migration && migration.from !== migration.to)
      log.info('database.migrated', {from: migration.from, to: migration.to, backup: migration.backup,
                                     message: `Database schema upgraded from version ${migration.from} to ` +
                                              `${migration.to}` + (migration.backup ? `; copy of the previous ` +
                                              `version: ${migration.backup}` : '')});
  } catch (error) {
    log.error('database.error', {message: `Cannot open the database ${databaseFile(config)}: ` +
                                          (error instanceof Error ? error.message : String(error)), err: error});
    return 1;
  }

  const app = createApp(config, {clock, db, log, staticFiles});
  app.runPurge();

  try {
    await listen(app.server, config.port, config.host);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? String(error);
    log.error('server.listen', {message: `Cannot listen on ${config.host} port ${config.port} (${code})`});
    db.close();
    return 1;
  }

  log.info('server.start', {message: `KawaCity ${config.buildId} is listening on ${config.host} port ` +
                                     `${config.port}, for ${config.publicOrigin}`,
                            build: config.buildId, port: config.port, publicUrl: config.publicOrigin,
                            mail: config.mailTransport, staticFiles: staticFiles.files.size});

  return new Promise(resolve => {
    let stopping = false;

    const stop = (signal: string) => {
      if (stopping)
        return;
      stopping = true;
      log.info('server.stop', {signal, message: `${signal}: saving and stopping`});

      const limit = setTimeout(() => {
        log.error('server.stop_timeout', {message: `Stopping took more than ${SHUTDOWN_LIMIT_MS / 1000} s: giving up`});
        db.close();
        resolve(1);
      }, SHUTDOWN_LIMIT_MS);

      app.shutdown().then(() => {
        clearTimeout(limit);
        db.close();
        log.info('server.stopped', {message: 'Stopped'});
        resolve(0);
      }, error => {
        clearTimeout(limit);
        log.error('server.stop_error', {err: error});
        db.close();
        resolve(1);
      });
    };

    process.on('SIGTERM', () => stop('SIGTERM'));
    process.on('SIGINT', () => stop('SIGINT'));
  });
}

async function runAdmin(argv: readonly string[], config: Config): Promise<number> {
  const opened: Database[] = [];
  const context: AdminContext = {
    config,
    clock: systemClock,
    databaseFile: databaseFile(config),
    openDatabase(upgrade = true) {
      if (opened.length === 0) {
        const problem = checkDataDir(config.dataDir);
        if (problem)
          throw new Error(problem);
        const {db, migration} = openDatabase(config, systemClock, upgrade);
        if (migration?.backup)
          context.err(`The database was upgraded to schema version ${migration.to}; previous version copied to ` +
                      migration.backup);
        opened.push(db);
      }
      return opened[0];
    },
    out: line => { process.stdout.write(line + '\n'); },
    err: line => { process.stderr.write(line + '\n'); },
  };

  try {
    return await runAdminCommand(argv, context);
  } finally {
    opened.forEach(db => db.close());
  }
}

async function main(argv: readonly string[], env: NodeJS.ProcessEnv): Promise<number> {
  if (argv.length > 0 && ['help', '--help', '-h'].includes(argv[0])) {
    helpText().forEach(line => process.stdout.write(line + '\n'));
    return 0;
  }

  const admin = argv.length > 0;
  const parsed = parseConfig(env, {defaultBuildId: builtId});
  if (!parsed.ok) {
    if (admin) {
      parsed.errors.forEach(problem => process.stderr.write(`Configuration: ${problem}\n`));
    } else {
      const log = createLogger({level: 'error'});
      parsed.errors.forEach(problem => log.error('config.invalid', {message: problem}));
    }
    return 1;
  }

  if (admin)
    return runAdmin(argv, parsed.config);

  const log = createLogger({level: parsed.config.logLevel});
  process.on('unhandledRejection', reason => log.error('process.unhandled_rejection', {err: reason}));
  process.on('uncaughtException', error => {
    log.error('process.uncaught_exception', {err: error});
    process.exit(1);
  });
  return serve(parsed.config, log);
}

main(process.argv.slice(2), process.env).then(code => process.exit(code), error => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
