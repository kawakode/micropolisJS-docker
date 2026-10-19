/* KawaCity, a modified version of micropolisJS.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { CITY_LIMITS, decodeState, PALETTE } from '../game/cityStore';
import { validateSave } from '../game/saveValidation';
import { freshCitySave, sampleCity } from '../gameTesting';
import { addMember, addPlayer, createCity, join, Player } from '../multiplayerTesting';
import { cleanUp, startTestApp, TestApp } from '../testing';

// The lobby of the shared cities: who may see and do what, the limits, the invitations

afterAll(cleanUp);

const HOUR = 60 * 60 * 1000;
const OTHER_ID = 'AAAAAAAAAAAAAAAAAAAAAA';

describe('Shared cities', () => {
  let t: TestApp;
  beforeEach(async () => { t = await startTestApp({MAIL_TRANSPORT: 'log'}); });
  afterEach(() => t.close());

  test('A session is required; GET /api/session offers multiplayer with accounts', async () => {
    expect((await t.request('/api/cities')).status).toBe(401);
    expect((await t.post('/api/cities', {})).status).toBe(401);
    expect((await t.request('/api/regions')).status).toBe(401);
    expect((await t.request('/api/session')).json.features.multiplayer).toBe(true);
  });

  test('Making a city: the lobby lists it for its owner, and no one else', async () => {
    const alice = addPlayer(t, 'Alice');
    const bob = addPlayer(t, 'Bob');
    expect((await alice.get('/api/cities')).json).toEqual({cities: [], invitations: []});

    const save = freshCitySave('Ignored', 0, 7);
    const response = await alice.post('/api/cities', {name: '  Kawa‮ Town ', level: 2, save});
    expect(response.status).toBe(201);
    const city = response.json.city;
    expect(city).toEqual({id: expect.stringMatching(/^[A-Za-z0-9_-]{22}$/), name: 'Kawa Town', role: 'owner',
                          ownerName: 'Alice', population: expect.any(Number), year: 1900, online: 0, region: null});

    expect((await alice.get('/api/cities')).json.cities).toEqual([city]);
    expect((await bob.get('/api/cities')).json.cities).toEqual([]);

    // Its save: the name given, the level chosen, no scenario
    const row = t.db.get<{state: Uint8Array; owner_id: number}>('SELECT state, owner_id FROM cities');
    const stored = decodeState(row!.state);
    expect([stored.name, stored._gameLevel, stored.scenario, stored.version]).toEqual(['Kawa Town', 2, null, 4]);
    expect(row!.owner_id).toBe(alice.id);
    expect(validateSave(stored)).toBeTruthy();
  });

  test('A sample city and a saved game can be shared', async () => {
    const alice = addPlayer(t);
    expect((await alice.post('/api/cities', {name: 'Kobe', level: 0, save: sampleCity('kobe')})).status).toBe(201);
    const city = (await alice.get('/api/cities')).json.cities[0];
    expect(city.population).toBeGreaterThan(10000);
  });

  test('What is sent is checked', async () => {
    const alice = addPlayer(t);
    const save = freshCitySave();
    const fails = async (body: unknown) => (await alice.post('/api/cities', body)).json;

    expect(await fails({name: '', level: 0, save})).toEqual({error: {code: 'invalid_input', fields: {name: 'required'}}});
    expect(await fails({name: '​ ', level: 0, save}))
      .toEqual({error: {code: 'invalid_input', fields: {name: 'required'}}});
    expect(await fails({name: 'x'.repeat(16), level: 0, save}))
      .toEqual({error: {code: 'invalid_input', fields: {name: 'too_long'}}});
    expect(await fails({name: 5, level: 0, save})).toEqual({error: {code: 'invalid_input', fields: {name: 'invalid'}}});
    expect(await fails({name: 'A', level: 3, save})).toEqual({error: {code: 'invalid_input', fields: {level: 'invalid'}}});
    expect(await fails({name: 'A', level: 0, save: {...save, admin: true}}))
      .toEqual({error: {code: 'invalid_input', fields: {save: 'invalid'}}});
    expect(await fails({name: 'A', level: 0, save: {...save, totalFunds: 1e300}}))
      .toEqual({error: {code: 'invalid_input', fields: {save: 'invalid'}}});
    expect(await fails({name: 'A', level: 0, save, extra: 1})).toEqual({error: {code: 'invalid_input'}});
    expect(await fails({name: 'A', level: 0})).toEqual({error: {code: 'invalid_input', fields: {save: 'required'}}});
    expect(await fails({name: 'A', level: 0, save, region: {id: 'x', x: 9, y: 0}}))
      .toEqual({error: {code: 'invalid_input', fields: {region: 'invalid'}}});

    // A body up to 1 MiB
    const big = await addPlayer(t).post('/api/cities', {name: 'A', level: 0, save, pad: 'x'.repeat(1024 * 1024)});
    expect(big.status).toBe(413);
    expect(t.db.get<{n: number}>('SELECT count(*) AS n FROM cities')?.n).toBe(0);
  });

  test('Limits: 5 cities owned, MAX_CITIES in all, 10 made an hour', async () => {
    const alice = addPlayer(t);
    for (let i = 0; i < CITY_LIMITS.ownedCities; i++)
      await createCity(alice, {name: 'City ' + i});
    const sixth = await alice.post('/api/cities', {name: 'Sixth', level: 0, save: freshCitySave()});
    expect([sixth.status, sixth.json.error.code]).toEqual([403, 'limit_reached']);

    // Deleting one makes room (but only 10 tries an hour)
    const first = (await alice.get('/api/cities')).json.cities[0];
    expect((await alice.post(`/api/cities/${first.id}/delete`)).status).toBe(204);
    await createCity(alice);
    for (const city of (await alice.get('/api/cities')).json.cities)
      expect((await alice.post(`/api/cities/${city.id}/delete`)).status).toBe(204);
    for (let i = 0; i < 3; i++)
      await createCity(alice);
    expect((await alice.post('/api/cities', {name: 'Late', level: 0, save: freshCitySave()})).status).toBe(429);
    // A sliding window: two hours later
    t.clock.advance(2 * HOUR);
    await createCity(alice);
  });

  test('MAX_CITIES: the server is busy beyond', async () => {
    const small = await startTestApp({MAX_CITIES: '1'});
    const alice = addPlayer(small);
    await createCity(alice);
    const response = await addPlayer(small).post('/api/cities', {name: 'Two', level: 0, save: freshCitySave()});
    expect([response.status, response.json.error.code]).toEqual([503, 'server_busy']);
    await small.close();
  });

  test('Someone who is not a member is told the city does not exist; members only do what their role allows',
       async () => {
    const alice = addPlayer(t, 'Alice');
    const bob = addPlayer(t, 'Bob');
    const carol = addPlayer(t, 'Carol');
    const city = await createCity(alice, {name: 'Secret'});
    expect((await addMember(alice, city.id, bob, 'player')).status).toBe(200);

    const attempts: [string, string, unknown?][] = [
      ['GET', `/api/cities/${city.id}`],
      ['PATCH', `/api/cities/${city.id}`, {name: 'Mine'}],
      ['POST', `/api/cities/${city.id}/delete`, {}],
      ['GET', `/api/cities/${city.id}/save`],
      ['POST', `/api/cities/${city.id}/invitations`, {username: 'Carol', role: 'player'}],
      ['POST', `/api/cities/${city.id}/members/${bob.publicId}`, {role: 'viewer'}],
      ['POST', `/api/cities/${city.id}/members/${bob.publicId}/remove`, {}],
    ];
    const send = (player: Player, [method, path, body]: [string, string, unknown?]) =>
      method === 'GET' ? player.get(path) : method === 'PATCH' ? player.patch(path, body) : player.post(path, body);

    for (const attempt of attempts) {
      const response = await send(carol, attempt);
      expect([attempt[1], response.status, response.json?.error?.code]).toEqual([attempt[1], 404, 'not_found']);
    }
    // Ids that are not ids, and ids of nothing
    for (const id of [OTHER_ID, 'nope', '../cities', city.id + 'x'])
      expect((await alice.get(`/api/cities/${encodeURIComponent(id)}`)).status).toBe(404);

    // A player sees the city, downloads it, but owns nothing of it
    expect((await bob.get(`/api/cities/${city.id}`)).status).toBe(200);
    expect((await bob.get(`/api/cities/${city.id}/save`)).status).toBe(200);
    for (const attempt of attempts.slice(1, 6).filter(a => a[0] !== 'GET')) {
      const response = await send(bob, attempt);
      expect([attempt[1], response.status, response.json?.error?.code]).toEqual([attempt[1], 403, 'forbidden']);
    }
    // ...and cannot remove the owner
    const owner = await bob.post(`/api/cities/${city.id}/members/${alice.publicId}/remove`);
    expect(owner.status).toBe(403);
    expect((await alice.get(`/api/cities/${city.id}`)).json.city.name).toBe('Secret');
  });

  test('The city as its members see it, and its invitations as its owner sees them', async () => {
    const alice = addPlayer(t, 'Alice');
    const bob = addPlayer(t, 'Bob');
    const carol = addPlayer(t, 'Carol');
    const city = await createCity(alice, {name: 'Seen'});
    await addMember(alice, city.id, bob, 'viewer');
    expect((await alice.post(`/api/cities/${city.id}/invitations`, {username: 'carol', role: 'player'})).status)
      .toBe(201);

    const view = (await alice.get(`/api/cities/${city.id}`)).json;
    expect(view.city).toMatchObject({id: city.id, name: 'Seen', role: 'owner', ownerName: 'Alice'});
    expect(view.members).toEqual([
      {id: alice.publicId, username: 'Alice', role: 'owner', colour: '#ff8899', online: false},
      {id: bob.publicId, username: 'Bob', role: 'viewer', colour: '#33ddff', online: false},
    ]);
    expect(view.invitations).toEqual([{id: expect.any(String), username: 'Carol', userId: carol.publicId,
                                       role: 'player', createdAt: t.clock.now()}]);

    const bobView = (await bob.get(`/api/cities/${city.id}`)).json;
    expect(bobView.city.role).toBe('viewer');
    expect(bobView.invitations).toBeUndefined();

    // Online, once connected
    const {socket} = await join(t, bob, city.id);
    expect((await alice.get(`/api/cities/${city.id}`)).json.members[1].online).toBe(true);
    expect((await alice.get('/api/cities')).json.cities[0].online).toBe(1);
    await socket.close();
  });

  test('Renaming, and downloading a copy with a safe file name', async () => {
    const alice = addPlayer(t);
    const city = await createCity(alice);
    const renamed = await alice.patch(`/api/cities/${city.id}`, {name: 'Tōkyō "€"'});
    expect(renamed.status).toBe(200);
    expect(renamed.json.city.name).toBe('Tōkyō "€"');
    expect((await alice.patch(`/api/cities/${city.id}`, {name: ''})).status).toBe(400);

    const file = await alice.get(`/api/cities/${city.id}/save`);
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(file.headers['content-disposition'])
      .toBe(`attachment; filename="T_ky_.kawacity"; filename*=UTF-8''T%C5%8Dky%C5%8D%20%22%E2%82%AC%22.kawacity`);
    expect(file.json.name).toBe('Tōkyō "€"');
    expect(validateSave(file.json)).toBeTruthy();
  });

  test('Invitations: by username, accepted, declined, cancelled, declined all', async () => {
    const alice = addPlayer(t, 'Alice');
    const bob = addPlayer(t, 'Bob');
    const city = await createCity(alice, {name: 'Inviting'});
    const invite = (body: unknown) => alice.post(`/api/cities/${city.id}/invitations`, body);

    expect((await invite({username: 'nobody', role: 'player'})).status).toBe(404);
    expect((await invite({username: 'Alice', role: 'player'})).json.error.code).toBe('conflict');
    expect((await invite({username: 'Bob', role: 'owner'})).json)
      .toEqual({error: {code: 'invalid_input', fields: {role: 'invalid'}}});
    expect((await invite({username: 'Bob'})).status).toBe(400);
    expect(await invite({username: 'BOB', role: 'viewer'})).toMatchObject({status: 201, json: {ok: true}});
    // Again: the role changes, nothing more
    expect((await invite({username: 'bob', role: 'player'})).status).toBe(201);

    const invitations = (await bob.get('/api/cities')).json.invitations;
    expect(invitations).toEqual([{id: expect.any(String), kind: 'city', target: {id: city.id, name: 'Inviting'},
                                  inviterId: alice.publicId, inviterName: 'Alice', role: 'player'}]);
    const id = invitations[0].id;

    // Only the invitee answers it, only the inviter cancels it
    expect((await alice.post(`/api/invitations/${id}/accept`)).status).toBe(404);
    expect((await bob.post(`/api/invitations/${id}/cancel`)).status).toBe(404);
    expect((await addPlayer(t).post(`/api/invitations/${id}/decline`)).status).toBe(404);

    const accepted = await bob.post(`/api/invitations/${id}/accept`);
    expect(accepted.status).toBe(200);
    expect(accepted.json.city).toMatchObject({id: city.id, role: 'player', ownerName: 'Alice'});
    expect((await bob.get('/api/cities')).json).toMatchObject({cities: [{id: city.id}], invitations: []});
    expect((await bob.post(`/api/invitations/${id}/accept`)).status).toBe(404);
    expect((await invite({username: 'Bob', role: 'player'})).json.error.code).toBe('conflict');

    // Declined, cancelled
    const carol = addPlayer(t, 'Carol');
    await invite({username: 'Carol', role: 'viewer'});
    const second = (await carol.get('/api/cities')).json.invitations[0].id;
    expect((await carol.post(`/api/invitations/${second}/decline`)).status).toBe(204);
    expect((await carol.get('/api/cities')).json.invitations).toEqual([]);
    await invite({username: 'Carol', role: 'viewer'});
    const third = (await carol.get('/api/cities')).json.invitations[0].id;
    expect((await alice.post(`/api/invitations/${third}/cancel`)).status).toBe(204);
    expect((await carol.get('/api/cities')).json.invitations).toEqual([]);

    // Every invitation from someone, declined at once
    const other = await createCity(alice, {name: 'Other'});
    await invite({username: 'Carol', role: 'viewer'});
    await alice.post(`/api/cities/${other.id}/invitations`, {username: 'Carol', role: 'player'});
    expect((await carol.get('/api/cities')).json.invitations.length).toBe(2);
    expect((await carol.post('/api/invitations/decline-all', {from: 'nobody'})).status).toBe(204);
    expect((await carol.get('/api/cities')).json.invitations.length).toBe(2);
    expect((await carol.post('/api/invitations/decline-all', {from: alice.publicId})).status).toBe(204);
    expect((await carol.get('/api/cities')).json.invitations).toEqual([]);
    expect((await carol.post('/api/invitations/decline-all', {from: 5})).status).toBe(400);
  });

  test('Invitation limits: 20 an hour per inviter, 20 waiting per invitee (beyond: silently not made)', async () => {
    const alice = addPlayer(t, 'Alice');
    const city = await createCity(alice);
    const invitee = addPlayer(t, 'Target');
    for (let i = 0; i < 20; i++) {
      const owner = addPlayer(t);
      const theirs = await createCity(owner);
      expect((await owner.post(`/api/cities/${theirs.id}/invitations`, {username: 'Target', role: 'viewer'})).status)
        .toBe(201);
    }
    // The 21st is answered the same, and not made
    const answer = await alice.post(`/api/cities/${city.id}/invitations`, {username: 'Target', role: 'viewer'});
    expect(answer).toMatchObject({status: 201, json: {ok: true}});
    expect((await invitee.get('/api/cities')).json.invitations.length).toBe(20);

    for (let i = 0; i < 19; i++) {
      const someone = addPlayer(t);
      expect((await alice.post(`/api/cities/${city.id}/invitations`, {username: someone.username, role: 'viewer'}))
        .status).toBe(201);
    }
    const limited = await alice.post(`/api/cities/${city.id}/invitations`, {username: addPlayer(t).username,
                                                                             role: 'viewer'});
    expect([limited.status, limited.json.error.code]).toEqual([429, 'rate_limited']);
  });

  test('Members: roles changed, members removed, leaving; 16 at most; the owner cannot leave', async () => {
    const alice = addPlayer(t, 'Alice');
    const bob = addPlayer(t, 'Bob');
    const city = await createCity(alice);
    await addMember(alice, city.id, bob, 'viewer');

    const changed = await alice.post(`/api/cities/${city.id}/members/${bob.publicId}`, {role: 'player'});
    expect(changed.status).toBe(200);
    expect(changed.json.members[1]).toMatchObject({username: 'Bob', role: 'player'});
    expect((await alice.post(`/api/cities/${city.id}/members/${bob.publicId}`, {role: 'owner'})).status).toBe(400);
    expect((await alice.post(`/api/cities/${city.id}/members/${alice.publicId}`, {role: 'viewer'})).status).toBe(409);
    expect((await alice.post(`/api/cities/${city.id}/members/${OTHER_ID}`, {role: 'viewer'})).status).toBe(404);

    expect((await alice.post(`/api/cities/${city.id}/members/${alice.publicId}/remove`)).status).toBe(409);
    expect((await bob.post(`/api/cities/${city.id}/members/${bob.publicId}/remove`)).status).toBe(204);
    expect((await bob.get(`/api/cities/${city.id}`)).status).toBe(404);

    await addMember(alice, city.id, bob, 'viewer');
    expect((await alice.post(`/api/cities/${city.id}/members/${bob.publicId}/remove`)).status).toBe(204);
    expect((await bob.get('/api/cities')).json.cities).toEqual([]);

    for (let i = 1; i < CITY_LIMITS.members; i++)
      expect((await addMember(alice, city.id, addPlayer(t), 'viewer')).status).toBe(200);
    const colours = (await alice.get(`/api/cities/${city.id}`)).json.members.map((m: any) => m.colour);
    expect(new Set(colours).size).toBe(16);
    const full = await alice.post(`/api/cities/${city.id}/invitations`, {username: 'Bob', role: 'viewer'});
    expect([full.status, full.json.error.code]).toEqual([403, 'limit_reached']);
  });

  test('An invitation accepted once the city is full waits', async () => {
    const alice = addPlayer(t, 'Alice');
    const city = await createCity(alice);
    const late = addPlayer(t, 'Late');
    await alice.post(`/api/cities/${city.id}/invitations`, {username: 'Late', role: 'viewer'});
    for (let i = 1; i < CITY_LIMITS.members; i++)
      await addMember(alice, city.id, addPlayer(t), 'viewer');
    const id = (await late.get('/api/cities')).json.invitations[0].id;
    expect((await late.post(`/api/invitations/${id}/accept`)).json.error.code).toBe('limit_reached');
    expect((await late.get('/api/cities')).json.invitations.length).toBe(1);
  });

  test('Deleting a city: gone for every member, its invitations too', async () => {
    const alice = addPlayer(t, 'Alice');
    const bob = addPlayer(t, 'Bob');
    const carol = addPlayer(t, 'Carol');
    const city = await createCity(alice);
    await addMember(alice, city.id, bob);
    await alice.post(`/api/cities/${city.id}/invitations`, {username: 'Carol', role: 'viewer'});

    expect((await alice.post(`/api/cities/${city.id}/delete`, {now: true})).status).toBe(400);
    expect((await alice.post(`/api/cities/${city.id}/delete`)).status).toBe(204);
    expect((await bob.get('/api/cities')).json.cities).toEqual([]);
    expect((await carol.get('/api/cities')).json.invitations).toEqual([]);
    expect((await alice.get(`/api/cities/${city.id}`)).status).toBe(404);
    expect(t.db.get<{n: number}>('SELECT count(*) AS n FROM city_members')?.n).toBe(0);
  });

  test('The account\'s export lists its cities, regions, memberships and invitations', async () => {
    const alice = addPlayer(t, 'Alice');
    const bob = addPlayer(t, 'Bob');
    const city = await createCity(alice, {name: 'Exported'});
    await addMember(alice, city.id, bob, 'viewer');
    const region = (await alice.post('/api/regions', {name: 'Valley', width: 2, height: 2})).json.region;
    await alice.post(`/api/regions/${region.id}/invitations`, {username: 'Bob'});

    const exported = (await alice.get('/api/account/export')).json;
    expect(exported.cities).toEqual([expect.objectContaining({id: city.id, name: 'Exported', region: null,
      members: [{id: alice.publicId, username: 'Alice', role: 'owner'}, {id: bob.publicId, username: 'Bob',
                                                                          role: 'viewer'}]})]);
    expect(exported.regions).toEqual([expect.objectContaining({id: region.id, name: 'Valley', width: 2, height: 2,
                                                                 public: false})]);
    expect(exported.memberships.cities).toEqual([expect.objectContaining({id: city.id, role: 'owner'})]);
    expect(exported.invitations.sent).toEqual([expect.objectContaining({kind: 'region', username: 'Bob'})]);

    const bobs = (await bob.get('/api/account/export')).json;
    expect(bobs.cities).toEqual([]);
    expect(bobs.memberships.cities).toEqual([expect.objectContaining({id: city.id, role: 'viewer'})]);
    expect(bobs.invitations.received).toEqual([expect.objectContaining({kind: 'region', username: 'Alice',
                                                                        target: {id: region.id, name: 'Valley'}})]);
    expect(bobs.memberships.removedFrom).toEqual([]);

    // Removed from a region by its owner: kept, so that they do not join it again by themselves
    const invitation = (await bob.get('/api/cities')).json.invitations.find((i: any) => i.kind === 'region');
    await bob.post(`/api/invitations/${invitation.id}/accept`);
    expect((await alice.post(`/api/regions/${region.id}/members/${bob.publicId}/remove`)).status).toBe(204);
    expect((await bob.get('/api/account/export')).json.memberships.removedFrom)
      .toEqual([{id: region.id, name: 'Valley', removedAt: expect.any(String)}]);
    expect(JSON.stringify(exported)).not.toMatch(/"(owner_id|user_id|city_id)"/);
  });
});


describe('The players\' colours', () => {
  // WCAG's contrast ratio, and the distance between two colours in CIELAB (CIE76)
  const channels = (colour: string) => [1, 3, 5].map(i => parseInt(colour.slice(i, i + 2), 16) / 255);
  const linear = (c: number) => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  const luminance = (colour: string) => {
    const [r, g, b] = channels(colour).map(linear);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a: string, b: string) => {
    const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (high + 0.05) / (low + 0.05);
  };
  const lab = (colour: string) => {
    const [r, g, b] = channels(colour).map(linear);
    const f = (t: number) => t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116;
    const x = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047);
    const y = f(0.2126 * r + 0.7152 * g + 0.0722 * b);
    const z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
    return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
  };
  const distance = (a: string, b: string) => Math.hypot(...lab(a).map((v, i) => v - lab(b)[i]));

  // The map: the average colours of land, trees and water in images/tiles.png (tiles 0, 40 and 2). The game's windows:
  // the chat's background, where the names are written in the players' colours, and the panel around it (style.css).
  const MAP = {land: '#519541', trees: '#337334', water: '#2e64b6'};
  const css = readFileSync(path.join(__dirname, '..', '..', 'css', 'style.css'), 'utf8');
  const variable = (name: string) => new RegExp(`--${name}:\\s*(#[0-9a-f]{6});`, 'i').exec(css)![1];

  test('can be read on the map and in the game\'s windows, and told apart', () => {
    expect(PALETTE).toHaveLength(CITY_LIMITS.members);
    for (const colour of PALETTE) {
      // A name in the chat is text: 4.5 to 1 at least
      expect([colour, contrast(colour, variable('win-inset')) >= 4.5]).toEqual([colour, true]);
      expect([colour, contrast(colour, variable('win-top')) >= 3]).toEqual([colour, true]);
      // A pointer on the map: lighter or darker than what is under it, and of another colour
      for (const [ground, under] of Object.entries(MAP))
        expect([colour, ground, contrast(colour, under) >= 1.5 && distance(colour, under) >= 40])
          .toEqual([colour, ground, true]);
    }
    for (let i = 0; i < PALETTE.length; i++) {
      for (let j = i + 1; j < PALETTE.length; j++)
        expect([PALETTE[i], PALETTE[j], distance(PALETTE[i], PALETTE[j]) >= 15]).toEqual([PALETTE[i], PALETTE[j], true]);
    }
  });
});
