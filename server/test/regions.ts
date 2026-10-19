/* KawaCity, a modified version of micropolisJS.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

import { AdminContext, runAdminCommand } from '../admin/commands';
import { decodeState } from '../game/cityStore';
import { freshCitySave, sampleCity } from '../gameTesting';
import { REGION_LIMITS } from '../game/regionStore';
import type { Room } from '../game/room';
import { addMember, addPlayer, createCity, flushSockets, join, Player, runFrames, sync, TestSocket,
         until } from '../multiplayerTesting';
import { cleanUp, startTestApp, TestApp } from '../testing';

// Regions: grids of slots where the players' cities are side by side, neighbours of one another

afterAll(cleanUp);

const MANY = {IP_LIMIT_FACTOR: '100'};

const roomOf = (t: TestApp, cityId: string): Room => {
  const row = t.app.game.cities.byPublicId(cityId);
  const room = row ? t.app.game.rooms.get(row.id) : undefined;
  if (!room)
    throw new Error('no room');
  return room;
};

const neighbour = (room: Room, side: string): any =>
  (room.city.describeNeighbours() as any[]).find(n => n.side === side);

const deal = (room: Room, side: string, kind: string) => neighbour(room, side).deals.find((d: any) => d.kind === kind);

const storedNeighbour = (t: TestApp, cityId: string, side: string) => {
  const row = t.db.get<{state: Uint8Array; edge_state: string}>('SELECT state, edge_state FROM cities WHERE public_id = ?',
                                                                 cityId)!;
  const save = decodeState(row.state);
  return {neighbour: (save.neighbours as any[]).find(n => n.side === side),
          edge: JSON.parse(row.edge_state)[side]};
};

// A region with its owner and a member
async function region(t: TestApp, width = 2, height = 2) {
  const owner = addPlayer(t, 'Ruth');
  const member = addPlayer(t, 'Max');
  const made = await owner.post('/api/regions', {name: 'Riverlands', width, height});
  expect(made.status).toBe(201);
  const id = made.json.region.id;
  expect((await owner.post(`/api/regions/${id}/invitations`, {username: 'Max'})).status).toBe(201);
  const invitation = (await member.get('/api/cities')).json.invitations.find((i: any) => i.kind === 'region');
  expect((await member.post(`/api/invitations/${invitation.id}/accept`)).status).toBe(200);
  return {owner, member, id};
}

const command = async (socket: TestSocket, message: Record<string, unknown>) => {
  socket.send(message);
  return socket.waitFor(m => (m.t === 'ok' || m.t === 'error' || m.t === 'toolResult') && m.seq === message.seq);
};

describe('Regions in the lobby', () => {
  let t: TestApp;
  beforeEach(async () => { t = await startTestApp(MANY); });
  afterEach(() => t.close());

  test('Making regions: a name, a size from 2x2 to 4x4, 3 owned at most', async () => {
    const ruth = addPlayer(t, 'Ruth');
    const fails = async (body: unknown) => (await ruth.post('/api/regions', body)).json;
    expect(await fails({name: '', width: 2, height: 2})).toEqual({error: {code: 'invalid_input',
                                                                          fields: {name: 'required'}}});
    expect(await fails({name: 'x'.repeat(31), width: 2, height: 2}))
      .toEqual({error: {code: 'invalid_input', fields: {name: 'too_long'}}});
    expect(await fails({name: 'A', width: 1, height: 5})).toEqual({error: {code: 'invalid_input',
                                                                           fields: {width: 'invalid', height: 'invalid'}}});
    expect(await fails({name: 'A', width: 2.5, height: 2})).toEqual({error: {code: 'invalid_input',
                                                                             fields: {width: 'invalid'}}});

    const made = await ruth.post('/api/regions', {name: ' Riverlands​ ', width: 4, height: 3});
    expect(made.status).toBe(201);
    expect(made.json.region).toEqual({id: expect.stringMatching(/^[A-Za-z0-9_-]{22}$/), name: 'Riverlands',
                                      ownerName: 'Ruth', width: 4, height: 3, public: false, mine: true, cities: 0});
    for (let i = 1; i < REGION_LIMITS.ownedRegions; i++)
      expect((await ruth.post('/api/regions', {name: 'R' + i, width: 2, height: 2})).status).toBe(201);
    expect(await fails({name: 'One more', width: 2, height: 2}))
      .toEqual({error: {code: 'limit_reached'}});
    expect((await ruth.get('/api/regions')).json.regions.length).toBe(3);
  });

  test('Members see the region and its slots; others are told it does not exist', async () => {
    const {owner, member, id} = await region(t);
    const stranger = addPlayer(t);
    for (const path of [`/api/regions/${id}`])
      expect((await stranger.get(path)).status).toBe(404);
    for (const [path, body] of [[`/api/regions/${id}/delete`, {}], [`/api/regions/${id}/invitations`, {username: 'Ruth'}],
                                [`/api/regions/${id}/members/${member.publicId}/remove`, {}],
                                [`/api/regions/${id}/slots/0/0/clear`, {city: id}]] as const)
      expect([path, (await stranger.post(path, body)).status]).toEqual([path, 404]);
    expect((await stranger.patch(`/api/regions/${id}`, {name: 'Mine'})).status).toBe(404);
    expect((await stranger.post('/api/cities', {name: 'Squat', level: 0,
                                                save: freshCitySave(),
                                                region: {id, x: 0, y: 0}})).status).toBe(404);

    // A member: not the owner's rights
    expect((await member.patch(`/api/regions/${id}`, {name: 'Mine'})).status).toBe(403);
    expect((await member.post(`/api/regions/${id}/delete`)).status).toBe(403);
    expect((await member.post(`/api/regions/${id}/invitations`, {username: 'Ruth'})).status).toBe(403);
    expect((await member.post(`/api/regions/${id}/members/${owner.publicId}/remove`)).status).toBe(403);

    const city = await createCity(member, {name: 'Maxton', region: {id, x: 1, y: 0}});
    const view = (await owner.get(`/api/regions/${id}`)).json;
    expect(view.region).toMatchObject({id, name: 'Riverlands', ownerName: 'Ruth', width: 2, height: 2, mine: true,
                                       cities: 1});
    expect(view.slots).toEqual([
      {x: 0, y: 0, city: null},
      {x: 1, y: 0, city: {id: city.id, name: 'Maxton', ownerName: 'Max', population: expect.any(Number), role: null}},
      {x: 0, y: 1, city: null},
      {x: 1, y: 1, city: null},
    ]);
    expect(view.members).toEqual([{id: owner.publicId, username: 'Ruth', owner: true},
                                  {id: member.publicId, username: 'Max', owner: false}]);
    expect(view.invitations).toEqual([]);
    expect((await member.get(`/api/regions/${id}`)).json.slots[1].city.role).toBe('owner');
    expect((await member.get('/api/regions')).json.regions).toEqual([{id, name: 'Riverlands', ownerName: 'Ruth',
                                                                       width: 2, height: 2, public: false, cities: 1,
                                                                       mine: false}]);
    expect((await member.get('/api/cities')).json.cities[0].region).toEqual({id, name: 'Riverlands', x: 1, y: 0});

    expect((await owner.patch(`/api/regions/${id}`, {name: 'Hills'})).json.region.name).toBe('Hills');
  });

  test('Slots: inside the region, one city each', async () => {
    const {owner, member, id} = await region(t);
    const save = freshCitySave();
    const make = (player: Player, x: number, y: number) =>
      player.post('/api/cities', {name: 'Slot', level: 0, save, region: {id, x, y}});
    expect((await make(member, 2, 0)).json).toEqual({error: {code: 'invalid_input', fields: {region: 'invalid'}}});
    expect((await make(member, 0, 0)).status).toBe(201);
    expect((await make(owner, 0, 0)).json).toEqual({error: {code: 'conflict'}});
    expect((await make(owner, 0, 1)).status).toBe(201);
  });

  test('Removing a member or deleting the region: their cities stay, out of the region', async () => {
    const {owner, member, id} = await region(t);
    const maxton = await createCity(member, {name: 'Maxton', region: {id, x: 0, y: 0}});
    const ruthton = await createCity(owner, {name: 'Ruthton', region: {id, x: 1, y: 0}});

    expect((await owner.post(`/api/regions/${id}/members/${owner.publicId}/remove`)).status).toBe(409);
    expect((await owner.post(`/api/regions/${id}/members/${member.publicId}/remove`)).status).toBe(204);
    expect((await member.get(`/api/regions/${id}`)).status).toBe(404);
    expect((await member.get('/api/cities')).json.cities[0]).toMatchObject({id: maxton.id, region: null});
    expect((await owner.get(`/api/regions/${id}`)).json.region.cities).toBe(1);

    expect((await owner.post(`/api/regions/${id}/delete`)).status).toBe(204);
    expect((await owner.get('/api/cities')).json.cities[0]).toMatchObject({id: ruthton.id, region: null});
    expect((await owner.get(`/api/regions/${id}`)).status).toBe(404);
  });

  test('Clearing a slot: the city\'s owner or the region\'s owner', async () => {
    const {owner, member, id} = await region(t);
    const third = addPlayer(t, 'Tess');
    expect((await owner.post(`/api/regions/${id}/invitations`, {username: 'Tess'})).status).toBe(201);
    const invitation = (await third.get('/api/cities')).json.invitations[0];
    await third.post(`/api/invitations/${invitation.id}/accept`);

    const mine = await createCity(member, {region: {id, x: 0, y: 0}});
    const theirs = await createCity(third, {region: {id, x: 1, y: 0}});
    expect((await member.post(`/api/regions/${id}/slots/1/0/clear`, {city: theirs.id})).status).toBe(403);
    expect((await member.post(`/api/regions/${id}/slots/0/1/clear`, {city: mine.id})).status).toBe(404);
    expect((await member.post(`/api/regions/${id}/slots/9/0/clear`, {city: mine.id})).status).toBe(404);
    // The city taken out is named: the one the player saw there
    expect((await member.post(`/api/regions/${id}/slots/0/0/clear`)).status).toBe(400);
    expect((await member.post(`/api/regions/${id}/slots/0/0/clear`, {city: 'nope'})).status).toBe(400);
    expect((await member.post(`/api/regions/${id}/slots/0/0/clear`, {city: mine.id})).status).toBe(204);

    // The region's owner, from a card shown before Tess's city left and another took its place: nothing is done
    expect((await third.post(`/api/regions/${id}/slots/1/0/clear`, {city: theirs.id})).status).toBe(204);
    const newcomer = await createCity(member, {name: 'Newcomer', region: {id, x: 1, y: 0}});
    expect((await owner.post(`/api/regions/${id}/slots/1/0/clear`, {city: theirs.id})).json)
      .toEqual({error: {code: 'conflict'}});
    expect((await member.get('/api/cities')).json.cities.find((c: any) => c.id === newcomer.id).region)
      .toMatchObject({id, x: 1, y: 0});
    expect((await owner.post(`/api/regions/${id}/slots/1/0/clear`, {city: newcomer.id})).status).toBe(204);
    expect((await owner.get(`/api/regions/${id}`)).json.region.cities).toBe(0);
  });
  // The next tests give their cities a save, so that the cities made by later tests keep their maps (see createCity)
  test('Moving a city to a free place of a region its owner is a member of', async () => {
    const {owner, member, id} = await region(t);
    const other = (await owner.post('/api/regions', {name: 'Hills', width: 2, height: 2})).json.region;
    const loose = await createCity(member, {save: freshCitySave(), name: 'Loose'});
    const placed = await createCity(owner, {save: freshCitySave(), name: 'Placed', region: {id, x: 0, y: 0}});
    const move = (player: Player, cityId: string, region: unknown) =>
      player.post(`/api/cities/${cityId}/place`, {region});

    expect((await move(owner, loose.id, {id, x: 1, y: 0})).status).toBe(404);
    expect((await move(member, loose.id, {id: other.id, x: 0, y: 0})).status).toBe(404);
    expect((await move(member, loose.id, {id, x: 2, y: 0})).json)
      .toEqual({error: {code: 'invalid_input', fields: {region: 'invalid'}}});
    expect((await move(member, loose.id, null)).status).toBe(400);
    expect((await move(member, loose.id, {id, x: 0, y: 0})).json).toEqual({error: {code: 'conflict'}});

    // A city of no region enters one; another moves within its region, then to another region
    const entered = await move(member, loose.id, {id, x: 1, y: 0});
    expect(entered.status).toBe(200);
    expect(entered.json.city.region).toEqual({id, name: 'Riverlands', x: 1, y: 0});
    expect((await move(owner, placed.id, {id, x: 0, y: 0})).json).toEqual({error: {code: 'conflict'}});
    expect((await move(owner, placed.id, {id, x: 0, y: 1})).json.city.region).toMatchObject({x: 0, y: 1});
    expect((await move(owner, placed.id, {id: other.id, x: 1, y: 1})).json.city.region)
      .toEqual({id: other.id, name: 'Hills', x: 1, y: 1});
    expect((await owner.get(`/api/regions/${id}`)).json.slots.filter((s: any) => s.city).map((s: any) => s.city.name))
      .toEqual(['Loose']);
  });

  test('Moving a city ends its deals with the cities beside it, before and after', async () => {
    const {owner, member, id} = await region(t, 3, 2);
    const left = await createCity(owner, {save: freshCitySave(), name: 'Left', region: {id, x: 0, y: 0}});
    const right = await createCity(member, {save: freshCitySave(), name: 'Right', region: {id, x: 1, y: 0}});
    const below = await createCity(owner, {save: freshCitySave(), name: 'Below', region: {id, x: 2, y: 1}});
    const l = await join(t, owner, left.id);
    const r = await join(t, member, right.id);
    await command(l.socket, {t: 'deal', seq: 1, side: 'east', kind: 'twinning', signed: true});
    await command(r.socket, {t: 'deal', seq: 1, side: 'west', kind: 'twinning', signed: true});
    expect(deal(roomOf(t, left.id), 'east', 'twinning')).toMatchObject({signed: true, state: 'active'});

    expect((await member.post(`/api/cities/${right.id}/place`, {region: {id, x: 2, y: 0}})).status).toBe(200);
    // Back to the neighbours of their saves where no city is beside them
    expect(neighbour(roomOf(t, left.id), 'east').name).not.toBe('Right');
    expect(neighbour(roomOf(t, right.id), 'west').name).not.toBe('Left');
    expect(neighbour(roomOf(t, right.id), 'south').name).toBe('Below');
    expect(roomOf(t, left.id).edge.east.signed.twinning).toBe(false);
    expect(roomOf(t, right.id).edge.west.signed.twinning).toBe(false);
    expect(storedNeighbour(t, below.id, 'north').edge.signed.twinning).toBe(false);
    await Promise.all([l.socket.close(), r.socket.close()]);
  });

  test('Handing a city of a region over: only to a member of the region', async () => {
    const {owner, member, id} = await region(t);
    const outsider = addPlayer(t, 'Olga');
    const city = await createCity(owner, {save: freshCitySave(), name: 'Shared', region: {id, x: 0, y: 0}});
    await addMember(owner, city.id, outsider, 'player');
    await addMember(owner, city.id, member, 'player');
    expect((await owner.post(`/api/cities/${city.id}/owner`, {member: outsider.publicId})).json)
      .toEqual({error: {code: 'conflict'}});
    expect((await owner.post(`/api/cities/${city.id}/owner`, {member: member.publicId})).status).toBe(200);
    expect((await owner.get(`/api/regions/${id}`)).json.slots[0].city).toMatchObject({name: 'Shared', ownerName: 'Max',
                                                                                     role: 'player'});
  });

  test('Public regions: listed for every player, joined without an invitation', async () => {
    const ruth = addPlayer(t, 'Ruth');
    const max = addPlayer(t, 'Max');
    const fails = async (body: unknown) => (await ruth.post('/api/regions', body)).json;
    expect(await fails({name: 'A', width: 2, height: 2, public: 'yes'}))
      .toEqual({error: {code: 'invalid_input', fields: {public: 'invalid'}}});

    const open = (await ruth.post('/api/regions', {name: 'Open plains', width: 2, height: 2, public: true})).json.region;
    expect(open).toMatchObject({name: 'Open plains', public: true, mine: true});
    const closed = (await ruth.post('/api/regions', {name: 'Closed hills', width: 2, height: 2})).json.region;
    expect(closed.public).toBe(false);

    // Listed for the others, not for its members; joined once
    expect((await ruth.get('/api/public-regions')).json.regions).toEqual([]);
    expect((await max.get('/api/public-regions')).json.regions).toEqual([{id: open.id, name: 'Open plains',
      ownerName: 'Ruth', width: 2, height: 2, public: true, mine: false, cities: 0, members: 1}]);
    expect((await max.post(`/api/regions/${closed.id}/join`)).status).toBe(404);
    expect((await max.post(`/api/regions/nope/join`)).status).toBe(404);
    expect((await max.post(`/api/regions/${open.id}/join`, {x: 1})).status).toBe(400);
    const joined = await max.post(`/api/regions/${open.id}/join`);
    expect(joined.status).toBe(200);
    expect(joined.json.region).toMatchObject({id: open.id, public: true, mine: false});
    expect((await max.post(`/api/regions/${open.id}/join`)).json).toEqual({error: {code: 'conflict'}});
    expect((await max.get('/api/public-regions')).json.regions).toEqual([]);
    expect((await max.get(`/api/regions/${open.id}`)).json.members.map((m: any) => m.username)).toEqual(['Ruth', 'Max']);
    await createCity(max, {name: 'Maxton', region: {id: open.id, x: 0, y: 0}});

    // Only its owner opens or closes it; members stay when it closes
    expect((await max.patch(`/api/regions/${open.id}`, {public: false})).status).toBe(403);
    expect((await ruth.patch(`/api/regions/${open.id}`, {})).status).toBe(400);
    expect((await ruth.patch(`/api/regions/${open.id}`, {public: 1})).json)
      .toEqual({error: {code: 'invalid_input', fields: {public: 'invalid'}}});
    const tess = addPlayer(t, 'Tess');
    expect((await tess.get('/api/public-regions')).json.regions.map((r: any) => r.cities)).toEqual([1]);
    expect((await ruth.patch(`/api/regions/${open.id}`, {public: false})).json.region).toMatchObject({public: false,
                                                                                                    name: 'Open plains'});
    expect((await tess.get('/api/public-regions')).json.regions).toEqual([]);
    expect((await tess.post(`/api/regions/${open.id}/join`)).status).toBe(404);
    expect((await max.get(`/api/regions/${open.id}`)).status).toBe(200);
    expect((await ruth.patch(`/api/regions/${closed.id}`, {name: 'Open hills', public: true})).json.region)
      .toMatchObject({name: 'Open hills', public: true});
    expect((await tess.get('/api/public-regions')).json.regions.map((r: any) => r.name)).toEqual(['Open hills']);
  });

  test('Public regions: full ones are not listed, and a member the owner removed does not join again', async () => {
    const ruth = addPlayer(t, 'Ruth');
    const max = addPlayer(t, 'Max');
    const open = (await ruth.post('/api/regions', {name: 'Open plains', width: 2, height: 2, public: true})).json.region;
    expect((await max.post(`/api/regions/${open.id}/join`)).status).toBe(200);

    // Leaving: they may come back
    expect((await max.post(`/api/regions/${open.id}/members/${max.publicId}/remove`)).status).toBe(204);
    expect((await max.get('/api/public-regions')).json.regions.length).toBe(1);
    expect((await max.post(`/api/regions/${open.id}/join`)).status).toBe(200);

    // Removed by the owner: not listed for them, not joined, until the owner invites them again
    expect((await ruth.post(`/api/regions/${open.id}/members/${max.publicId}/remove`)).status).toBe(204);
    expect((await max.get('/api/public-regions')).json.regions).toEqual([]);
    expect((await max.post(`/api/regions/${open.id}/join`)).json).toEqual({error: {code: 'forbidden'}});
    expect((await ruth.post(`/api/regions/${open.id}/invitations`, {username: 'Max'})).status).toBe(201);
    const invitation = (await max.get('/api/cities')).json.invitations[0];
    expect((await max.post(`/api/invitations/${invitation.id}/accept`)).status).toBe(200);
    expect((await max.post(`/api/regions/${open.id}/members/${max.publicId}/remove`)).status).toBe(204);
    expect((await max.post(`/api/regions/${open.id}/join`)).status).toBe(200);

    // Joining drops an invitation to the region
    const tess = addPlayer(t, 'Tess');
    expect((await ruth.post(`/api/regions/${open.id}/invitations`, {username: 'Tess'})).status).toBe(201);
    expect((await tess.post(`/api/regions/${open.id}/join`)).status).toBe(200);
    expect((await tess.get('/api/cities')).json.invitations).toEqual([]);

    // Every place built: no longer listed
    const ann = addPlayer(t, 'Ann');
    for (const [player, x, y] of [[ruth, 0, 0], [max, 1, 0], [tess, 0, 1], [tess, 1, 1]] as const)
      await createCity(player, {region: {id: open.id, x, y}});
    expect((await ann.get('/api/public-regions')).json.regions).toEqual([]);
  });

  test('Public regions: no more members than a region holds', async () => {
    const ruth = addPlayer(t, 'Ruth');
    const open = (await ruth.post('/api/regions', {name: 'Open plains', width: 4, height: 4, public: true})).json.region;
    for (let i = 1; i < REGION_LIMITS.members; i++)
      expect((await addPlayer(t).post(`/api/regions/${open.id}/join`)).status).toBe(200);
    const late = addPlayer(t);
    expect((await late.get('/api/public-regions')).json.regions).toEqual([]);
    expect((await late.post(`/api/regions/${open.id}/join`)).json).toEqual({error: {code: 'limit_reached'}});
  });
});

describe('Neighbours in a region', () => {
  let t: TestApp;
  beforeEach(async () => { t = await startTestApp(MANY); });
  afterEach(() => t.close());

  test('Cities side by side see each other: name, owner, population, live', async () => {
    const {owner, member, id} = await region(t);
    const west = await createCity(member, {name: 'Westby', region: {id, x: 0, y: 0}});
    const east = await createCity(owner, {name: 'Eastby', region: {id, x: 1, y: 0}, save: sampleCity('kobe')});
    const south = await createCity(owner, {name: 'Southby', region: {id, x: 0, y: 1}});
    expect(south.name).toBe('Southby');

    const w = await join(t, member, west.id);
    expect(w.welcome.city.region).toEqual({id, name: 'Riverlands', x: 0, y: 0});
    const eastNeighbour = w.welcome.stats.neighbours.find((n: any) => n.side === 'east');
    expect(eastNeighbour).toMatchObject({name: 'Eastby', player: true, ownerName: 'Ruth', cityId: east.id});
    expect(eastNeighbour.population).toBeGreaterThan(10000);
    expect(w.welcome.stats.neighbours.find((n: any) => n.side === 'south'))
      .toMatchObject({name: 'Southby', player: true, ownerName: 'Ruth'});
    // Beyond the region's edges: the neighbours of the save
    expect(w.welcome.stats.neighbours.find((n: any) => n.side === 'north').player).toBeUndefined();

    // The east city opens: its live population, its new name
    const e = await join(t, owner, east.id);
    expect(neighbour(roomOf(t, east.id), 'west')).toMatchObject({name: 'Westby', ownerName: 'Max', player: true});
    expect((await owner.patch(`/api/cities/${east.id}`, {name: 'Eastham'})).status).toBe(200);
    expect(neighbour(roomOf(t, west.id), 'east').name).toBe('Eastham');
    w.socket.clear();
    runFrames(t, 2500);
    const stats = await w.socket.waitFor(m => m.t === 'stats');
    expect(stats.stats.neighbours.find((n: any) => n.side === 'east').name).toBe('Eastham');
    await Promise.all([w.socket.close(), e.socket.close()]);
  });

  test('Twinning is in force only when both cities sign it; trade also needs both edges linked', async () => {
    const {owner, member, id} = await region(t);
    const west = await createCity(member, {name: 'Westby', region: {id, x: 0, y: 0}});
    const east = await createCity(owner, {name: 'Eastby', region: {id, x: 1, y: 0}});
    const w = await join(t, member, west.id);
    const e = await join(t, owner, east.id);
    const westRoom = roomOf(t, west.id);
    const eastRoom = roomOf(t, east.id);

    expect(await command(w.socket, {t: 'deal', seq: 1, side: 'east', kind: 'twinning', signed: true}))
      .toEqual({t: 'ok', seq: 1});
    expect(deal(westRoom, 'east', 'twinning')).toMatchObject({signed: true, state: 'proposed', theirs: false});
    expect(deal(eastRoom, 'west', 'twinning')).toMatchObject({signed: false, state: 'offered', theirs: true});

    await command(e.socket, {t: 'deal', seq: 2, side: 'west', kind: 'twinning', signed: true});
    expect(deal(westRoom, 'east', 'twinning')).toMatchObject({signed: true, state: 'active', theirs: true});
    expect(deal(eastRoom, 'west', 'twinning')).toMatchObject({signed: true, state: 'active', theirs: true});

    // Trade: both sign it, but only the west city has a road at the edge
    const westRoad = await command(w.socket, {t: 'tool', seq: 3, tool: 'road', from: {x: 110, y: 50},
                                              to: {x: 119, y: 50}});
    expect(westRoad.applied).toBeGreaterThan(0);
    await command(w.socket, {t: 'deal', seq: 4, side: 'east', kind: 'trade', signed: true});
    await command(e.socket, {t: 'deal', seq: 5, side: 'west', kind: 'trade', signed: true});
    expect(westRoom.edge.east).toMatchObject({transport: true, signed: {trade: true, twinning: true}});
    expect(deal(westRoom, 'east', 'trade').state).toBe('theirLink');
    expect(deal(eastRoom, 'west', 'trade').state).toBe('noLink');

    // The east city builds its road: once its edges are looked at again (a power scan, or a deal), trade is on
    const eastRoad = await command(e.socket, {t: 'tool', seq: 6, tool: 'road', from: {x: 0, y: 40}, to: {x: 9, y: 40}});
    expect(eastRoad.applied).toBeGreaterThan(0);
    expect(deal(eastRoom, 'west', 'trade').state).toBe('active');
    runFrames(t, 3000);
    expect(deal(westRoom, 'east', 'trade').state).toBe('active');
    expect(deal(eastRoom, 'west', 'trade').state).toBe('active');

    // The players see it in their stats
    await sync(w.socket);
    const stats = w.socket.ofType('stats').pop();
    expect(stats.stats.neighbours.find((n: any) => n.side === 'east').deals.find((d: any) => d.kind === 'trade'))
      .toMatchObject({signed: true, state: 'active', theirs: true});

    // Stored with the city's save, for when it is not running
    const storedEdge = () => JSON.parse(t.db.get<{edge_state: string}>(
      'SELECT edge_state FROM cities WHERE public_id = ?', east.id)!.edge_state).west;
    expect(storedEdge().signed.trade).toBe(false);
    await e.socket.close();
    await until(() => eastRoom.clients.size === 0);
    expect(storedEdge()).toMatchObject({transport: true, signed: {trade: true, twinning: true}});
    expect(storedNeighbour(t, east.id, 'west').neighbour.deals).toMatchObject({trade: true, twinning: true});
    await w.socket.close();
  });

  test('A room closed without a save leaves the edges of its last save: no deal its city did not keep', async () => {
    const {owner, member, id} = await region(t);
    const west = await createCity(member, {name: 'Westby', region: {id, x: 0, y: 0}});
    const east = await createCity(owner, {name: 'Eastby', region: {id, x: 1, y: 0}});
    const w = await join(t, member, west.id);
    const e = await join(t, owner, east.id);
    await command(e.socket, {t: 'deal', seq: 1, side: 'west', kind: 'twinning', signed: true});
    await command(w.socket, {t: 'deal', seq: 2, side: 'east', kind: 'twinning', signed: true});
    const westRoom = roomOf(t, west.id);
    expect(deal(westRoom, 'east', 'twinning')).toMatchObject({state: 'active', theirs: true});

    // The east city's room throws before it saved its tick
    roomOf(t, east.id).city.step = () => { throw new Error('broken'); };
    runFrames(t, 100);
    expect(await e.socket.waitFor(m => m.t === 'kicked')).toEqual({t: 'kicked', reason: 'error'});
    expect(storedNeighbour(t, east.id, 'west').neighbour.deals.twinning).toBe(false);
    expect(storedNeighbour(t, east.id, 'west').edge.signed.twinning).toBe(false);
    runFrames(t, 3000, 100);
    expect(deal(westRoom, 'east', 'twinning')).toMatchObject({signed: true, state: 'proposed', theirs: false});

    // The other way: a city leaves its slot while the city beside is open, which then closes without a save: it does
    // not come back with the deal, now with the neighbour of its save
    const e2 = await join(t, owner, east.id);
    await command(e2.socket, {t: 'deal', seq: 3, side: 'west', kind: 'twinning', signed: true});
    runFrames(t, 62 * 1000, 500);
    expect(storedNeighbour(t, west.id, 'east').neighbour.deals.twinning).toBe(true);
    expect((await owner.post(`/api/regions/${id}/slots/1/0/clear`, {city: east.id})).status).toBe(204);
    expect(storedNeighbour(t, west.id, 'east').neighbour.deals.twinning).toBe(false);
    westRoom.city.step = () => { throw new Error('broken'); };
    runFrames(t, 100);
    expect(await w.socket.waitFor(m => m.t === 'kicked')).toEqual({t: 'kicked', reason: 'error'});
    const again = await join(t, member, west.id);
    expect(deal(roomOf(t, west.id), 'east', 'twinning')).toMatchObject({signed: false});
    await Promise.all([again.socket.close(), e2.socket.close()]);
  });

  test('A city leaving its slot ends its deals with the cities beside it, open or not', async () => {
    const {owner, member, id} = await region(t, 3, 2);
    const west = await createCity(member, {name: 'Westby', region: {id, x: 0, y: 0}});
    const middle = await createCity(owner, {name: 'Middle', region: {id, x: 1, y: 0}});
    const east = await createCity(owner, {name: 'Eastby', region: {id, x: 2, y: 0}});

    const w = await join(t, member, west.id);
    const m = await join(t, owner, middle.id);
    const e = await join(t, owner, east.id);
    await command(w.socket, {t: 'deal', seq: 1, side: 'east', kind: 'twinning', signed: true});
    await command(m.socket, {t: 'deal', seq: 2, side: 'west', kind: 'twinning', signed: true});
    await command(m.socket, {t: 'deal', seq: 3, side: 'east', kind: 'twinning', signed: true});
    await command(e.socket, {t: 'deal', seq: 4, side: 'west', kind: 'twinning', signed: true});
    expect(deal(roomOf(t, west.id), 'east', 'twinning').state).toBe('active');
    // The east city closes: its deals stay in its save
    await e.socket.close();
    runFrames(t, 62 * 1000, 1000);
    expect(t.app.game.rooms.get(t.app.game.cities.byPublicId(east.id)!.id)).toBeUndefined();
    expect(storedNeighbour(t, east.id, 'west').neighbour.deals.twinning).toBe(true);
    expect(storedNeighbour(t, east.id, 'west').edge.signed.twinning).toBe(true);

    // The middle city leaves: no deal left on either side
    expect((await owner.post(`/api/regions/${id}/slots/1/0/clear`, {city: middle.id})).status).toBe(204);
    const westRoom = roomOf(t, west.id);
    const middleRoom = roomOf(t, middle.id);
    expect(deal(westRoom, 'east', 'twinning')).toMatchObject({signed: false});
    expect(neighbour(westRoom, 'east').player).toBeUndefined();
    expect(neighbour(middleRoom, 'west').player).toBeUndefined();
    expect(deal(middleRoom, 'west', 'twinning').signed).toBe(false);
    expect(deal(middleRoom, 'east', 'twinning').signed).toBe(false);
    expect(middleRoom.placement).toBeNull();
    expect(storedNeighbour(t, east.id, 'west').neighbour.deals.twinning).toBe(false);
    expect(storedNeighbour(t, east.id, 'west').neighbour.months.twinning).toBe(0);
    expect(storedNeighbour(t, east.id, 'west').edge.signed.twinning).toBe(false);
    expect(JSON.parse(t.db.get<{edge_state: string}>('SELECT edge_state FROM cities WHERE public_id = ?', west.id)!
      .edge_state).east.signed.twinning).toBe(false);

    // A new city in the slot: no deal with it until both sign
    await command(w.socket, {t: 'deal', seq: 5, side: 'east', kind: 'twinning', signed: true});
    const newcomer = await createCity(owner, {name: 'Newby', region: {id, x: 1, y: 0}});
    expect(deal(westRoom, 'east', 'twinning').signed).toBe(false);
    expect(neighbour(westRoom, 'east')).toMatchObject({name: 'Newby', player: true});
    expect(storedNeighbour(t, newcomer.id, 'west').neighbour.deals.twinning).toBe(false);

    await Promise.all([w.socket.close(), m.socket.close()]);
  });

  test('Deleting a city, or the account of a region\'s owner', async () => {
    const {owner, member, id} = await region(t);
    const west = await createCity(member, {name: 'Westby', region: {id, x: 0, y: 0}});
    const east = await createCity(owner, {name: 'Eastby', region: {id, x: 1, y: 0}});
    const w = await join(t, member, west.id);
    await command(w.socket, {t: 'deal', seq: 1, side: 'east', kind: 'twinning', signed: true});

    expect((await owner.post(`/api/cities/${east.id}/delete`)).status).toBe(204);
    const westRoom = roomOf(t, west.id);
    expect(neighbour(westRoom, 'east').player).toBeUndefined();
    expect(deal(westRoom, 'east', 'twinning').signed).toBe(false);

    // The region's owner deletes their account: the region goes, the member's city stays
    await createCity(owner, {name: 'Again', region: {id, x: 1, y: 0}});
    const {auth} = t.app.context;
    t.db.transaction(() => {
      for (const hook of auth.deletionHooks)
        hook(owner.id);
      auth.users.delete(owner.id);
    });
    await flushSockets();
    expect((await member.get('/api/cities')).json.cities).toEqual([expect.objectContaining({id: west.id,
                                                                                            region: null})]);
    expect(westRoom.placement).toBeNull();
    expect((await member.get('/api/regions')).json.regions).toEqual([]);
    await w.socket.close();
  });

  test('The admin command user delete takes the region along in the stored saves too', async () => {
    const {owner, member, id} = await region(t, 2, 2);
    const west = await createCity(member, {name: 'Westby', region: {id, x: 0, y: 0}});
    const south = await createCity(member, {name: 'Southby', region: {id, x: 0, y: 1}});
    const east = await createCity(owner, {name: 'Eastby', region: {id, x: 1, y: 0}});
    const w = await join(t, member, west.id);
    const s = await join(t, member, south.id);
    const e = await join(t, owner, east.id);
    await command(w.socket, {t: 'deal', seq: 1, side: 'east', kind: 'twinning', signed: true});
    await command(w.socket, {t: 'deal', seq: 2, side: 'south', kind: 'twinning', signed: true});
    await command(s.socket, {t: 'deal', seq: 3, side: 'north', kind: 'twinning', signed: true});
    await command(e.socket, {t: 'deal', seq: 4, side: 'west', kind: 'twinning', signed: true});
    expect(deal(roomOf(t, west.id), 'east', 'twinning').state).toBe('active');
    // Every city closes (the command runs beside a server whose rooms are closed)
    await Promise.all([w.socket.close(), s.socket.close(), e.socket.close()]);
    runFrames(t, 62 * 1000, 1000);
    expect(storedNeighbour(t, west.id, 'east').neighbour.deals.twinning).toBe(true);

    const out: string[] = [];
    const context: AdminContext = {config: t.config, clock: t.clock, databaseFile: ':memory:',
                                   openDatabase: () => t.db, out: line => { out.push(line); }, err: line => { out.push(line); }};
    expect(await runAdminCommand(['user', 'delete', 'Ruth'], context)).toBe(0);
    expect(out).toEqual([expect.stringMatching(/^Deleted the account Ruth /)]);

    // The member's cities are out of the region, with no deal left with the deleted city, nor with each other
    for (const city of [west, south]) {
      expect(t.db.get('SELECT region_id, region_x, region_y FROM cities WHERE public_id = ?', city.id))
        .toEqual({region_id: null, region_x: null, region_y: null});
    }
    for (const [city, side] of [[west, 'east'], [west, 'south'], [south, 'north']] as const) {
      const stored = storedNeighbour(t, city.id, side);
      expect(stored.neighbour.deals.twinning).toBe(false);
      expect(stored.neighbour.months.twinning).toBe(0);
      expect(stored.edge.signed.twinning).toBe(false);
    }
    expect(t.app.game.cities.byPublicId(east.id)).toBeNull();

    // Reopened, they are cities of their own
    const again = await join(t, member, west.id);
    expect(again.welcome.city.region).toBeNull();
    expect(neighbour(roomOf(t, west.id), 'east').player).toBeUndefined();
    await again.socket.close();
  });

  test('The admin command user delete beside open rooms: their deals with its cities end, and stay ended', async () => {
    const adminContext = (): AdminContext => ({config: t.config, clock: t.clock, databaseFile: ':memory:',
                                               openDatabase: () => t.db, out: () => {}, err: () => {}});
    const twinning = (room: Room, side: string) => ({player: !!neighbour(room, side).player,
                                                     signed: deal(room, side, 'twinning').signed});

    // The region's owner deletes their account: the member's city leaves the region, its twinning with them ends
    const {owner, member, id} = await region(t, 3, 2);
    const west = await createCity(member, {name: 'Westby', region: {id, x: 0, y: 0}});
    const east = await createCity(owner, {name: 'Eastby', region: {id, x: 1, y: 0}});
    const w = await join(t, member, west.id);
    const e = await join(t, owner, east.id);
    await command(w.socket, {t: 'deal', seq: 1, side: 'east', kind: 'twinning', signed: true});
    await command(e.socket, {t: 'deal', seq: 2, side: 'west', kind: 'twinning', signed: true});
    expect(deal(roomOf(t, west.id), 'east', 'twinning').state).toBe('active');
    await e.socket.close();

    expect(await runAdminCommand(['user', 'delete', 'Ruth'], adminContext())).toBe(0);
    runFrames(t, 3000, 100);
    const westRoom = roomOf(t, west.id);
    expect(westRoom.placement).toBeNull();
    expect(twinning(westRoom, 'east')).toEqual({player: false, signed: false});
    // Its saves no longer bring the deal back, nor does closing it
    runFrames(t, 62 * 1000, 500);
    expect(storedNeighbour(t, west.id, 'east').neighbour.deals.twinning).toBe(false);
    expect(storedNeighbour(t, west.id, 'east').edge.signed.twinning).toBe(false);
    await w.socket.close();
    runFrames(t, 62 * 1000, 1000);
    expect(t.app.game.rooms.rooms.size).toBe(0);
    expect(storedNeighbour(t, west.id, 'east').neighbour.deals.twinning).toBe(false);
    expect(storedNeighbour(t, west.id, 'east').neighbour.months.twinning).toBe(0);

    // A member who only owned the city beside: the region stays, the twinning with that city ends
    const zed = addPlayer(t, 'Zed');
    const made = await zed.post('/api/regions', {name: 'Valley', width: 2, height: 2});
    const valley = made.json.region.id;
    const carol = addPlayer(t, 'Carol');
    for (const invitee of [member, carol]) {
      expect((await zed.post(`/api/regions/${valley}/invitations`, {username: invitee.username})).status).toBe(201);
      const invitation = (await invitee.get('/api/cities')).json.invitations.find((i: any) => i.kind === 'region');
      expect((await invitee.post(`/api/invitations/${invitation.id}/accept`)).status).toBe(200);
    }
    const left = await createCity(member, {name: 'Leftby', region: {id: valley, x: 0, y: 0}});
    const right = await createCity(carol, {name: 'Rightby', region: {id: valley, x: 1, y: 0}});
    const l = await join(t, member, left.id);
    const r = await join(t, carol, right.id);
    await command(l.socket, {t: 'deal', seq: 3, side: 'east', kind: 'twinning', signed: true});
    await command(r.socket, {t: 'deal', seq: 4, side: 'west', kind: 'twinning', signed: true});
    expect(await runAdminCommand(['user', 'delete', 'Carol'], adminContext())).toBe(0);
    runFrames(t, 3000, 100);
    expect(await r.socket.waitFor(m => m.t === 'kicked')).toEqual({t: 'kicked', reason: 'deleted'});
    const leftRoom = roomOf(t, left.id);
    expect(leftRoom.placement).toMatchObject({x: 0, y: 0});
    expect(twinning(leftRoom, 'east')).toEqual({player: false, signed: false});
    await l.socket.close();
    runFrames(t, 62 * 1000, 1000);
    expect(storedNeighbour(t, left.id, 'east').neighbour.deals.twinning).toBe(false);
  }, 30 * 1000);
});
