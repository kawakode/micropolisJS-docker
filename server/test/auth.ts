/* KawaCity, a modified version of micropolisJS.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

import { existsSync, readFileSync } from 'node:fs';
import type { OutgoingHttpHeaders } from 'node:http';
import path from 'node:path';
import { EMAIL_TEXTS } from '../../src/emailTexts.js';
import { I18n } from '../../src/i18n.js';
import { CEILING } from '../auth/loginGuard';
import type { SessionRevocation } from '../auth/sessions';
import type { Env } from '../config';
import { Database, migrate } from '../db/database';
import { MIGRATIONS } from '../db/migrations';
import { PasswordHasher } from '../security/passwords';
import { sha256Hex } from '../security/tokens';
import { cleanUp, sessionCookie, solvedCaptcha, startTestApp, temporaryDirectory, TestApp,
         TestResponse } from '../testing';

afterAll(cleanUp);

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const PASSWORD = 'correct horse battery staple';
const NEW_PASSWORD = 'a brand new passphrase';
// Mail on (kept in memory by the tests), and room for many requests from 127.0.0.1
const MAIL: Env = {MAIL_TRANSPORT: 'log', IP_LIMIT_FACTOR: '100'};

// The token of the link of that kind in a mail's text
const tokenIn = (text: string, kind: 'signup' | 'reset' | 'email'): string => {
  const match = new RegExp(`^http://localhost:8080/#/${kind}/([A-Za-z0-9_-]{43})$`, 'm').exec(text);
  if (!match)
    throw new Error(`no ${kind} link in: ${text}`);
  return match[1];
};

const mailsTo = (t: TestApp, address: string) => t.mailbox.to(address);
const lastMailTo = (t: TestApp, address: string) => {
  const mails = mailsTo(t, address);
  if (mails.length === 0)
    throw new Error(`no mail to ${address}`);
  return mails[mails.length - 1];
};

// A request from another client address (the test apps trust X-Forwarded-For from 127.0.0.1 with TRUST_PROXY=1)
const from = (ip: string): OutgoingHttpHeaders => ({'X-Forwarded-For': ip});

async function register(t: TestApp, email: string, extra: Record<string, unknown> = {}, headers = {}) {
  const captcha = await solvedCaptcha(t, 'register', headers);
  return t.post('/api/auth/register', {email, locale: 'en', captcha, website: '', ...extra}, headers);
}

// A new account, logged in: its user and session cookie
async function signUp(t: TestApp, email: string, username: string, password = PASSWORD) {
  expect((await register(t, email)).status).toBe(202);
  await t.settle();
  const token = tokenIn(lastMailTo(t, email).text, 'signup');
  const response = await t.post('/api/auth/complete-registration', {token, username, password});
  expect(response.status).toBe(201);
  return {user: response.json.user, cookie: sessionCookie(response) as string};
}

async function logIn(t: TestApp, login: string, password = PASSWORD, headers: OutgoingHttpHeaders = {}) {
  const captcha = await solvedCaptcha(t, 'login', headers);
  return t.post('/api/auth/login', {login, password, captcha}, headers);
}

const session = async (t: TestApp, cookie: string) =>
  (await t.request('/api/session', {headers: {Cookie: cookie}})).json;

// What a client can see of an answer: its status, body and headers but the date and the cookie's value
const visible = (response: TestResponse) => {
  const {date, 'set-cookie': cookie, ...headers} = response.headers;
  return {status: response.status, text: response.text, headers, cookie: cookie === undefined};
};

describe('Registration', () => {
  let t: TestApp;
  beforeAll(async () => { t = await startTestApp(MAIL); });
  afterAll(() => t.close());

  test('An address gets a link; the link chooses the username and password, and logs in', async () => {
    const response = await register(t, 'Alice@Example.com');
    expect(response.status).toBe(202);
    expect(response.json).toEqual({ok: true});
    expect(response.headers['set-cookie']).toBeUndefined();
    await t.settle();

    const mail = lastMailTo(t, 'Alice@example.com');
    expect(mail.subject).toBe(EMAIL_TEXTS.signup.subject);
    const token = tokenIn(mail.text, 'signup');
    expect(token).toHaveLength(43);
    expect(mail.html).toContain(`<a href="http://localhost:8080/#/signup/${token}">`);
    expect(t.db.get('SELECT token_hash FROM signup_tokens')).toEqual({token_hash: sha256Hex(token)});

    const created = await t.post('/api/auth/complete-registration', {token, username: 'Alice', password: PASSWORD});
    expect(created.status).toBe(201);
    expect(created.json.user).toEqual({id: expect.stringMatching(/^[A-Za-z0-9_-]{22}$/), username: 'Alice',
                                       email: 'Alice@example.com', locale: 'en', createdAt: t.clock.now()});
    expect(created.headers['set-cookie']).toEqual([
      expect.stringMatching(/^kc_session=[A-Za-z0-9_-]{43}; Path=\/; Max-Age=2592000; HttpOnly; SameSite=Strict$/)]);

    const cookie = sessionCookie(created) as string;
    expect((await session(t, cookie)).user).toEqual(created.json.user);
    expect((await t.request('/api/account', {headers: {Cookie: cookie}})).json).toEqual({user: created.json.user});

    // The link works once
    const again = await t.post('/api/auth/complete-registration', {token, username: 'Alice2', password: PASSWORD});
    expect(again.status).toBe(400);
    expect(again.json).toEqual({error: {code: 'invalid_token'}});
    expect(t.db.all('SELECT * FROM signup_tokens')).toEqual([]);

    // Logged: the request, the account; never a token or the address
    const events = t.logs.map(line => line.event);
    expect(events).toContain('auth.register_request');
    expect(t.logs.find(line => line.event === 'auth.register')).toMatchObject({user: created.json.user.id,
                                                                               ip: '127.0.0.1'});
    const logText = JSON.stringify(t.logs);
    expect(logText).not.toContain(token);
    expect(logText).not.toContain(PASSWORD);
  });

  test('An address that has an account gets the same answer, and a reminder with a reset link', async () => {
    const unknown = await register(t, 'nobody.yet@example.com');
    const known = await register(t, 'alice@EXAMPLE.com');
    expect(visible(known)).toEqual(visible(unknown));
    await t.settle();

    const mail = lastMailTo(t, 'Alice@example.com');
    expect(mail.subject).toBe(EMAIL_TEXTS.alreadyRegistered.subject);
    expect(mail.text).toContain('your username is Alice');
    const token = tokenIn(mail.text, 'reset');

    // The reset link works
    const reset = await t.post('/api/auth/reset-password', {token, password: NEW_PASSWORD});
    expect(reset.status).toBe(200);
    expect((await logIn(t, 'alice', NEW_PASSWORD)).status).toBe(200);
  });

  test('In the language asked for', async () => {
    await register(t, 'francoise@example.com', {locale: 'fr'});
    await t.settle();
    const mail = lastMailTo(t, 'francoise@example.com');
    expect(mail.subject).toBe(I18n.translate('fr', EMAIL_TEXTS.signup.subject));
    const created = await t.post('/api/auth/complete-registration',
                                 {token: tokenIn(mail.text, 'signup'), username: 'Françoise', password: PASSWORD});
    expect(created.json.user).toMatchObject({username: 'Françoise', locale: 'fr'});
  });

  test('What depends on the account is done after the answer', async () => {
    const held: (() => void)[] = [];
    const t2 = await startTestApp(MAIL, {defer: task => held.push(task)});
    await t2.app.context.auth.users.create({username: 'Bob', usernameKey: 'bob', email: 'bob@example.com',
                                            emailKey: 'bob@example.com', passwordHash: '!', locale: 'en',
                                            now: 0, loggedIn: false});

    const known = await register(t2, 'bob@example.com');
    const unknown = await register(t2, 'carol@example.com');
    expect(visible(known)).toEqual(visible(unknown));
    // Answered: nothing was looked up, made or sent yet
    expect(held.length).toBe(2);
    expect(t2.db.all('SELECT * FROM signup_tokens')).toEqual([]);
    expect(t2.db.all('SELECT * FROM email_tokens')).toEqual([]);
    await t2.settle();
    expect(t2.mailbox.sent).toEqual([]);

    held.splice(0).forEach(task => task());
    await t2.settle();
    expect(t2.mailbox.sent.map(m => [m.to, m.template])).toEqual([['bob@example.com', 'alreadyRegistered'],
                                                                   ['carol@example.com', 'signup']]);
    await t2.close();
  });

  test('A new request replaces the earlier link; links last 24 hours', async () => {
    await register(t, 'dave@example.com');
    await t.settle();
    const first = tokenIn(lastMailTo(t, 'dave@example.com').text, 'signup');
    await register(t, 'dave@example.com');
    await t.settle();
    const second = tokenIn(lastMailTo(t, 'dave@example.com').text, 'signup');
    expect((await t.post('/api/auth/complete-registration', {token: first, username: 'Dave', password: PASSWORD}))
      .json).toEqual({error: {code: 'invalid_token'}});

    t.clock.advance(DAY);
    expect((await t.post('/api/auth/complete-registration', {token: second, username: 'Dave', password: PASSWORD}))
      .json).toEqual({error: {code: 'invalid_token'}});
  });

  test('The username and password are checked for the link\'s holder only, without using the link up', async () => {
    await register(t, 'erin.smith@example.com');
    await t.settle();
    const token = tokenIn(lastMailTo(t, 'erin.smith@example.com').text, 'signup');
    const complete = (username: unknown, password: unknown) =>
      t.post('/api/auth/complete-registration', {token, username, password});

    const cases: [unknown, unknown, number, unknown][] = [
      ['e', PASSWORD, 400, {code: 'invalid_input', fields: {username: 'too_short'}}],
      ['erin smith', PASSWORD, 400, {code: 'invalid_input', fields: {username: 'invalid'}}],
      ['Admin', PASSWORD, 400, {code: 'invalid_input', fields: {username: 'reserved'}}],
      [42, PASSWORD, 400, {code: 'invalid_input', fields: {username: 'invalid'}}],
      ['ALICE', PASSWORD, 409, {code: 'username_taken'}],
      // Looks like Alice (an l with a stroke, an upper case I for the l)
      ['A\u0142ice', PASSWORD, 409, {code: 'username_taken'}],
      ['AIice', PASSWORD, 409, {code: 'username_taken'}],
      ['adm\u0131n', PASSWORD, 400, {code: 'invalid_input', fields: {username: 'reserved'}}],
      // Latin alpha, small capitals: not letters of a language
      ['\u0251lice', PASSWORD, 400, {code: 'invalid_input', fields: {username: 'invalid'}}],
      ['\u1D00\u1D05\u1D0D\u026A\u0274', PASSWORD, 400, {code: 'invalid_input', fields: {username: 'invalid'}}],
      ['Erin\u0661', PASSWORD, 400, {code: 'invalid_input', fields: {username: 'invalid'}}],
      ['Erin', 'short', 400, {code: 'weak_password', fields: {password: 'too_short'}}],
      ['Erin', 'x'.repeat(129), 400, {code: 'weak_password', fields: {password: 'too_long'}}],
      ['Erin', 'Password1234', 400, {code: 'weak_password', fields: {password: 'common'}}],
      ['Erin', 'erin is my name', 400, {code: 'weak_password', fields: {password: 'contains_username'}}],
      ['Zed1', 'Mail: Erin.Smith!', 400, {code: 'weak_password', fields: {password: 'contains_email'}}],
      ['Erin', 'abababababab', 400, {code: 'weak_password', fields: {password: 'too_simple'}}],
      ['Erin', 12345678901234, 400, {code: 'invalid_input', fields: {password: 'invalid'}}],
    ];
    for (const [username, password, status, error] of cases) {
      const response = await complete(username, password);
      expect([username, response.status, response.json]).toEqual([username, status, {error}]);
    }

    expect((await t.post('/api/auth/complete-registration', {token, username: 'Erin'})).json).toEqual(
      {error: {code: 'invalid_input', fields: {password: 'required'}}});
    expect((await t.post('/api/auth/complete-registration', {token, username: 'Erin', password: PASSWORD, x: 1}))
      .json).toEqual({error: {code: 'invalid_input'}});
    for (const bad of ['', 'x', token.slice(1), token + 'A', 42, null])
      expect((await t.post('/api/auth/complete-registration', {token: bad, username: 'Erin', password: PASSWORD}))
        .json).toEqual({error: {code: 'invalid_token'}});

    // Still good
    expect((await complete('Erin', PASSWORD)).status).toBe(201);
  });

  test('An address that got an account meanwhile makes the link invalid', async () => {
    await register(t, 'frank@example.com');
    await t.settle();
    const token = tokenIn(lastMailTo(t, 'frank@example.com').text, 'signup');
    t.app.context.auth.users.create({username: 'Frankie', usernameKey: 'frankie', email: 'FRANK@example.com',
                                     emailKey: 'frank@example.com', passwordHash: '!', locale: 'en', now: 0,
                                     loggedIn: false});
    const response = await t.post('/api/auth/complete-registration', {token, username: 'Frank', password: PASSWORD});
    expect(response.json).toEqual({error: {code: 'invalid_token'}});
  });

  test('The body is checked before the captcha, which is checked before anything else', async () => {
    const captcha = await solvedCaptcha(t, 'register');
    const post = (body: unknown) => t.post('/api/auth/register', body);

    expect((await post({locale: 'en', captcha: 'nonsense'})).json).toEqual(
      {error: {code: 'invalid_input', fields: {email: 'required'}}});
    expect((await post({email: 'x<v@e.com>', locale: 'en', captcha})).json).toEqual(
      {error: {code: 'invalid_input', fields: {email: 'invalid'}}});
    expect((await post({email: 'v@e.com', locale: 'de', captcha})).json).toEqual(
      {error: {code: 'invalid_input', fields: {locale: 'invalid'}}});
    expect((await post({email: 'v@e.com', locale: 'en', captcha, website: '', extra: true})).json).toEqual(
      {error: {code: 'invalid_input'}});
    expect((await post(['v@e.com'])).json).toEqual({error: {code: 'invalid_input'}});
    expect((await post({email: 'v@e.com', locale: 'en', captcha: 'nonsense'})).json).toEqual(
      {error: {code: 'captcha_failed'}});

    // The captcha was not used up by the refused bodies
    expect((await post({email: 'v@e.com', locale: 'en', captcha, website: ''})).status).toBe(202);
    // ...but it is now
    expect((await post({email: 'v@e.com', locale: 'en', captcha, website: ''})).json).toEqual(
      {error: {code: 'captcha_failed'}});
  });

  test('A filled honeypot gets the usual answer, and nothing is done', async () => {
    t.mailbox.clear();
    const response = await register(t, 'robot@example.com', {website: 'http://spam.example'});
    expect(response.status).toBe(202);
    expect(response.json).toEqual({ok: true});
    await t.settle();
    expect(t.mailbox.sent).toEqual([]);
    expect(t.logs.some(line => line.event === 'auth.honeypot')).toBe(true);
  });

  test('3 mails an hour per address: beyond, the same answer and no mail', async () => {
    t.mailbox.clear();
    for (let i = 0; i < 5; i++)
      expect((await register(t, 'greta@example.com')).status).toBe(202);
    await t.settle();
    expect(mailsTo(t, 'greta@example.com').length).toBe(3);
    expect(t.logs.some(line => line.event === 'mail.dropped' && line.reason === 'recipient')).toBe(true);
  });
});

describe('Registration limits and settings', () => {
  test('5 an hour per client, before the body is even read', async () => {
    const t = await startTestApp({MAIL_TRANSPORT: 'log'});
    for (let i = 0; i < 5; i++)
      expect((await register(t, `user${i}@example.com`)).status).toBe(202);
    const limited = await t.post('/api/auth/register', {nothing: 'valid'});
    expect(limited.status).toBe(429);
    expect(limited.json).toEqual({error: {code: 'rate_limited'}});
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    await t.close();
  });

  test('Closed: no captcha, no request, no link', async () => {
    const t = await startTestApp({MAIL_TRANSPORT: 'log', REGISTRATION: 'closed'});
    const closed = {error: {code: 'registration_closed'}};
    expect((await t.request('/api/captcha?action=register')).json).toEqual(closed);
    expect((await t.post('/api/auth/register', {email: 'a@example.com', locale: 'en', captcha: {}})).json)
      .toEqual(closed);
    expect((await t.post('/api/auth/complete-registration', {token: 'A'.repeat(43), username: 'abc', password: 'x'}))
      .json).toEqual(closed);
    // Logging in and resetting a password still work (accounts made by the admin)
    expect((await t.request('/api/captcha?action=login')).status).toBe(200);
    expect((await t.request('/api/captcha?action=forgot')).status).toBe(200);
    await t.close();
  });

  test('Without mail and without accounts, none of it exists', async () => {
    const t = await startTestApp();
    expect((await t.request('/api/captcha?action=register')).status).toBe(403);
    expect((await t.request('/api/captcha?action=login')).status).toBe(404);
    expect((await t.request('/api/captcha?action=forgot')).status).toBe(404);
    expect((await t.post('/api/auth/login', {login: 'a', password: 'b', captcha: {}})).status).toBe(404);
    expect((await t.post('/api/auth/forgot-password', {email: 'a@example.com', captcha: {}})).status).toBe(404);
    await t.close();
  });
});

describe('Captcha', () => {
  let t: TestApp;
  beforeAll(async () => { t = await startTestApp({...MAIL, TRUST_PROXY: '1'}); });
  afterAll(() => t.close());

  test('GET /api/captcha gives a challenge for an action', async () => {
    const response = await t.request('/api/captcha?action=login');
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(Object.keys(response.json).sort()).toEqual(['algorithm', 'challenge', 'maxnumber', 'salt', 'signature']);
    expect(response.json).toMatchObject({algorithm: 'SHA-256', maxnumber: 10,
                                         salt: expect.stringMatching(/^[0-9a-f]{32}\.\d{13}\.login$/)});
    for (const query of ['', '?action=', '?action=resend', '?action=LOGIN'])
      expect((await t.request('/api/captcha' + query)).json).toEqual(
        {error: {code: 'invalid_input', fields: {action: 'invalid'}}});
  });

  test('Refused: another action\'s, expired, forged, wrong, or used', async () => {
    const forgot = async (captcha: unknown) => t.post('/api/auth/forgot-password',
                                                      {email: 'a@example.com', captcha, website: ''});

    const forLogin = await solvedCaptcha(t, 'login');
    expect((await forgot(forLogin)).json).toEqual({error: {code: 'captcha_failed'}});

    const old = await solvedCaptcha(t, 'forgot');
    t.clock.advance(10 * MINUTE);
    expect((await forgot(old)).json).toEqual({error: {code: 'captcha_expired'}});

    const good = await solvedCaptcha(t, 'forgot');
    expect((await forgot({...good, signature: '0'.repeat(64)})).json).toEqual({error: {code: 'captcha_failed'}});
    expect((await forgot({...good, number: (good.number + 1) % 11})).json).toEqual({error: {code: 'captcha_failed'}});
    expect((await forgot(good)).status).toBe(202);
    expect((await forgot(good)).json).toEqual({error: {code: 'captcha_failed'}});

    // Logged without the number, once a minute per client
    const failures = t.logs.filter(line => line.event === 'captcha.fail');
    expect(failures.length).toBeGreaterThanOrEqual(1);
    expect(failures[0]).toMatchObject({level: 'warn', ip: '127.0.0.1', action: 'forgot'});
    expect(JSON.stringify(failures)).not.toContain('"number"');
  });

  test('Harder for a client that failed recently, and for it only', async () => {
    const challenge = async (ip: string) => (await t.request('/api/captcha?action=login', {headers: from(ip)})).json;
    expect((await challenge('198.51.100.1')).maxnumber).toBe(10);
    await t.post('/api/auth/login', {login: 'a', password: 'b', captcha: {bad: true}}, from('198.51.100.1'));
    expect((await challenge('198.51.100.1')).maxnumber).toBe(40);
    expect((await challenge('198.51.100.2')).maxnumber).toBe(10);

    // A failed login counts too
    expect((await logIn(t, 'nobody', 'wrong password!', from('198.51.100.3'))).status).toBe(401);
    expect((await challenge('198.51.100.3')).maxnumber).toBe(40);

    t.clock.advance(HOUR);
    expect((await challenge('198.51.100.1')).maxnumber).toBe(10);
  });

  test('60 challenges per 10 minutes per client', async () => {
    const t2 = await startTestApp({MAIL_TRANSPORT: 'log'});
    for (let i = 0; i < 60; i++)
      expect((await t2.request('/api/captcha?action=login')).status).toBe(200);
    expect((await t2.request('/api/captcha?action=login')).status).toBe(429);
    await t2.close();
  });
});

describe('Login', () => {
  let t: TestApp;
  let alice: {user: any; cookie: string};
  beforeAll(async () => {
    t = await startTestApp({...MAIL, TRUST_PROXY: '1'});
    alice = await signUp(t, 'alice@example.com', 'Alice');
  });
  afterAll(() => t.close());

  test('With the username or the address, in any case', async () => {
    for (const login of ['Alice', 'alice', 'ALICE@example.COM', ' alice@example.com ']) {
      const response = await logIn(t, login);
      expect(response.status).toBe(200);
      expect(response.json).toEqual({user: alice.user});
      const cookie = sessionCookie(response) as string;
      expect((await session(t, cookie)).user).toEqual(alice.user);
    }
    expect(t.db.get('SELECT last_login_at FROM users')).toEqual({last_login_at: t.clock.now()});
    expect(t.logs.filter(line => line.event === 'auth.login.ok').every(line => line.user === alice.user.id))
      .toBe(true);
  });

  test('An unknown login and a wrong password get the same answer', async () => {
    const answers = [
      await logIn(t, 'alice', 'not the password at all', from('192.0.2.10')),
      await logIn(t, 'nobody', PASSWORD, from('192.0.2.11')),
      await logIn(t, 'nobody@example.com', PASSWORD, from('192.0.2.12')),
      await logIn(t, 'x<v@e.com>', PASSWORD, from('192.0.2.13')),
    ];
    for (const answer of answers) {
      expect(answer.status).toBe(401);
      expect(visible(answer)).toEqual(visible(answers[0]));
    }
    expect(answers[0].json).toEqual({error: {code: 'invalid_credentials'}});

    // The log says which account, never what was typed
    const failures = t.logs.filter(line => line.event === 'auth.login.fail');
    expect(failures.map(line => line.user)).toEqual([alice.user.id, 'unknown', 'unknown', 'unknown']);
    expect(failures[0]).toMatchObject({reason: 'password', ip: '192.0.2.10'});
    const logText = JSON.stringify(t.logs);
    for (const typed of ['nobody', 'not the password', 'v@e.com'])
      expect(logText).not.toContain(typed);
  });

  test('After 5 failures in a row, that client waits, for that account only', async () => {
    for (const login of ['alice', 'no-such-player']) {
      const ip = login === 'alice' ? '192.0.2.20' : '192.0.2.21';
      for (let i = 0; i < 5; i++)
        expect((await logIn(t, login, 'wrong password!', from(ip))).status).toBe(401);

      // Even the right password waits; unknown accounts answer the same
      const held = await logIn(t, login, PASSWORD, from(ip));
      expect(held.status).toBe(429);
      expect(held.json).toEqual({error: {code: 'too_many_attempts'}});
      expect(held.headers['retry-after']).toBe('60');
    }

    // Another client logs in; the waiting client can still log in to another account
    expect((await logIn(t, 'alice', PASSWORD, from('192.0.2.22'))).status).toBe(200);
    expect((await logIn(t, 'alice', PASSWORD, from('192.0.2.21'))).status).toBe(200);

    // Then the waits grow
    t.clock.advance(MINUTE);
    expect((await logIn(t, 'alice', 'wrong password!', from('192.0.2.20'))).status).toBe(401);
    expect((await logIn(t, 'alice', PASSWORD, from('192.0.2.20'))).headers['retry-after']).toBe('120');
    t.clock.advance(2 * MINUTE);
    expect((await logIn(t, 'alice', PASSWORD, from('192.0.2.20'))).status).toBe(200);
  });

  test('A client waiting for one login does not wait for the other login of the same account', async () => {
    // Whether an address goes with a username must not show
    for (let i = 0; i < 5; i++)
      expect((await logIn(t, 'alice', 'wrong password!', from('192.0.2.30'))).status).toBe(401);
    expect((await logIn(t, 'alice', 'wrong password!', from('192.0.2.30'))).json).toEqual(
      {error: {code: 'too_many_attempts'}});
    for (const other of ['alice@example.com', 'ALICE@example.com', 'nobody@example.com'])
      expect((await logIn(t, other, 'wrong password!', from('192.0.2.30'))).json).toEqual(
        {error: {code: 'invalid_credentials'}});
    expect((await logIn(t, 'alice@example.com', PASSWORD, from('192.0.2.30'))).status).toBe(200);
  });

  test('Parallel attempts cannot check more passwords than the limits allow', async () => {
    const before = t.db.get<{failed_logins_day: number}>('SELECT failed_logins_day FROM users')?.failed_logins_day ?? 0;
    const ips = Array.from({length: 8}, (_, i) => `192.0.2.${100 + i}`);
    const captchas: unknown[] = [];
    for (const ip of ips)
      captchas.push(await solvedCaptcha(t, 'login', from(ip)));
    const answers = await Promise.all(ips.map((ip, i) =>
      t.post('/api/auth/login', {login: 'alice', password: 'wrong password!', captcha: captchas[i]}, from(ip))));

    const statuses = answers.map(answer => answer.status);
    const checked = statuses.filter(status => status === 401).length;
    expect(checked).toBeGreaterThanOrEqual(1);
    // Sent at once: most find a check of that account under way
    expect(statuses.filter(status => status === 429).length).toBeGreaterThanOrEqual(1);
    expect(checked + statuses.filter(status => status === 429).length).toBe(8);
    expect(answers.filter(a => a.status === 429).every(a => a.json.error.code === 'rate_limited')).toBe(true);
    // Every password checked was counted, and only those
    expect(t.db.get('SELECT failed_logins_day FROM users')).toEqual({failed_logins_day: before + checked});
  });

  test('A login replaces the browser\'s session', async () => {
    const first = sessionCookie(await logIn(t, 'alice')) as string;
    const second = await logIn(t, 'alice', PASSWORD, {Cookie: first});
    expect(second.status).toBe(200);
    expect((await session(t, first)).user).toBeNull();
    expect((await session(t, sessionCookie(second) as string)).user).toEqual(alice.user);
  });

  test('A password hashed with other settings is hashed again', async () => {
    const stronger = await new PasswordHasher({cost: 11}).hash(PASSWORD, null);
    t.db.run('UPDATE users SET password_hash = ? WHERE id = (SELECT id FROM users WHERE username_key = ?)', stronger,
             'alice');
    expect((await logIn(t, 'alice')).status).toBe(200);
    const hash = t.db.get<{password_hash: string}>('SELECT password_hash FROM users WHERE username_key = ?', 'alice');
    expect(hash?.password_hash).toMatch(/^scrypt\$10\$8\$3\$/);
    expect((await logIn(t, 'alice')).status).toBe(200);
  });

  test('The body and the captcha first', async () => {
    const captcha = await solvedCaptcha(t, 'login');
    expect((await t.post('/api/auth/login', {login: 'alice', captcha})).json).toEqual(
      {error: {code: 'invalid_input', fields: {password: 'required'}}});
    expect((await t.post('/api/auth/login', {login: ['alice'], password: PASSWORD, captcha})).json).toEqual(
      {error: {code: 'invalid_input', fields: {login: 'invalid'}}});
    expect((await t.post('/api/auth/login', {login: 'alice', password: 'x'.repeat(1025), captcha})).json).toEqual(
      {error: {code: 'invalid_input', fields: {password: 'too_long'}}});
    expect((await t.post('/api/auth/login', {login: 'alice', password: PASSWORD, captcha: {...captcha, number: -1}}))
      .json).toEqual({error: {code: 'captcha_failed'}});
    expect((await t.post('/api/auth/login', {login: 'alice', password: PASSWORD, captcha})).status).toBe(200);
  });
});

describe('Login ceiling', () => {
  test('100 failures in 24 hours lock the account, mail its owner once, and a reset unlocks it', async () => {
    const t = await startTestApp({...MAIL, TRUST_PROXY: '1'});
    await signUp(t, 'alice@example.com', 'Alice');
    t.mailbox.clear();

    let ip = 0;
    const attempt = async (login: string, password: string) => {
      // 5 failures from each address, so that no pair waits
      const client = Math.floor(ip / 5);
      const answer = await logIn(t, login, password, from(`10.1.${client >> 8}.${client & 255}`));
      ip++;
      return answer;
    };
    for (let i = 0; i < CEILING; i++)
      expect((await attempt('alice', 'wrong password!')).status).toBe(401);

    ip += 5;
    const locked = await attempt('alice', PASSWORD);
    expect(locked.status).toBe(429);
    expect(locked.json).toEqual({error: {code: 'too_many_attempts'}});
    expect(Number(locked.headers['retry-after'])).toBeGreaterThan(23 * 60 * 60);
    await t.settle();
    expect(t.mailbox.sent.map(m => m.template)).toEqual(['accountLocked']);
    expect(t.mailbox.sent[0].text).toContain('locked for 24 h');
    expect(t.logs.filter(line => line.event === 'auth.login.locked').length).toBe(1);

    // An unknown login locks the same way (in memory), without a mail
    ip = 0;
    for (let i = 0; i < CEILING; i++)
      await attempt('nobody', 'wrong password!');
    ip += 5;
    const unknown = await attempt('nobody', PASSWORD);
    expect(visible(unknown).text).toBe(visible(locked).text);
    await t.settle();
    expect(t.mailbox.sent.length).toBe(1);

    // A reset unlocks it
    const forgot = await t.post('/api/auth/forgot-password', {email: 'alice@example.com', website: '',
                                                              captcha: await solvedCaptcha(t, 'forgot')});
    expect(forgot.status).toBe(202);
    await t.settle();
    const token = tokenIn(lastMailTo(t, 'alice@example.com').text, 'reset');
    expect((await t.post('/api/auth/reset-password', {token, password: NEW_PASSWORD})).status).toBe(200);
    expect((await attempt('alice', NEW_PASSWORD)).status).toBe(200);
    await t.close();
  });
});

describe('Sessions', () => {
  test('Over https: __Host-kc_session, Secure', async () => {
    const t = await startTestApp({...MAIL, PUBLIC_URL: 'https://kawacity.example.com'});
    await register(t, 'alice@example.com');
    await t.settle();
    const text = lastMailTo(t, 'alice@example.com').text;
    expect(text).toContain('https://kawacity.example.com/#/signup/');
    const token = tokenIn(text.replace(/https:\/\/kawacity\.example\.com/g, 'http://localhost:8080'), 'signup');
    const created = await t.post('/api/auth/complete-registration', {token, username: 'Alice', password: PASSWORD});
    expect(created.headers['set-cookie']).toEqual([expect.stringMatching(
      /^__Host-kc_session=[A-Za-z0-9_-]{43}; Path=\/; Max-Age=2592000; HttpOnly; SameSite=Strict; Secure$/)]);
    const cookie = sessionCookie(created) as string;
    expect((await session(t, cookie)).user.username).toBe('Alice');
    // The plain name is not read
    expect((await session(t, cookie.replace('__Host-', ''))).user).toBeNull();
    await t.close();
  });

  test('End after 7 days unused or 30 days in all; the last use is noted at most every 5 minutes', async () => {
    const t = await startTestApp(MAIL);
    const {cookie, user} = await signUp(t, 'alice@example.com', 'Alice');
    const lastSeen = () => t.db.get<{last_seen_at: number}>('SELECT last_seen_at FROM sessions')?.last_seen_at;
    const start = t.clock.now();

    t.clock.advance(4 * MINUTE);
    expect((await session(t, cookie)).user).toEqual(user);
    expect(lastSeen()).toBe(start);
    t.clock.advance(MINUTE);
    await session(t, cookie);
    expect(lastSeen()).toBe(t.clock.now());

    for (let i = 0; i < 4; i++) {
      t.clock.advance(7 * DAY - 1);
      expect((await session(t, cookie)).user).toEqual(user);
    }
    // 30 days after the login
    t.clock.set(start + 30 * DAY);
    expect((await session(t, cookie)).user).toBeNull();

    // And 7 days without use
    const again = sessionCookie(await logIn(t, 'alice')) as string;
    t.clock.advance(7 * DAY);
    expect((await session(t, again)).user).toBeNull();
    await t.close();
  });

  test('Log out, log out everywhere', async () => {
    const t = await startTestApp(MAIL);
    const heard: SessionRevocation[] = [];
    t.app.context.auth.sessions.onRevoked(revocation => heard.push(revocation));
    const {cookie: first, user} = await signUp(t, 'alice@example.com', 'Alice');
    const second = sessionCookie(await logIn(t, 'alice')) as string;
    const third = sessionCookie(await logIn(t, 'alice')) as string;

    const out = await t.post('/api/auth/logout', {}, {Cookie: first});
    expect(out.status).toBe(204);
    expect(out.headers['set-cookie']).toEqual(['kc_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict']);
    expect((await session(t, first)).user).toBeNull();
    expect((await session(t, second)).user).toEqual(user);
    const userId = t.db.get<{id: number}>('SELECT id FROM users')?.id;
    expect(heard).toEqual([{userId, tokenHash: sha256Hex(first.split('=')[1]), except: null}]);

    // Again with the ended session: not logged in
    expect((await t.post('/api/auth/logout', {}, {Cookie: first})).json).toEqual({error: {code: 'unauthenticated'}});
    expect((await t.post('/api/auth/logout', {x: 1}, {Cookie: second})).status).toBe(400);

    const everywhere = await t.post('/api/account/logout-all', {}, {Cookie: second});
    expect(everywhere.status).toBe(204);
    expect(everywhere.headers['set-cookie']).toEqual(['kc_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict']);
    expect((await session(t, second)).user).toBeNull();
    expect((await session(t, third)).user).toBeNull();
    expect(heard[1]).toEqual({userId, tokenHash: null, except: null});
    expect(t.logs.map(line => line.event)).toEqual(expect.arrayContaining(['auth.logout', 'auth.logout_all']));
    await t.close();
  });

  test('At most 20 sessions per account', async () => {
    const t = await startTestApp(MAIL);
    const {cookie: oldest} = await signUp(t, 'alice@example.com', 'Alice');
    for (let i = 0; i < 20; i++) {
      t.clock.advance(1000);
      expect((await logIn(t, 'alice')).status).toBe(200);
    }
    expect(t.db.get('SELECT count(*) AS n FROM sessions')).toEqual({n: 20});
    expect((await session(t, oldest)).user).toBeNull();
    await t.close();
  });

  test('Account routes need a session', async () => {
    const t = await startTestApp(MAIL);
    const unauthenticated = {error: {code: 'unauthenticated'}};
    expect((await t.request('/api/account')).json).toEqual(unauthenticated);
    expect((await t.request('/api/account/export')).json).toEqual(unauthenticated);
    for (const path of ['password', 'email', 'locale', 'logout-all', 'delete'])
      expect((await t.post('/api/account/' + path, {})).json).toEqual(unauthenticated);
    expect((await t.request('/api/account', {headers: {Cookie: 'kc_session=' + 'A'.repeat(43)}})).status).toBe(401);
    await t.close();
  });
});

describe('Forgotten passwords', () => {
  let t: TestApp;
  let alice: {user: any; cookie: string};
  beforeEach(async () => {
    t = await startTestApp(MAIL);
    alice = await signUp(t, 'alice@example.com', 'Alice');
    // Past the hour of the sign-up mail (3 mails an hour per address)
    t.clock.advance(2 * HOUR);
    t.mailbox.clear();
  });
  afterEach(() => t.close());

  const forgot = async (email: string, extra = {}) =>
    t.post('/api/auth/forgot-password', {email, captcha: await solvedCaptcha(t, 'forgot'), website: '', ...extra});

  test('The same answer for any address; a link only to an account\'s', async () => {
    t.mailbox.clear();
    const known = await forgot('ALICE@example.com');
    const unknown = await forgot('nobody@example.com');
    expect(known.status).toBe(202);
    expect(visible(known)).toEqual(visible(unknown));
    await t.settle();
    expect(t.mailbox.sent.map(m => [m.to, m.template])).toEqual([['alice@example.com', 'reset']]);
    expect(t.mailbox.sent[0].text).toContain('within 1 h');
    expect(t.logs.filter(line => line.event === 'auth.password.reset_request').map(line => line.user))
      .toEqual([alice.user.id, 'unknown']);
    expect((await forgot('not an address')).json).toEqual({error: {code: 'invalid_input', fields: {email: 'invalid'}}});
  });

  test('The link sets a new password, ends every session, and works once', async () => {
    await forgot('alice@example.com');
    await t.settle();
    const token = tokenIn(lastMailTo(t, 'alice@example.com').text, 'reset');
    const reset = (password: string) => t.post('/api/auth/reset-password', {token, password});

    expect((await reset('Password1234')).json).toEqual({error: {code: 'weak_password', fields: {password: 'common'}}});
    expect((await reset('alice was here!')).json).toEqual(
      {error: {code: 'weak_password', fields: {password: 'contains_username'}}});

    t.mailbox.clear();
    const done = await reset(NEW_PASSWORD);
    expect(done.status).toBe(200);
    expect(done.json).toEqual({ok: true});
    expect(done.headers['set-cookie']).toBeUndefined();
    expect((await session(t, alice.cookie)).user).toBeNull();
    await t.settle();
    expect(t.mailbox.sent.map(m => m.template)).toEqual(['passwordChanged']);

    expect((await reset('yet another passphrase')).json).toEqual({error: {code: 'invalid_token'}});
    expect((await logIn(t, 'alice', PASSWORD)).status).toBe(401);
    alice.cookie = sessionCookie(await logIn(t, 'alice', NEW_PASSWORD)) as string;
  });

  test('Links last an hour; one used, or a password changed, ends the others', async () => {
    const links = [];
    for (let i = 0; i < 3; i++) {
      await forgot('alice@example.com');
      await t.settle();
      links.push(tokenIn(lastMailTo(t, 'alice@example.com').text, 'reset'));
    }
    t.clock.advance(HOUR);
    expect((await t.post('/api/auth/reset-password', {token: links[0], password: PASSWORD})).json).toEqual(
      {error: {code: 'invalid_token'}});

    t.clock.advance(2 * HOUR);
    const fresh = [];
    for (let i = 0; i < 2; i++) {
      await forgot('alice@example.com');
      await t.settle();
      fresh.push(tokenIn(lastMailTo(t, 'alice@example.com').text, 'reset'));
    }
    expect((await t.post('/api/auth/reset-password', {token: fresh[0], password: PASSWORD})).status).toBe(200);
    expect((await t.post('/api/auth/reset-password', {token: fresh[1], password: PASSWORD})).json).toEqual(
      {error: {code: 'invalid_token'}});

    t.clock.advance(2 * HOUR);
    await forgot('alice@example.com');
    await t.settle();
    const pending = tokenIn(lastMailTo(t, 'alice@example.com').text, 'reset');
    const cookie = sessionCookie(await logIn(t, 'alice', PASSWORD)) as string;
    expect((await t.post('/api/account/password', {currentPassword: PASSWORD, newPassword: NEW_PASSWORD},
                         {Cookie: cookie})).status).toBe(200);
    expect((await t.post('/api/auth/reset-password', {token: pending, password: PASSWORD})).json).toEqual(
      {error: {code: 'invalid_token'}});
  });

  test('Links anyone can ask for do not silence the notice of a new password', async () => {
    await register(t, 'alice@example.com');
    await register(t, 'alice@example.com');
    await forgot('alice@example.com');
    await t.settle();
    expect(mailsTo(t, 'alice@example.com').map(m => m.template)).toEqual(['alreadyRegistered', 'alreadyRegistered',
                                                                         'reset']);
    const token = tokenIn(lastMailTo(t, 'alice@example.com').text, 'reset');

    t.mailbox.clear();
    expect((await t.post('/api/auth/reset-password', {token, password: NEW_PASSWORD})).status).toBe(200);
    await t.settle();
    expect(t.mailbox.sent.map(m => m.template)).toEqual(['passwordChanged']);
  });

  test('5 requests an hour per client', async () => {
    const t2 = await startTestApp({MAIL_TRANSPORT: 'log'});
    for (let i = 0; i < 5; i++) {
      const captcha = await solvedCaptcha(t2, 'forgot');
      expect((await t2.post('/api/auth/forgot-password', {email: 'a@example.com', captcha})).status).toBe(202);
    }
    expect((await t2.post('/api/auth/forgot-password', {})).status).toBe(429);
    await t2.close();
  });
});

describe('The account', () => {
  let t: TestApp;
  let alice: {user: any; cookie: string};
  let password = PASSWORD;
  beforeEach(async () => {
    t = await startTestApp(MAIL);
    alice = await signUp(t, 'alice@example.com', 'Alice');
    password = PASSWORD;
    t.mailbox.clear();
  });
  afterEach(() => t.close());

  const post = (path: string, body: unknown, cookie = alice.cookie) => t.post(path, body, {Cookie: cookie});

  test('Changing the password needs the current one, starts a new session and ends the others', async () => {
    const heard: SessionRevocation[] = [];
    t.app.context.auth.sessions.onRevoked(revocation => heard.push(revocation));
    const other = sessionCookie(await logIn(t, 'alice')) as string;

    expect((await post('/api/account/password', {currentPassword: 'wrong password!', newPassword: NEW_PASSWORD}))
      .json).toEqual({error: {code: 'invalid_credentials'}});
    expect((await post('/api/account/password', {currentPassword: password, newPassword: 'alice-alice-alice'})).json)
      .toEqual({error: {code: 'weak_password', fields: {newPassword: 'contains_username'}}});
    expect((await post('/api/account/password', {currentPassword: password})).json).toEqual(
      {error: {code: 'invalid_input', fields: {newPassword: 'required'}}});

    const changed = await post('/api/account/password', {currentPassword: password, newPassword: NEW_PASSWORD});
    expect(changed.status).toBe(200);
    expect(changed.json).toEqual({user: alice.user});
    const rotated = sessionCookie(changed) as string;
    expect(rotated).not.toBe(alice.cookie);
    expect((await session(t, rotated)).user).toEqual(alice.user);
    expect((await session(t, alice.cookie)).user).toBeNull();
    expect((await session(t, other)).user).toBeNull();
    expect(heard).toContainEqual({userId: expect.any(Number), tokenHash: null, except: null});

    await t.settle();
    expect(t.mailbox.sent.map(m => m.template)).toEqual(['passwordChanged']);
    expect((await logIn(t, 'alice', NEW_PASSWORD)).status).toBe(200);
  });

  test('Wrong current passwords are counted by the login guard', async () => {
    for (let i = 0; i < 5; i++)
      expect((await post('/api/account/delete', {password: 'wrong password!'})).status).toBe(401);
    const held = await post('/api/account/delete', {password});
    expect(held.status).toBe(429);
    expect(held.json).toEqual({error: {code: 'too_many_attempts'}});
  });

  test('Changing the address: a link to the new one, a notice to the old one', async () => {
    const change = (newEmail: string, currentPassword = password) =>
      post('/api/account/email', {currentPassword, newEmail});

    expect((await change('alice.new@example.com', 'wrong password!')).json).toEqual(
      {error: {code: 'invalid_credentials'}});
    expect((await change('not an address')).json).toEqual(
      {error: {code: 'invalid_input', fields: {newEmail: 'invalid'}}});

    const asked = await change('Alice.New@example.com');
    expect(asked.status).toBe(202);
    expect(asked.json).toEqual({ok: true});
    await t.settle();
    expect(t.mailbox.sent.map(m => [m.to, m.template])).toEqual([['alice@example.com', 'emailChangeNotice'],
                                                                  ['Alice.New@example.com', 'emailChangeConfirm']]);
    const token = tokenIn(t.mailbox.sent[1].text, 'email');
    // Not changed until confirmed
    expect((await t.request('/api/account', {headers: {Cookie: alice.cookie}})).json.user.email)
      .toBe('alice@example.com');

    t.mailbox.clear();
    // Confirmed without a session: the link is enough
    const confirmed = await t.post('/api/auth/confirm-email-change', {token});
    expect(confirmed.status).toBe(200);
    expect(confirmed.json).toEqual({ok: true});
    expect((await t.request('/api/account', {headers: {Cookie: alice.cookie}})).json.user.email)
      .toBe('Alice.New@example.com');
    await t.settle();
    expect(t.mailbox.sent.map(m => [m.to, m.template])).toEqual([['alice@example.com', 'emailChanged']]);

    expect((await t.post('/api/auth/confirm-email-change', {token})).json).toEqual({error: {code: 'invalid_token'}});
    expect((await logIn(t, 'alice.new@example.com')).status).toBe(200);
    expect((await logIn(t, 'alice@example.com')).status).toBe(401);
    expect(t.logs.map(line => line.event)).toEqual(
      expect.arrayContaining(['auth.email.change_request', 'auth.email.change']));
  });

  test('An address already in use: the same answer, and the same notice to the account\'s address', async () => {
    await signUp(t, 'bob@example.com', 'Bob');
    t.mailbox.clear();
    const taken = await post('/api/account/email', {currentPassword: password, newEmail: 'BOB@example.com'});
    await t.settle();
    const free = await post('/api/account/email', {currentPassword: password, newEmail: 'free@example.com'});
    await t.settle();
    expect(visible(taken)).toEqual(visible(free));
    // The notice first, then one mail to the new address either way (so that the notice, and the mails queued after,
    // do not go later for a free address): no link to the address in use, but a word to its account
    expect(t.mailbox.sent.map(m => [m.to, m.template])).toEqual([['alice@example.com', 'emailChangeNotice'],
                                                                  ['bob@example.com', 'emailChangeTaken'],
                                                                  ['alice@example.com', 'emailChangeNotice'],
                                                                  ['free@example.com', 'emailChangeConfirm']]);
    const [first, second] = mailsTo(t, 'alice@example.com');
    expect([first.subject, first.text, first.html]).toEqual([second.subject, second.text, second.html]);
    // Nothing of the requester in it
    const word = lastMailTo(t, 'bob@example.com');
    expect(word.text).toContain('Hello Bob,');
    expect(word.text).not.toMatch(/alice|#\//i);
    expect(t.app.context.db.get('SELECT COUNT(*) AS n FROM email_tokens WHERE purpose = \'email_change\'')).toEqual({n: 1});

    // Under the limits of a link: 3 an hour to an address (Bob's had its sign-up link)
    t.mailbox.clear();
    for (let i = 0; i < 2; i++)
      await post('/api/account/email', {currentPassword: password, newEmail: 'bob@example.com'});
    await t.settle();
    expect(mailsTo(t, 'bob@example.com').length).toBe(1);
    expect(mailsTo(t, 'alice@example.com').length).toBe(2);
  });

  test('The notice goes even when the link to the new address is not sent', async () => {
    // 3 links an hour to an address: the fourth request gets no link, but its notice
    for (let i = 0; i < 4; i++)
      await post('/api/account/email', {currentPassword: password, newEmail: 'busy@example.com'});
    await t.settle();
    expect(mailsTo(t, 'busy@example.com').length).toBe(3);
    expect(mailsTo(t, 'alice@example.com').map(m => m.template)).toEqual(Array(4).fill('emailChangeNotice'));
  });

  test('An address taken before the confirmation makes the link invalid', async () => {
    await post('/api/account/email', {currentPassword: password, newEmail: 'carol@example.com'});
    await t.settle();
    const token = tokenIn(lastMailTo(t, 'carol@example.com').text, 'email');
    await signUp(t, 'carol@example.com', 'Carol');
    expect((await t.post('/api/auth/confirm-email-change', {token})).json).toEqual({error: {code: 'invalid_token'}});
    expect((await t.request('/api/account', {headers: {Cookie: alice.cookie}})).json.user.email)
      .toBe('alice@example.com');
  });

  test('A confirmed address ends the reset links, and a new request the earlier confirmation link', async () => {
    await t.post('/api/auth/forgot-password', {email: 'alice@example.com', captcha: await solvedCaptcha(t, 'forgot')});
    await t.settle();
    const reset = tokenIn(lastMailTo(t, 'alice@example.com').text, 'reset');

    await post('/api/account/email', {currentPassword: password, newEmail: 'first@example.com'});
    await post('/api/account/email', {currentPassword: password, newEmail: 'second@example.com'});
    await t.settle();
    const first = tokenIn(lastMailTo(t, 'first@example.com').text, 'email');
    const second = tokenIn(lastMailTo(t, 'second@example.com').text, 'email');
    expect((await t.post('/api/auth/confirm-email-change', {token: first})).json).toEqual(
      {error: {code: 'invalid_token'}});
    expect((await t.post('/api/auth/confirm-email-change', {token: second})).status).toBe(200);
    expect((await t.post('/api/auth/reset-password', {token: reset, password: NEW_PASSWORD})).json).toEqual(
      {error: {code: 'invalid_token'}});
  });

  test('Confirmation links last 24 hours', async () => {
    await post('/api/account/email', {currentPassword: password, newEmail: 'late@example.com'});
    await t.settle();
    const token = tokenIn(lastMailTo(t, 'late@example.com').text, 'email');
    t.clock.advance(DAY);
    expect((await t.post('/api/auth/confirm-email-change', {token})).json).toEqual({error: {code: 'invalid_token'}});
    expect((await t.post('/api/auth/confirm-email-change', {token: 'nope'})).json).toEqual(
      {error: {code: 'invalid_token'}});
  });

  test('The language of the account\'s mails', async () => {
    const changed = await post('/api/account/locale', {locale: 'fr'});
    expect(changed.status).toBe(200);
    expect(changed.json).toEqual({user: {...alice.user, locale: 'fr'}});
    expect((await post('/api/account/locale', {locale: 'es'})).json).toEqual(
      {error: {code: 'invalid_input', fields: {locale: 'invalid'}}});

    await t.post('/api/auth/forgot-password', {email: 'alice@example.com', captcha: await solvedCaptcha(t, 'forgot')});
    await t.settle();
    expect(lastMailTo(t, 'alice@example.com').subject).toBe(I18n.translate('fr', EMAIL_TEXTS.reset.subject));
  });

  test('The export holds the account and its sessions, never a hash or a token', async () => {
    const userId = t.db.get<{id: number}>('SELECT id FROM users')?.id;
    t.app.context.auth.addExportSection('cities', id => [{owner: id === userId ? 'me' : 'other'}]);
    const exported = await t.request('/api/account/export', {headers: {Cookie: alice.cookie}});
    expect(exported.status).toBe(200);
    expect(exported.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(exported.headers['content-disposition']).toBe(
      'attachment; filename="kawacity-Alice.json"; filename*=UTF-8\'\'kawacity-Alice.json');
    const data = JSON.parse(exported.text);
    expect(data).toEqual({
      exportedAt: new Date(t.clock.now()).toISOString(),
      account: {id: alice.user.id, username: 'Alice', email: 'alice@example.com', locale: 'en',
                createdAt: new Date(alice.user.createdAt).toISOString(),
                updatedAt: expect.any(String), lastLoginAt: expect.any(String)},
      sessions: [{createdAt: expect.any(String), lastSeenAt: expect.any(String), expiresAt: expect.any(String),
                  current: true}],
      pendingEmailChange: null,
      loginProtection: {failedLogins: 0, windowStart: null, lockedUntil: null},
      cities: [{owner: 'me'}],
    });
    const hashes = t.db.all<{token_hash: string}>('SELECT token_hash FROM sessions').map(row => row.token_hash);
    for (const secret of ['scrypt', alice.cookie.split('=')[1], ...hashes, 'password'])
      expect(exported.text).not.toContain(secret);
  });

  test('The export holds the address waiting for its confirmation, and the failed logins', async () => {
    const start = t.clock.now();
    for (let i = 0; i < 2; i++)
      expect((await logIn(t, 'alice', 'wrong password!')).status).toBe(401);
    t.clock.advance(MINUTE);
    expect((await post('/api/account/email', {currentPassword: password, newEmail: 'New@example.net'})).status)
      .toBe(202);
    await t.settle();

    const exported = await t.request('/api/account/export', {headers: {Cookie: alice.cookie}});
    const data = JSON.parse(exported.text);
    expect(data.pendingEmailChange).toEqual({newEmail: 'New@example.net',
                                             requestedAt: new Date(start + MINUTE).toISOString(),
                                             expiresAt: new Date(start + MINUTE + DAY).toISOString()});
    expect(data.loginProtection).toEqual({failedLogins: 2, windowStart: new Date(start).toISOString(),
                                          lockedUntil: null});
    // Never the token, nor its hash
    const token = tokenIn(lastMailTo(t, 'New@example.net').text, 'email');
    for (const secret of [token, sha256Hex(token)])
      expect(exported.text).not.toContain(secret);

    // Gone once confirmed
    expect((await t.post('/api/auth/confirm-email-change', {token})).status).toBe(200);
    expect(JSON.parse((await t.request('/api/account/export', {headers: {Cookie: alice.cookie}})).text)
      .pendingEmailChange).toBeNull();
  });

  test('Deleting the account needs the password, and takes everything with it', async () => {
    const hooks: [number, boolean][] = [];
    t.app.context.auth.onAccountDeleting(userId => hooks.push([userId, t.db.inTransaction]));
    const heard: SessionRevocation[] = [];
    t.app.context.auth.sessions.onRevoked(revocation => heard.push(revocation));
    const userId = t.db.get<{id: number}>('SELECT id FROM users')?.id as number;

    expect((await post('/api/account/delete', {password: 'wrong password!'})).json).toEqual(
      {error: {code: 'invalid_credentials'}});
    expect((await post('/api/account/delete', {})).json).toEqual(
      {error: {code: 'invalid_input', fields: {password: 'required'}}});
    expect(hooks).toEqual([]);

    const deleted = await post('/api/account/delete', {password});
    expect(deleted.status).toBe(204);
    expect(deleted.headers['set-cookie']).toEqual(['kc_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict']);
    expect(hooks).toEqual([[userId, true]]);
    expect(heard).toEqual([{userId, tokenHash: null, except: null}]);
    for (const table of ['users', 'sessions', 'email_tokens', 'signup_tokens'])
      expect(t.db.all(`SELECT * FROM ${table}`)).toEqual([]);
    expect((await session(t, alice.cookie)).user).toBeNull();
    expect((await logIn(t, 'alice')).status).toBe(401);
    expect(t.logs.find(line => line.event === 'account.delete')).toMatchObject({user: alice.user.id});

    // The address is free again
    t.mailbox.clear();
    await register(t, 'alice@example.com');
    await t.settle();
    expect(t.mailbox.sent.map(m => m.template)).toEqual(['signup']);
  });

  test('Address changes: 10 an hour per account, whatever its sessions, counted once the password is right',
       async () => {
    const own = sessionCookie(await logIn(t, 'alice')) as string;
    // Wrong passwords (the login guard's) and bad requests do not count against it
    expect((await post('/api/account/email', {currentPassword: 'wrong password!', newEmail: 'x@example.com'}, own))
      .status).toBe(401);
    expect((await post('/api/account/email', {currentPassword: password, newEmail: 'nope'}, own)).status).toBe(400);

    const statuses = [];
    let cookie = alice.cookie;
    for (let i = 0; i < 12; i++) {
      // A new session every 3 changes: each login makes one
      if (i % 3 === 0)
        cookie = sessionCookie(await logIn(t, 'alice')) as string;
      statuses.push((await post('/api/account/email', {currentPassword: password, newEmail: `n${i}@example.com`},
                                cookie)).status);
    }
    expect(statuses).toEqual([...Array(10).fill(202), 429, 429]);
    expect(t.logs.some(line => line.event === 'rate_limited' && line.limit === 'account-email')).toBe(true);
    await t.settle();
    expect(t.mailbox.sent.filter(m => m.template === 'emailChangeConfirm').length).toBe(10);
    // The other changes still work
    expect((await post('/api/account/password', {currentPassword: password, newPassword: NEW_PASSWORD}, own)).status)
      .toBe(200);
  });

  test('Account changes: 10 an hour per session', async () => {
    const statuses = [];
    for (let i = 0; i < 11; i++)
      statuses.push((await post('/api/account/delete', {password: 'x'})).status);
    // The login guard holds the account after 5 failures; the 11th is refused by the limit itself
    expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(statuses[10]).toBe(429);
    expect(t.logs.some(line => line.event === 'rate_limited' && line.limit === 'account')).toBe(true);
  });

  test('A session (a stolen one, say) cannot keep the others from logging out everywhere or changing the password',
       async () => {
    const useUp = async (cookie: string) => {
      for (let i = 0; i < 10; i++)
        expect((await post('/api/account/delete', {}, cookie)).status).toBe(400);
      expect((await post('/api/account/delete', {}, cookie)).status).toBe(429);
    };

    const stolen = alice.cookie;
    const own = sessionCookie(await logIn(t, 'alice')) as string;
    await useUp(stolen);
    expect((await post('/api/account/logout-all', {}, own)).status).toBe(204);
    expect((await session(t, stolen)).user).toBeNull();

    const stolenAgain = sessionCookie(await logIn(t, 'alice')) as string;
    const ownAgain = sessionCookie(await logIn(t, 'alice')) as string;
    await useUp(stolenAgain);
    expect((await post('/api/account/password', {currentPassword: password, newPassword: NEW_PASSWORD}, ownAgain))
      .status).toBe(200);
    expect((await session(t, stolenAgain)).user).toBeNull();
  });
});

describe('A password reset made while a password is checked', () => {
  let t: TestApp;
  let alice: {user: any; cookie: string};
  beforeEach(async () => {
    t = await startTestApp(MAIL);
    alice = await signUp(t, 'alice@example.com', 'Alice');
    // Past the hour of the sign-up mail
    t.clock.advance(2 * HOUR);
  });
  afterEach(() => t.close());

  // The next password check, once its hash is computed, waits until release() (the time a hash takes in production)
  const holdNextCheck = () => {
    const passwords = t.app.context.auth.passwords;
    const verify = passwords.verify.bind(passwords);
    let reached = () => {};
    let release = () => {};
    const checked = new Promise<void>(resolve => { reached = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    passwords.verify = async (...args) => {
      passwords.verify = verify;
      const matches = await verify(...args);
      reached();
      await gate;
      return matches;
    };
    return {checked, release};
  };

  // The owner resets the password with the link of a mail: every session ends
  const reset = async () => {
    await t.post('/api/auth/forgot-password', {email: 'alice@example.com', website: '',
                                               captcha: await solvedCaptcha(t, 'forgot')});
    await t.settle();
    const token = tokenIn(lastMailTo(t, 'alice@example.com').text, 'reset');
    expect((await t.post('/api/auth/reset-password', {token, password: NEW_PASSWORD})).status).toBe(200);
    await t.settle();
    t.mailbox.clear();
  };

  // The owner's new password works, and nobody else has a session
  const resetHolds = async () => {
    expect(t.db.get('SELECT count(*) AS n FROM sessions')).toEqual({n: 0});
    expect((await logIn(t, 'alice', PASSWORD)).status).toBe(401);
    expect((await logIn(t, 'alice', NEW_PASSWORD)).status).toBe(200);
  };

  test('A login with the old password makes no session', async () => {
    const {checked, release} = holdNextCheck();
    const login = logIn(t, 'alice', PASSWORD);
    await checked;
    await reset();
    release();
    const answer = await login;
    expect(answer.json).toEqual({error: {code: 'invalid_credentials'}});
    expect(sessionCookie(answer)).toBeNull();
    await resetHolds();
  });

  test('A password change with the old password does not undo it', async () => {
    const {checked, release} = holdNextCheck();
    const change = t.post('/api/account/password', {currentPassword: PASSWORD, newPassword: 'the intruder\'s own phrase'},
                          {Cookie: alice.cookie});
    await checked;
    await reset();
    release();
    const answer = await change;
    expect(answer.json).toEqual({error: {code: 'unauthenticated'}});
    expect(sessionCookie(answer)).toBeNull();
    await resetHolds();
  });

  test('An address change with the old password sends no link, and makes no token', async () => {
    const {checked, release} = holdNextCheck();
    const change = t.post('/api/account/email', {currentPassword: PASSWORD, newEmail: 'mallory@evil.example'},
                          {Cookie: alice.cookie});
    await checked;
    await reset();
    release();
    expect((await change).status).toBe(202);
    await t.settle();
    expect(t.mailbox.sent).toEqual([]);
    expect(t.db.all('SELECT * FROM email_tokens')).toEqual([]);
    expect(t.logs.find(line => line.event === 'auth.email.change_request')).toMatchObject({stale: true});
    await resetHolds();
  });

  test('Deleting the account with the old password does not', async () => {
    const {checked, release} = holdNextCheck();
    const deletion = t.post('/api/account/delete', {password: PASSWORD}, {Cookie: alice.cookie});
    await checked;
    await reset();
    release();
    expect((await deletion).json).toEqual({error: {code: 'unauthenticated'}});
    expect(t.db.get('SELECT count(*) AS n FROM users')).toEqual({n: 1});
    await resetHolds();
  });
});

describe('A deleted account', () => {
  test('Leaves nothing of itself in the database files', async () => {
    const directory = temporaryDirectory();
    const file = path.join(directory, 'kawacity.db');
    const db = new Database(file);
    migrate(db, MIGRATIONS, {backupDirectory: path.join(directory, 'backups'), now: 0});
    const t = await startTestApp(MAIL, {db});
    await signUp(t, 'stays@example.com', 'Stays');
    const gone = await signUp(t, 'gone.player@example.org', 'GonePlayer');
    expect((await t.post('/api/account/delete', {password: PASSWORD}, {Cookie: gone.cookie})).status).toBe(204);

    const bytes = [file, file + '-wal'].filter(name => existsSync(name))
      .map(name => readFileSync(name).toString('latin1')).join('');
    expect(bytes).toContain('stays@example.com');
    for (const text of ['GonePlayer', 'goneplayer', 'gone.player@example.org', gone.user.id])
      expect(bytes).not.toContain(text);
    await t.close();
  });
});
