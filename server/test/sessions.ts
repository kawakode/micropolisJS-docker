/* KawaCity, a modified version of micropolisJS.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

import { MAX_SESSIONS_PER_USER, revokes, SessionRevocation, Sessions, TOUCH_INTERVAL } from '../auth/sessions';
import { Users } from '../auth/users';
import { FakeClock } from '../clock';
import { createLogger } from '../log';
import { sha256Hex } from '../security/tokens';
import { testDatabase } from '../testing';

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

const setUp = (secure = false) => {
  const db = testDatabase();
  const clock = new FakeClock();
  const logs: any[] = [];
  const log = createLogger({level: 'debug', clock, write: line => logs.push(JSON.parse(line))});
  const sessions = new Sessions(db, clock, log, {secure, idleDays: 7, maxDays: 30});
  const users = new Users(db);
  const user = (name: string) => users.create({username: name, usernameKey: name.toLowerCase(),
                                                email: `${name}@example.com`,
                                                emailKey: `${name.toLowerCase()}@example.com`,
                                                passwordHash: '!', locale: 'en', now: clock.now(), loggedIn: true});
  return {db, clock, sessions, user, logs};
};

const cookies = (name: string, token: string) => new Map([[name, token]]);

describe('Sessions', () => {
  test('A random token, of which only the hash is stored', () => {
    const {db, sessions, user} = setUp();
    const alice = user('Alice');
    const {token, session} = sessions.create(alice.id);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(session.tokenHash).toBe(sha256Hex(token));
    expect(db.all('SELECT token_hash FROM sessions')).toEqual([{token_hash: sha256Hex(token)}]);

    const resolved = sessions.resolve(cookies('kc_session', token));
    expect(resolved?.user).toEqual({id: alice.id, publicId: alice.public_id, username: 'Alice',
                                    email: 'Alice@example.com', locale: 'en', createdAt: alice.created_at});
    expect(resolved?.session).toEqual(session);

    for (const wrong of ['', 'x', token.slice(1), token + 'x', session.tokenHash])
      expect(sessions.resolve(cookies('kc_session', wrong))).toBeNull();
    // Another cookie name than this server's
    expect(sessions.resolve(cookies('__Host-kc_session', token))).toBeNull();
  });

  test('The cookie: HttpOnly, SameSite=Strict, and __Host- with Secure over https', () => {
    expect(setUp(false).sessions.cookie('T')).toBe('kc_session=T; Path=/; Max-Age=2592000; HttpOnly; SameSite=Strict');
    expect(setUp(false).sessions.clearCookie()).toBe('kc_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict');
    const secure = setUp(true).sessions;
    expect(secure.cookieName).toBe('__Host-kc_session');
    expect(secure.cookie('T')).toBe('__Host-kc_session=T; Path=/; Max-Age=2592000; HttpOnly; SameSite=Strict; Secure');
    expect(secure.clearCookie()).toBe('__Host-kc_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict; Secure');
  });

  test('Ends after 7 days unused, its last use noted at most every 5 minutes', () => {
    const {db, clock, sessions, user} = setUp();
    const {token, session} = sessions.create(user('Alice').id);
    const lastSeen = () => db.get<{last_seen_at: number}>('SELECT last_seen_at FROM sessions')?.last_seen_at;

    clock.advance(TOUCH_INTERVAL - 1);
    expect(sessions.resolveToken(token)).not.toBeNull();
    expect(lastSeen()).toBe(session.createdAt);
    clock.advance(1);
    expect(sessions.resolveToken(token)?.session.lastSeenAt).toBe(clock.now());
    expect(lastSeen()).toBe(clock.now());
    // Not noted when asked not to
    clock.advance(TOUCH_INTERVAL);
    expect(sessions.resolveToken(token, false)).not.toBeNull();
    expect(lastSeen()).toBe(clock.now() - TOUCH_INTERVAL);

    clock.advance(7 * DAY - TOUCH_INTERVAL - 1);
    expect(sessions.resolveToken(token, false)).not.toBeNull();
    clock.advance(1);
    expect(sessions.resolveToken(token)).toBeNull();
    expect(db.all('SELECT * FROM sessions')).toEqual([]);
  });

  test('Ends after 30 days in any case', () => {
    const {clock, sessions, user} = setUp();
    const {token} = sessions.create(user('Alice').id);
    for (let day = 0; day < 29; day++) {
      clock.advance(DAY);
      expect(sessions.resolveToken(token)).not.toBeNull();
    }
    clock.advance(DAY - 1);
    expect(sessions.resolveToken(token)).not.toBeNull();
    clock.advance(1);
    expect(sessions.resolveToken(token)).toBeNull();
  });

  test('At most 20 per user: a new one replaces the oldest', () => {
    const {clock, sessions, user} = setUp();
    const alice = user('Alice');
    const bob = user('Bob');
    const bobs = sessions.create(bob.id);
    const tokens: string[] = [];
    for (let i = 0; i < MAX_SESSIONS_PER_USER; i++) {
      tokens.push(sessions.create(alice.id).token);
      clock.advance(1);
    }
    expect(sessions.forUser(alice.id).length).toBe(20);

    const newest = sessions.create(alice.id);
    expect(newest.replaced).toEqual([{userId: alice.id, tokenHash: sha256Hex(tokens[0]), except: null}]);
    expect(sessions.forUser(alice.id).length).toBe(20);
    expect(sessions.resolveToken(tokens[0])).toBeNull();
    expect(sessions.resolveToken(tokens[1])).not.toBeNull();
    expect(sessions.resolveToken(bobs.token)).not.toBeNull();
  });

  test('Ending sessions tells the listeners', () => {
    const {sessions, user, logs} = setUp();
    const alice = user('Alice');
    const bob = user('Bob');
    const heard: SessionRevocation[] = [];
    const stop = sessions.onRevoked(revocation => heard.push(revocation));
    sessions.onRevoked(() => { throw new Error('a broken listener'); });

    const a1 = sessions.create(alice.id);
    const a2 = sessions.create(alice.id);
    const a3 = sessions.create(alice.id);
    const b1 = sessions.create(bob.id);

    sessions.revoke(a1.session);
    expect(heard).toEqual([{userId: alice.id, tokenHash: a1.session.tokenHash, except: null}]);
    expect(sessions.resolveToken(a1.token)).toBeNull();

    sessions.revokeAll(alice.id, a3.session.tokenHash);
    expect(heard[1]).toEqual({userId: alice.id, tokenHash: null, except: a3.session.tokenHash});
    expect(sessions.resolveToken(a2.token)).toBeNull();
    expect(sessions.resolveToken(a3.token)).not.toBeNull();

    sessions.revokeAll(alice.id);
    expect(heard[2]).toEqual({userId: alice.id, tokenHash: null, except: null});
    expect(sessions.resolveToken(a3.token)).toBeNull();
    expect(sessions.resolveToken(b1.token)).not.toBeNull();
    expect(logs.filter(line => line.event === 'session.listener_error').length).toBe(3);

    stop();
    sessions.revokeAll(bob.id);
    expect(heard.length).toBe(3);
  });

  test('revokes() tells which sessions a revocation ends', () => {
    expect(revokes({userId: 1, tokenHash: 'a', except: null}, 1, 'a')).toBe(true);
    expect(revokes({userId: 1, tokenHash: 'a', except: null}, 1, 'b')).toBe(false);
    expect(revokes({userId: 1, tokenHash: null, except: null}, 1, 'b')).toBe(true);
    expect(revokes({userId: 1, tokenHash: null, except: 'b'}, 1, 'b')).toBe(false);
    expect(revokes({userId: 1, tokenHash: null, except: 'b'}, 1, 'c')).toBe(true);
    expect(revokes({userId: 1, tokenHash: null, except: null}, 2, 'b')).toBe(false);
  });

  test('Deleting the user deletes their sessions', () => {
    const {sessions, user, db} = setUp();
    const alice = user('Alice');
    const {token} = sessions.create(alice.id);
    new Users(db).delete(alice.id);
    expect(sessions.resolveToken(token)).toBeNull();
    expect(db.all('SELECT * FROM sessions')).toEqual([]);
  });
});
