/* KawaCity, a modified version of micropolisJS.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

import http from 'node:http';
import net from 'node:net';
import { Database } from '../db/database';
import { json, HttpError } from '../http/response';
import { cleanUp, startTestApp, TestApp, testDatabase } from '../testing';

afterAll(cleanUp);

const DAY = 24 * 60 * 60 * 1000;

const addUser = (db: Database) => db.run(
  `INSERT INTO users (public_id, username, username_key, username_skeleton, email, email_key, password_hash, locale,
                      created_at, updated_at) VALUES ('AAAAAAAAAAAAAAAAAAAAAA', 'Alice', 'alice', 'alice',
                      'alice@example.com', 'alice@example.com', 'x', 'fr', 1000, 1000)`).lastInsertRowid;

describe('GET /api/health', () => {
  let t: TestApp;
  beforeAll(async () => { t = await startTestApp(); });
  afterAll(() => t.close());

  test('Answers ok with the build', async () => {
    const response = await t.request('/api/health');
    expect(response.status).toBe(200);
    expect(response.json).toEqual({ok: true, build: 'test'});
    expect(response.headers['cache-control']).toBe('no-store');
  });

  test('Answers 503 when the database fails', async () => {
    const broken = await startTestApp({}, {db: testDatabase()});
    broken.db.close();
    const response = await broken.request('/api/health');
    expect(response.status).toBe(503);
    expect(response.json).toEqual({ok: false, build: 'test'});
    expect(broken.logs.some(line => line.event === 'health.fail')).toBe(true);
    await broken.close();
  });
});

describe('GET /api/session', () => {
  test('Without mail and without accounts, the server offers nothing more than the static game', async () => {
    const t = await startTestApp();
    const response = await t.request('/api/session');
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(response.json).toEqual({
      user: null,
      features: {mail: false, registration: false, accounts: false, multiplayer: false},
      publicUrl: 'http://localhost:8080',
      operator: null,
      build: 'test',
      limits: {passwordMin: 12, passwordMax: 128, usernameMin: 3, usernameMax: 20, cityNameMax: 15, ownedCities: 5},
    });

    // An account made by the admin commands makes logging in possible
    addUser(t.db);
    expect((await t.request('/api/session')).json.features).toEqual(
      {mail: false, registration: false, accounts: true, multiplayer: true});
    await t.close();
  });

  test('With mail, registration is open unless closed', async () => {
    const open = await startTestApp({MAIL_TRANSPORT: 'log', OPERATOR_CONTACT: 'Jo, jo@example.com'});
    const session = (await open.request('/api/session')).json;
    expect(session.features).toEqual({mail: true, registration: true, accounts: true, multiplayer: true});
    expect(session.operator).toBe('Jo, jo@example.com');
    await open.close();

    const closed = await startTestApp({SMTP_HOST: 'smtp.example.com', MAIL_FROM: 'k@example.com',
                                       REGISTRATION: 'closed'});
    expect((await closed.request('/api/session')).json.features).toEqual(
      {mail: true, registration: false, accounts: true, multiplayer: true});
    await closed.close();
  });

  test('The signed-in user, as the session resolver finds them', async () => {
    const t = await startTestApp();
    const id = addUser(t.db);
    t.app.context.setUserResolver(ctx => ctx.cookies.get('kc_session') !== 'good' ? null : {
      user: {id, publicId: 'AAAAAAAAAAAAAAAAAAAAAA', username: 'Alice', email: 'alice@example.com', locale: 'fr',
             createdAt: 1000},
      session: {tokenHash: 'h', userId: id, createdAt: 0, lastSeenAt: 0, expiresAt: DAY},
    });

    expect((await t.request('/api/session', {headers: {Cookie: 'kc_session=bad'}})).json.user).toBeNull();
    expect((await t.request('/api/session', {headers: {Cookie: 'kc_session=good'}})).json.user).toEqual(
      {id: 'AAAAAAAAAAAAAAAAAAAAAA', username: 'Alice', email: 'alice@example.com', locale: 'fr', createdAt: 1000});
    await t.close();
  });
});

describe('Security headers', () => {
  const COMMON = {
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'same-origin',
    'x-frame-options': 'DENY',
    'cross-origin-opener-policy': 'same-origin',
    'cross-origin-resource-policy': 'same-origin',
    'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  };

  test('Every response has them; pages get the full policy, the API a closed one', async () => {
    const t = await startTestApp();
    const page = await t.request('/');
    const api = await t.request('/api/session');
    const missing = await t.request('/nothing');
    const refused = await t.request('/api/session', {method: 'POST'});
    for (const response of [page, api, missing, refused]) {
      expect(response.headers).toMatchObject(COMMON);
      expect(response.headers['strict-transport-security']).toBeUndefined();
      expect(response.headers['access-control-allow-origin']).toBeUndefined();
      expect(response.headers['x-powered-by']).toBeUndefined();
    }

    expect(page.headers['content-security-policy']).toBe(
      "default-src 'self'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; " +
      "img-src 'self' data: blob:; font-src 'self'; connect-src 'self' ws://localhost:8080; worker-src 'self'; " +
      "manifest-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
    for (const response of [api, missing, refused])
      expect(response.headers['content-security-policy']).toBe("default-src 'none'; frame-ancestors 'none'");
    expect(api.headers['cache-control']).toBe('no-store');
    expect(refused.headers['cache-control']).toBe('no-store');
    await t.close();
  });

  test('With https, HSTS (unless HSTS=false) and wss: in the policy', async () => {
    const https = await startTestApp({PUBLIC_URL: 'https://kawacity.example.com'});
    const page = await https.request('/');
    expect(page.headers['strict-transport-security']).toBe('max-age=31536000');
    expect(page.headers['content-security-policy']).toContain("connect-src 'self' wss://kawacity.example.com;");
    expect((await https.request('/api/health')).headers['strict-transport-security']).toBe('max-age=31536000');
    await https.close();

    const noHsts = await startTestApp({PUBLIC_URL: 'https://kawacity.example.com:8443', HSTS: 'false'});
    const other = await noHsts.request('/');
    expect(other.headers['strict-transport-security']).toBeUndefined();
    expect(other.headers['content-security-policy']).toContain("connect-src 'self' wss://kawacity.example.com:8443;");
    await noHsts.close();
  });
});

describe('Requests that change something', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await startTestApp();
    t.app.context.router.post('/api/test/echo', ctx => json(ctx.res, 200, {body: ctx.body}));
    t.app.context.router.post('/api/test/small', ctx => json(ctx.res, 200, {body: ctx.body}), {bodyLimit: 20});
  });
  afterAll(() => t.close());

  const post = (headers: http.OutgoingHttpHeaders, body: unknown = {a: 1}) =>
    t.request('/api/test/echo', {method: 'POST', body, headers});

  test('Need the Origin of PUBLIC_URL', async () => {
    const json = {'Content-Type': 'application/json'};
    for (const origin of [undefined, 'null', 'http://evil.example', 'http://localhost:8080/', 'http://LOCALHOST:8080',
                          'https://localhost:8080', 'http://localhost:8081', 'http://localhost:8080, http://x']) {
      const response = await post(origin === undefined ? json : {...json, Origin: origin});
      expect(response.status).toBe(403);
      expect(response.json).toEqual({error: {code: 'bad_origin'}});
    }

    const accepted = await post({...json, Origin: 'http://localhost:8080'});
    expect(accepted.status).toBe(200);
    expect(accepted.json).toEqual({body: {a: 1}});
  });

  test('Every method that changes something is checked, on any path', async () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE'])
      expect((await t.request('/api/test/echo', {method})).status).toBe(403);
    expect((await t.request('/index.html', {method: 'POST'})).status).toBe(403);
    expect((await t.request('/api/nothing', {method: 'DELETE'})).status).toBe(403);
  });

  test('Refusals are logged once a minute per client, whatever their origins', async () => {
    t.clock.advance(60 * 1000);
    // The counts of the earlier tests' refusals
    t.app.context.log.flush();
    const before = t.logs.filter(line => line.event === 'csrf.reject').length;
    for (let i = 0; i < 3; i++)
      await post({'Content-Type': 'application/json', Origin: `https://attacker${i}.example`});
    let lines = t.logs.filter(line => line.event === 'csrf.reject').slice(before);
    expect(lines.length).toBe(1);
    expect(lines[0]).toMatchObject({level: 'warn', origin: 'https://attacker0.example', ip: '127.0.0.1',
                                    message: 'Origin https://attacker0.example does not match PUBLIC_URL ' +
                                             'http://localhost:8080'});

    // The origin the client chose is shortened; the minute over, the count of those left out comes first
    t.clock.advance(60 * 1000);
    await post({'Content-Type': 'application/json', Origin: 'https://' + 'a'.repeat(500) + '.example'});
    lines = t.logs.filter(line => line.event === 'csrf.reject').slice(before);
    expect(lines.length).toBe(3);
    expect(lines[1]).toMatchObject({suppressed: 2, origin: 'https://attacker0.example'});
    expect(lines[2]).toMatchObject({origin: 'https://' + 'a'.repeat(92)});
    expect(lines[2].suppressed).toBeUndefined();
  });

  test('Need Content-Type: application/json', async () => {
    for (const type of [undefined, 'text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data']) {
      const headers: http.OutgoingHttpHeaders = {Origin: 'http://localhost:8080'};
      if (type)
        headers['Content-Type'] = type;
      const response = await post(headers, 'a=1');
      expect(response.status).toBe(415);
      expect(response.json).toEqual({error: {code: 'unsupported_media_type'}});
    }
  });

  test('Bodies are limited and must be JSON', async () => {
    const tooLarge = await t.post('/api/test/small', {text: 'x'.repeat(30)});
    expect(tooLarge.status).toBe(413);
    expect(tooLarge.json).toEqual({error: {code: 'payload_too_large'}});

    const huge = await t.post('/api/test/echo', {text: 'x'.repeat(17 * 1024)});
    expect(huge.status).toBe(413);

    const notJson = await t.post('/api/test/echo', '{"a": ');
    expect(notJson.status).toBe(400);
    expect(notJson.json).toEqual({error: {code: 'invalid_input'}});

    expect((await t.post('/api/test/small', {a: 'b'})).json).toEqual({body: {a: 'b'}});
  });
});

describe('Errors', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await startTestApp();
    const router = t.app.context.router;
    router.get('/api/test/fail', () => { throw new Error('database on fire'); });
    router.get('/api/test/refuse', () => {
      throw new HttpError(400, 'invalid_input', {username: 'too_short'});
    });
    router.get('/api/test/silent', () => undefined);
    router.get('/api/test/later', async () => {
      await new Promise(resolve => setImmediate(resolve));
      throw new Error('async failure');
    });
    router.get('/api/test/private', ctx => json(ctx.res, 200, {user: ctx.user?.username}), {auth: 'required'});
  });
  afterAll(() => t.close());

  test('Unknown API paths are 404 not_found', async () => {
    for (const path of ['/api/nothing', '/api/', '/api', '/api/session/', '/api/%2e%2e/session', '/api//session']) {
      const response = await t.request(path);
      expect(response.status).toBe(404);
      expect(response.json).toEqual({error: {code: 'not_found'}});
    }
  });

  test('Another method is 405 method_not_allowed, with Allow', async () => {
    const response = await t.request('/api/session', {method: 'PUT', body: {},
                                                      headers: {Origin: 'http://localhost:8080',
                                                                'Content-Type': 'application/json'}});
    expect(response.status).toBe(405);
    expect(response.headers.allow).toBe('GET');
    expect(response.json).toEqual({error: {code: 'method_not_allowed'}});
  });

  test('Handlers answer errors with their fields', async () => {
    const response = await t.request('/api/test/refuse');
    expect(response.status).toBe(400);
    expect(response.json).toEqual({error: {code: 'invalid_input', fields: {username: 'too_short'}}});
  });

  test('Anything else is 500 internal, with a request id that leads to the stack in the log', async () => {
    for (const path of ['/api/test/fail', '/api/test/later', '/api/test/silent']) {
      const response = await t.request(path);
      expect(response.status).toBe(500);
      expect(response.json.error.code).toBe('internal');
      expect(response.json.error.requestId).toMatch(/^[0-9a-f]{12}$/);
      expect(response.text).not.toContain('fire');
      expect(response.text).not.toContain('at ');

      const line = t.logs.find(entry => entry.event === 'http.error' && entry.requestId === response.json.error.requestId);
      expect(line.err.stack).toBeDefined();
    }
  });

  test('Routes that need a session answer 401 unauthenticated without one', async () => {
    const response = await t.request('/api/test/private');
    expect(response.status).toBe(401);
    expect(response.json).toEqual({error: {code: 'unauthenticated'}});
  });
});

describe('Rate limits', () => {
  test('Any API request: 600 a minute per client, then 429 with Retry-After', async () => {
    const t = await startTestApp();
    const statuses: number[] = [];
    for (let i = 0; i < 601; i++)
      statuses.push((await t.request('/api/health')).status);
    expect(statuses.slice(0, 600).every(status => status === 200)).toBe(true);

    const limited = await t.request('/api/session');
    expect(limited.status).toBe(429);
    expect(limited.json).toEqual({error: {code: 'rate_limited'}});
    expect(Number(limited.headers['retry-after'])).toBeGreaterThanOrEqual(1);
    expect(t.logs.filter(line => line.event === 'rate_limited').length).toBe(1);

    // The game's files are not limited
    expect((await t.request('/')).status).toBe(200);

    t.clock.advance(2 * 60 * 1000);
    expect((await t.request('/api/health')).status).toBe(200);
    await t.close();
  });

  test('Route limits, per IP (times IP_LIMIT_FACTOR) and per user', async () => {
    const t = await startTestApp({IP_LIMIT_FACTOR: '2'});
    const router = t.app.context.router;
    const answer = (ctx: any) => json(ctx.res, 200, {});
    router.get('/api/test/ip', answer, {limits: [{name: 'test-ip', limit: 2, windowMs: 60000, per: 'ip'}]});
    router.get('/api/test/ip2', answer, {limits: [{name: 'test-ip', limit: 2, windowMs: 60000, per: 'ip'}]});
    router.get('/api/test/user', answer, {auth: 'required',
                                         limits: [{name: 'test-user', limit: 1, windowMs: 60000, per: 'user'}]});
    t.app.context.setUserResolver(ctx => {
      const id = Number(ctx.cookies.get('user'));
      return id ? {user: {id, publicId: 'x', username: 'u' + id, email: 'e', locale: 'en', createdAt: 0},
                   session: {tokenHash: 'h', userId: id, createdAt: 0, lastSeenAt: 0, expiresAt: 0}} : null;
    });

    // A shared limit: 2 x 2 across both routes
    const ip = [];
    for (const path of ['/api/test/ip', '/api/test/ip2', '/api/test/ip', '/api/test/ip2', '/api/test/ip'])
      ip.push((await t.request(path)).status);
    expect(ip).toEqual([200, 200, 200, 200, 429]);

    const as = (user: number) => t.request('/api/test/user', {headers: {Cookie: 'user=' + user}});
    expect([(await as(1)).status, (await as(1)).status, (await as(2)).status]).toEqual([200, 429, 200]);

    expect(() => router.get('/api/test/ip3', answer, {limits: [{name: 'test-ip', limit: 3, windowMs: 60000,
                                                               per: 'ip'}]})).not.toThrow();
    expect((await t.request('/api/test/ip3')).status).toBe(500);
    await t.close();
  });
});

describe('Refusals in the log', () => {
  test('Refused requests are logged once a minute per IPv6 /48, not per /64', async () => {
    const t = await startTestApp({TRUST_PROXY: '1'});
    t.app.context.router.get('/api/test/once', ctx => json(ctx.res, 200, {}),
                             {limits: [{name: 'test-once', limit: 1, windowMs: 60000, per: 'ip'}]});
    const statuses = [];
    for (let n = 0; n < 40; n++)
      statuses.push((await t.request('/api/test/once', {headers: {'X-Forwarded-For': `2001:db8:77:${n}::1`}})).status);
    // Each /64 may once, the /48 ten times
    expect(statuses.filter(status => status === 200).length).toBe(10);
    expect(statuses.filter(status => status === 429).length).toBe(30);

    const lines = t.logs.filter(line => line.event === 'rate_limited');
    expect(lines.length).toBe(1);
    // The first /64 refused (the eleventh, 2001:db8:77:10::1)
    expect(lines[0]).toMatchObject({limit: 'test-once', ip: '2001:db8:77:10::/64'});
    t.app.runPurge();
    expect(t.logs.filter(line => line.event === 'rate_limited')[1]).toMatchObject({suppressed: 29});
    await t.close();
  });
});

describe('Clients that go away', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await startTestApp();
    t.app.context.router.post('/api/test/echo', ctx => json(ctx.res, 200, {body: ctx.body}));
  });
  afterAll(() => t.close());

  // A POST whose client goes away after part of its body, once the server is reading it
  const abandon = () => new Promise<void>((resolve, reject) => {
    const socket = net.connect(Number(new URL(t.url).port), '127.0.0.1');
    t.app.server.once('request', () => socket.destroy());
    socket.on('connect', () => socket.write('POST /api/test/echo HTTP/1.1\r\nHost: localhost:8080\r\n' +
                                            'Origin: http://localhost:8080\r\nContent-Type: application/json\r\n' +
                                            'Content-Length: 100\r\n\r\n{"a": '));
    socket.on('close', () => resolve());
    socket.on('error', reject);
  });

  // Until the server has seen every connection end
  const settled = async () => {
    const open = () => new Promise<number>(resolve => t.app.server.getConnections((_, count) => resolve(count)));
    for (let i = 0; i < 200 && await open() > 0; i++)
      await new Promise(resolve => setTimeout(resolve, 10));
    await new Promise(resolve => setImmediate(resolve));
  };

  test('Are not server errors: no answer, and a line at info level, once a minute per client', async () => {
    for (let i = 0; i < 5; i++)
      await abandon();
    await settled();

    expect(t.logs.filter(line => line.event === 'http.error')).toEqual([]);
    const lines = t.logs.filter(line => line.event === 'http.aborted');
    expect(lines.length).toBe(1);
    expect(lines[0]).toMatchObject({level: 'info', ip: '127.0.0.1', path: '/api/test/echo'});
    expect(JSON.stringify(lines[0])).not.toContain('stack');

    t.app.runPurge();
    expect(t.logs.filter(line => line.event === 'http.aborted')[1]).toMatchObject({suppressed: 4});

    // The server goes on
    expect((await t.post('/api/test/echo', {a: 1})).json).toEqual({body: {a: 1}});
  });
});

describe('WebSocket upgrades', () => {
  const upgrade = (t: TestApp, path: string, headers: http.OutgoingHttpHeaders) => new Promise<number>(resolve => {
    const req = http.request({host: '127.0.0.1', port: new URL(t.url).port, path, agent: false,
                              headers: {Connection: 'Upgrade', Upgrade: 'websocket', ...headers}});
    req.on('upgrade', (res, socket) => {
      socket.destroy();
      resolve(res.statusCode ?? 0);
    });
    req.on('response', res => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on('error', () => resolve(-1));
    req.end();
  });

  test('Only registered paths, and only from the game\'s page', async () => {
    const t = await startTestApp();
    const seen: string[] = [];
    t.app.context.setUpgradeHandler('/api/ws', ({socket, address, cookies}) => {
      seen.push(address.ip + ' ' + cookies.get('kc_session'));
      socket.end('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n');
    });

    expect(await upgrade(t, '/ws', {Origin: 'http://localhost:8080'})).toBe(404);
    expect(await upgrade(t, '/api/ws', {})).toBe(403);
    expect(await upgrade(t, '/api/ws', {Origin: 'http://evil.example'})).toBe(403);
    expect(seen).toEqual([]);
    // Once a minute per client
    expect(t.logs.filter(line => line.event === 'ws.reject').length).toBe(1);

    expect(await upgrade(t, '/api/ws', {Origin: 'http://localhost:8080', Cookie: 'kc_session=abc'})).toBe(101);
    expect(seen).toEqual(['127.0.0.1 abc']);
    await t.close();
  });
});

describe('Lifecycle', () => {
  test('Purge tasks run on demand, and shutdown runs its tasks once, in order', async () => {
    const t = await startTestApp();
    const ran: string[] = [];
    t.app.context.addPurgeTask('test', now => ran.push('purge ' + now));
    t.app.context.addPurgeTask('broken', () => { throw new Error('nope'); });
    t.app.runPurge();
    expect(ran).toEqual(['purge ' + t.clock.now()]);
    expect(t.logs.some(line => line.event === 'purge.error' && line.task === 'broken')).toBe(true);

    t.app.context.onShutdown(async () => { ran.push('first'); });
    t.app.context.onShutdown(() => { ran.push('second'); });
    t.app.context.log.security('test.refused', 'client');
    t.app.context.log.security('test.refused', 'client');
    await Promise.all([t.app.shutdown(), t.app.shutdown()]);
    expect(ran.slice(1)).toEqual(['first', 'second']);
    expect(t.app.server.listening).toBe(false);
    // The counts of the log's security events are written last
    expect(t.logs[t.logs.length - 1]).toMatchObject({event: 'test.refused', suppressed: 1});
    t.db.close();
  });
});
