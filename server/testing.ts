/* KawaCity, a modified version of micropolisJS.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import http, { IncomingHttpHeaders, OutgoingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { App, AppDeps, createApp } from './app';
import { FakeClock } from './clock';
import { Config, Env, parseConfig } from './config';
import { Database, migrate } from './db/database';
import { MIGRATIONS } from './db/migrations';
import { loadStaticFiles } from './http/static';
import { createLogger } from './log';

// Helpers for the server's tests (server/test/): a configuration, a game directory, a database, and an app listening
// on a free port of 127.0.0.1. Nothing reaches the network.

export const TEST_ORIGIN = 'http://localhost:8080';

// A temporary directory, removed by cleanUp()
const temporaryDirectories: string[] = [];

export function temporaryDirectory(): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'kawacity-test-'));
  temporaryDirectories.push(directory);
  return directory;
}

// Apps started by startTestApp and not closed yet
const openApps = new Set<TestApp>();

// Closes the apps a test file started (even when a test failed before closing its own) and removes the temporary
// directories: afterAll(cleanUp)
export async function cleanUp(): Promise<void> {
  for (const app of [...openApps])
    await app.close();

  while (temporaryDirectories.length > 0)
    rmSync(temporaryDirectories.pop() as string, {recursive: true, force: true});
}

// The test configuration: fast password hashes and captchas, quiet logs
export function testConfig(env: Env = {}): Config {
  const result = parseConfig({
    PUBLIC_URL: TEST_ORIGIN,
    DATA_DIR: '/nonexistent/data',
    STATIC_DIR: '/nonexistent/static',
    CAPTCHA_ALLOW_EASY: '1',
    CAPTCHA_MAX_NUMBER: '10',
    PASSWORD_HASH_COST: '10',
    LOG_LEVEL: 'error',
    BUILD_ID: 'test',
    ...env,
  });
  if (!result.ok)
    throw new Error('bad test configuration: ' + result.errors.join('; '));
  return result.config;
}

// A small game directory: a page, a script long enough to be compressed, an image, a city, LICENSE
export function makeStaticDirectory(): string {
  const directory = temporaryDirectory();
  mkdirSync(path.join(directory, 'src'));
  mkdirSync(path.join(directory, 'images'));
  mkdirSync(path.join(directory, 'cities'));
  writeFileSync(path.join(directory, 'index.html'), '<!DOCTYPE html><title>KawaCity</title>' + 'x'.repeat(1000));
  writeFileSync(path.join(directory, 'about.html'), '<!DOCTYPE html><title>About</title>');
  writeFileSync(path.join(directory, 'manifest.webmanifest'), '{"name": "KawaCity"}');
  writeFileSync(path.join(directory, 'src', 'micropolis.js'), 'var game = "KawaCity";\n'.repeat(500));
  writeFileSync(path.join(directory, 'src', 'micropolis.js.map'), '{}');
  writeFileSync(path.join(directory, 'images', 'tiles.png'), Buffer.alloc(2000, 1));
  writeFileSync(path.join(directory, 'cities', 'kobe.cty'), Buffer.alloc(3000, 0));
  writeFileSync(path.join(directory, 'LICENSE'), 'Additional terms\n'.repeat(50));
  writeFileSync(path.join(directory, '.hidden'), 'secret');
  return directory;
}

// A migrated database in memory
export function testDatabase(): Database {
  const db = new Database(':memory:');
  migrate(db, MIGRATIONS, {backupDirectory: '/nonexistent', now: 0});
  return db;
}

export interface TestResponse {
  status: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
  text: string;
  json: any;
}

export interface TestRequest {
  method?: string;
  headers?: OutgoingHttpHeaders;
  // A string is sent as it is; anything else as JSON
  body?: unknown;
}

// A request with exactly the headers given (no Origin, no Accept-Encoding unless given), raw path included
export function request(baseUrl: string, rawPath: string, options: TestRequest = {}): Promise<TestResponse> {
  const url = new URL(baseUrl);
  const body = options.body === undefined ? undefined :
    typeof options.body === 'string' || Buffer.isBuffer(options.body) ? options.body : JSON.stringify(options.body);

  return new Promise((resolve, reject) => {
    const req = http.request({
      host: url.hostname,
      port: url.port,
      method: options.method ?? 'GET',
      path: rawPath,
      headers: {...(body !== undefined ? {'Content-Length': Buffer.byteLength(body)} : {}), ...options.headers},
      agent: false,
    }, res => {
      const chunks: Buffer[] = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        const text = buffer.toString('utf8');
        let parsed: unknown = undefined;
        try {
          parsed = JSON.parse(text);
        } catch (e) {
          // Not JSON
        }
        resolve({status: res.statusCode ?? 0, headers: res.headers, body: buffer, text, json: parsed});
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end(body);
  });
}

export interface TestApp {
  app: App;
  url: string;
  clock: FakeClock;
  db: Database;
  config: Config;
  // The log's lines, parsed
  logs: any[];
  request(rawPath: string, options?: TestRequest): Promise<TestResponse>;
  // A POST from the game's page: Origin and Content-Type set
  post(rawPath: string, body: unknown, headers?: OutgoingHttpHeaders): Promise<TestResponse>;
  close(): Promise<void>;
}

// The app's log is kept in memory, every level of it
export async function startTestApp(env: Env = {}, deps: Partial<AppDeps> = {}): Promise<TestApp> {
  const config = testConfig({LOG_LEVEL: 'debug', ...env});
  const clock = new FakeClock();
  const db = deps.db ?? testDatabase();
  const logs: any[] = [];
  const log = createLogger({level: config.logLevel, clock, write: line => logs.push(JSON.parse(line))});
  const app = createApp(config, {
    clock,
    db,
    log,
    staticFiles: deps.staticFiles ?? loadStaticFiles(makeStaticDirectory()),
    mailer: deps.mailer,
  });

  await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', () => resolve()));
  const url = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;

  const testApp: TestApp = {
    app,
    url,
    clock,
    db,
    config,
    logs,
    request: (rawPath, options) => request(url, rawPath, options),
    post: (rawPath, body, headers = {}) => request(url, rawPath, {
      method: 'POST',
      body,
      headers: {'Origin': config.publicOrigin, 'Content-Type': 'application/json', ...headers},
    }),
    close: async () => {
      openApps.delete(testApp);
      await app.shutdown();
      db.close();
    },
  };
  openApps.add(testApp);
  return testApp;
}
