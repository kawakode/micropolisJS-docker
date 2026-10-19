/* KawaCity, a modified version of micropolisJS.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

import type { AppContext } from '../app';
import { usernameKey } from '../auth/users';
import { invalidInput, readEmpty, readFields } from '../auth/validate';
import type { RequestContext, RequestUser } from '../http/request';
import { attachment, HttpError, json, noContent } from '../http/response';
import type { RateLimitRule } from '../http/router';
import { UPLOAD_BODY_LIMIT } from '../limits';
import { isPublicId } from '../security/tokens';
import { CITY_LIMITS, CityRow, CityStore, decodeState, encodeState, InvitedRole, isInvitedRole, notFound,
         pendingInvitations, PALETTE, yearOf } from './cityStore';
import { checkText, CITY_NAME_MAX, REGION_NAME_MAX } from './names';
import { FACING, RegionLink } from './regionLink';
import { REGION_LIMITS, RegionRow, RegionStore } from './regionStore';
import type { RoomManager } from './roomManager';
import { prepareCity, SaveError } from './saveValidation';

// The lobby of the shared cities and regions (DESIGN §5.3): a session is required; ids are public ids. Someone who is
// not a member of a city or a region gets 404 not_found for it, whatever they ask; a member asking for what their role
// does not allow gets 403 forbidden.
//
//   GET  /api/cities                                   {cities: [city], invitations: [invitation]}
//   POST /api/cities {name, level, save, region?: {id, x, y}}   201 {city}
//   GET  /api/cities/:id                               {city, members: [{id, username, role, colour, online}],
//                                                       invitations (owner only): [{id, username, role, createdAt}]}
//   PATCH /api/cities/:id {name}                       owner: {city}
//   POST /api/cities/:id/delete {}                     owner: 204
//   GET  /api/cities/:id/save                          a .kawacity file (application/json)
//   POST /api/cities/:id/invitations {username, role}  owner: 201 {ok: true} (also when not made: the invitee has too
//                                                       many); 404 unknown user; 409 conflict already a member
//   POST /api/cities/:id/members/:userId {role}        owner: {members}
//   POST /api/cities/:id/members/:userId/remove {}     owner, or the member (leaving): 204
//   POST /api/cities/:id/owner {member}                owner: {city}, handed over to that member (the owner before
//                                                       stays, as a player); 403 limit_reached they own too many; 409
//                                                       conflict not a member of the city's region
//   POST /api/cities/:id/place {region: {id, x, y}}    owner: {city}, moved to that free place of a region the owner is
//                                                       a member of (out of its region before, if any); 409 conflict
//                                                       the place is taken
//   POST /api/invitations/:id/accept {}                invitee: {city} or {region}
//   POST /api/invitations/:id/decline {}               invitee: 204
//   POST /api/invitations/:id/cancel {}                inviter (or the owner of the city or region): 204
//   POST /api/invitations/decline-all {from: userId}   204: every invitation from that user declined
//   GET  /api/regions                                  {regions: [region]}
//   GET  /api/public-regions                           {regions: [region + members]}: the public regions the user may
//                                                       join, newest first, at most 50
//   POST /api/regions {name, width, height, public?}   201 {region}
//   GET  /api/regions/:id                              {region, slots: [{x, y, city: {id, name, ownerName,
//                                                       population, role} | null}], members: [{id, username,
//                                                       owner}], invitations (owner only)}
//   PATCH /api/regions/:id {name?, public?}            region owner: {region}
//   POST /api/regions/:id/join {}                      a public region: {region}; 409 conflict already a member; 403
//                                                       forbidden removed by its owner, limit_reached no room left
//   POST /api/regions/:id/delete {}                    region owner: 204 (its cities stay, out of the region)
//   POST /api/regions/:id/invitations {username}       region owner: 201 {ok: true}
//   POST /api/regions/:id/members/:userId/remove {}    region owner, or the member (leaving): 204 (their cities leave)
//   POST /api/regions/:id/slots/:x/:y/clear {city}     the city's owner or the region's owner: 204; 409 conflict when
//                                                       the city there is not that one
//
// city = {id, name, role, ownerName, population, year, online, region: {id, name, x, y} | null}
// region = {id, name, ownerName, width, height, public, mine, cities}
// invitation = {id, kind: 'city' | 'region', target: {id, name}, inviterId, inviterName, role (null for a region)}

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

export const LOBBY_LIMITS = {
  creations: {name: 'city-create', limit: 10, windowMs: HOUR, per: 'user'},
  regionCreations: {name: 'region-create', limit: 10, windowMs: HOUR, per: 'user'},
  // Invitations sent, to cities and regions together: counted once the request is checked
  invitations: {name: 'invitations', limit: 20, windowMs: HOUR, per: 'user'},
  downloads: {name: 'city-download', limit: 30, windowMs: HOUR, per: 'user'},
  regionJoins: {name: 'region-join', limit: 20, windowMs: HOUR, per: 'user'},
} as const satisfies Record<string, RateLimitRule>;

// The longest username looked up (a username is at most 20 code points)
const USERNAME_FIELD = 256;

export interface Lobby {
  cities: CityStore;
  regions: RegionStore;
  rooms: RoomManager;
  link: RegionLink;
}

const isIntegerIn = (value: unknown, min: number, max: number): value is number =>
  Number.isInteger(value) && (value as number) >= min && (value as number) <= max;

const nameField = (value: unknown, field: string, max: number): string => {
  const checked = checkText(value, max);
  if (!checked.ok)
    throw invalidInput({[field]: checked.reason});
  return checked.text;
};

const signedInUser = (ctx: RequestContext): RequestUser => ctx.user as RequestUser;

export function registerLobbyRoutes(context: AppContext, lobby: Lobby): void {
  const {auth, clock, config, db, log, router} = context;
  const {cities, regions, rooms, link} = lobby;
  const required = {auth: 'required'} as const;

  const logFields = (ctx: RequestContext) => ({requestId: ctx.requestId, ip: ctx.ipKey, user: ctx.user?.publicId});

  // Views

  const regionPlacement = (row: CityRow): {id: string; name: string; x: number; y: number} | null => {
    if (row.region_id === null)
      return null;
    const region = regions.byId(row.region_id);
    return region ? {id: region.public_id, name: region.name, x: row.region_x as number, y: row.region_y as number}
                  : null;
  };

  const cityView = (row: CityRow, role: string, ownerName: string,
                    region: {id: string; name: string; x: number; y: number} | null) => {
    const room = rooms.get(row.id);
    return {
      id: row.public_id,
      name: row.name,
      role,
      ownerName,
      population: room ? room.city.population : row.population,
      year: yearOf(room ? room.city.cityTime : row.city_time),
      online: room ? room.online : 0,
      region,
    };
  };

  const fullCityView = (row: CityRow, userId: number) => {
    const member = cities.member(row.id, userId);
    return cityView(row, member?.role ?? 'viewer', cities.ownerName(row), regionPlacement(row));
  };

  const regionView = (region: RegionRow, userId: number) => ({
    id: region.public_id,
    name: region.name,
    ownerName: regions.ownerName(region),
    width: region.width,
    height: region.height,
    public: region.is_public === 1,
    mine: region.owner_id === userId,
    cities: regions.cityCount(region.id),
  });

  const membersView = (cityId: number) => {
    const room = rooms.get(cityId);
    const online = new Set(room ? [...room.clients].map(client => client.userId) : []);
    return cities.members(cityId).map(member => ({
      id: member.public_id,
      username: member.username,
      role: member.role,
      colour: PALETTE[member.colour] ?? PALETTE[0],
      online: online.has(member.user_id),
    }));
  };

  // The user an invitation goes to: 404 not_found when there is none by that name
  const invitee = (value: unknown) => {
    if (typeof value !== 'string')
      throw invalidInput({username: 'invalid'});
    if (value.trim() === '')
      throw invalidInput({username: 'required'});
    if (value.length > USERNAME_FIELD)
      throw invalidInput({username: 'too_long'});
    const user = auth.users.byUsernameKey(usernameKey(value.trim()));
    if (!user)
      throw notFound();
    return user;
  };

  // The member a route names (:userId), if they are a user
  const namedUser = (value: unknown) => {
    const user = isPublicId(value) ? auth.users.byPublicId(value) : null;
    if (!user)
      throw notFound();
    return user;
  };

  // Cities

  router.get('/api/cities', ctx => {
    const user = signedInUser(ctx);
    const list = cities.listForUser(user.id).map(row => cityView(row, row.role, row.owner_name,
      row.region_public_id === null || row.region_name === null ? null :
        {id: row.region_public_id, name: row.region_name, x: row.region_x as number, y: row.region_y as number}));

    const invitations = db.all<{public_id: string; kind: 'city' | 'region'; target_id: string; target_name: string;
                                inviter_id: string; inviter_name: string; role: InvitedRole | null}>(
      `SELECT i.public_id, 'city' AS kind, c.public_id AS target_id, c.name AS target_name, u.public_id AS inviter_id,
              u.username AS inviter_name, i.role, i.created_at AS created_at
       FROM city_invitations i JOIN cities c ON c.id = i.city_id JOIN users u ON u.id = i.inviter_id
       WHERE i.invitee_id = ?
       UNION ALL
       SELECT i.public_id, 'region' AS kind, r.public_id AS target_id, r.name AS target_name,
              u.public_id AS inviter_id, u.username AS inviter_name, NULL AS role, i.created_at AS created_at
       FROM region_invitations i JOIN regions r ON r.id = i.region_id JOIN users u ON u.id = i.inviter_id
       WHERE i.invitee_id = ?
       ORDER BY created_at DESC`, user.id, user.id).map(row => ({
      id: row.public_id,
      kind: row.kind,
      target: {id: row.target_id, name: row.target_name},
      inviterId: row.inviter_id,
      inviterName: row.inviter_name,
      role: row.role,
    }));

    json(ctx.res, 200, {cities: list, invitations});
  }, required);

  // Whether the user may make a city (in that slot): checked before the save, and again when the city is made
  const checkCreation = (userId: number, slot: {publicId: string; x: number; y: number} | null) => {
    if (cities.count() >= config.maxCities)
      throw new HttpError(503, 'server_busy');
    if (cities.ownedCount(userId) >= CITY_LIMITS.ownedCities)
      throw new HttpError(403, 'limit_reached');
    if (!slot)
      return null;

    const region = regions.forMember(slot.publicId, userId);
    if (slot.x >= region.width || slot.y >= region.height)
      throw invalidInput({region: 'invalid'});
    if (regions.cityAt(region.id, slot.x, slot.y))
      throw new HttpError(409, 'conflict');
    return region;
  };

  router.post('/api/cities', ctx => {
    const user = signedInUser(ctx);
    const body = readFields(ctx.body, ['name', 'level', 'save'], ['region']);
    const name = nameField(body.name, 'name', CITY_NAME_MAX);
    if (!isIntegerIn(body.level, 0, 2))
      throw invalidInput({level: 'invalid'});
    const level = body.level;

    let slot: {publicId: string; x: number; y: number} | null = null;
    if (body.region !== undefined) {
      const region = body.region;
      if (region === null || typeof region !== 'object' || Array.isArray(region))
        throw invalidInput({region: 'invalid'});
      const {id, x, y} = readFields(region, ['id', 'x', 'y']);
      if (typeof id !== 'string' || !isIntegerIn(x, 0, REGION_LIMITS.maxSize - 1) ||
          !isIntegerIn(y, 0, REGION_LIMITS.maxSize - 1))
        throw invalidInput({region: 'invalid'});
      slot = {publicId: id, x, y};
    }

    checkCreation(user.id, slot);

    let prepared;
    try {
      prepared = prepareCity(body.save, {name, level});
    } catch (error) {
      if (!(error instanceof SaveError))
        throw error;
      log.info('city.invalid_save', {...logFields(ctx), field: error.field});
      throw invalidInput({save: 'invalid'});
    }

    const state = encodeState(prepared.saveText);
    const now = clock.now();
    const {row, touched} = db.transaction(() => {
      const region = checkCreation(user.id, slot);
      const created = cities.create({
        ownerId: user.id, name, state, population: prepared.population, cityTime: prepared.cityTime,
        paused: prepared.paused, edgeState: prepared.edgeState, now,
        region: region && slot ? {id: region.id, x: slot.x, y: slot.y} : null,
      });
      // In a region: no deal goes on between the new city and those beside it until both sign it
      return {row: created, touched: region ? link.clearAround(created.id) : []};
    });
    link.refreshAround(touched);

    log.info('city.create', {...logFields(ctx), city: row.public_id, region: slot?.publicId});
    json(ctx.res, 201, {city: cityView(row, 'owner', user.username, regionPlacement(row))});
  }, {...required, bodyLimit: UPLOAD_BODY_LIMIT, limits: [LOBBY_LIMITS.creations]});

  router.get('/api/cities/:id', ctx => {
    const user = signedInUser(ctx);
    const {city, member} = cities.forMember(ctx.params.id, user.id);
    const result: Record<string, unknown> = {
      city: cityView(city, member.role, cities.ownerName(city), regionPlacement(city)),
      members: membersView(city.id),
    };
    if (member.role === 'owner')
      result.invitations = cities.invitationsTo(city.id).map(invitation => ({
        id: invitation.public_id,
        username: invitation.invitee_name,
        userId: invitation.invitee_public_id,
        role: invitation.role,
        createdAt: invitation.created_at,
      }));
    json(ctx.res, 200, result);
  }, required);

  router.patch('/api/cities/:id', ctx => {
    const user = signedInUser(ctx);
    const {city} = cities.forOwner(ctx.params.id, user.id);
    const body = readFields(ctx.body, ['name']);
    const name = nameField(body.name, 'name', CITY_NAME_MAX);

    cities.rename(city.id, name, clock.now());
    rooms.renamed(city.id, name);
    link.refreshAround([city.id]);
    json(ctx.res, 200, {city: fullCityView(cities.byId(city.id) as CityRow, user.id)});
  }, required);

  router.post('/api/cities/:id/delete', ctx => {
    const user = signedInUser(ctx);
    const {city} = cities.forOwner(ctx.params.id, user.id);
    readEmpty(ctx.body);

    const touched = db.transaction(() => {
      // The cities beside it lose it as their neighbour, and the deals with it
      const besides = link.neighboursOf(city.id);
      for (const [side, id] of besides)
        link.clearSides(id, [FACING[side]]);
      rooms.evict([city.id], 'deleted');
      cities.delete(city.id);
      return [...besides.values()];
    });
    link.refreshAround(touched);

    log.info('city.delete', {...logFields(ctx), city: city.public_id});
    noContent(ctx.res);
  }, required);

  router.get('/api/cities/:id/save', ctx => {
    const user = signedInUser(ctx);
    const {city} = cities.forMember(ctx.params.id, user.id);
    const room = rooms.get(city.id);
    let text: string;
    if (room) {
      text = room.city.saveText();
    } else {
      const state = cities.state(city.id);
      if (!state)
        throw notFound();
      // The row has the city's name (it may have been renamed since the city last ran)
      const save = decodeState(state);
      save.name = city.name;
      text = JSON.stringify(save);
    }
    attachment(ctx.res, {name: city.name, extension: 'kawacity', contentType: 'application/json; charset=utf-8',
                         body: text});
  }, {...required, limits: [LOBBY_LIMITS.downloads]});

  router.post('/api/cities/:id/invitations', ctx => {
    const user = signedInUser(ctx);
    const {city} = cities.forOwner(ctx.params.id, user.id);
    const body = readFields(ctx.body, ['username', 'role']);
    if (!isInvitedRole(body.role))
      throw invalidInput({role: 'invalid'});
    const role = body.role;
    context.limit(ctx, LOBBY_LIMITS.invitations);
    const target = invitee(body.username);

    db.transaction(() => {
      if (cities.member(city.id, target.id))
        throw new HttpError(409, 'conflict');
      if (cities.memberCount(city.id) >= CITY_LIMITS.members)
        throw new HttpError(403, 'limit_reached');

      const existing = cities.invitationFor(city.id, target.id);
      if (existing)
        cities.setInvitationRole(existing.id, role);
      else if (pendingInvitations(db, target.id) < CITY_LIMITS.pendingInvitations)
        cities.invite(city.id, user.id, target.id, role, clock.now());
    });

    log.info('city.invite', {...logFields(ctx), city: city.public_id});
    json(ctx.res, 201, {ok: true});
  }, required);

  router.post('/api/cities/:id/members/:userId', ctx => {
    const user = signedInUser(ctx);
    const {city} = cities.forOwner(ctx.params.id, user.id);
    const target = namedUser(ctx.params.userId);
    const body = readFields(ctx.body, ['role']);
    if (!isInvitedRole(body.role))
      throw invalidInput({role: 'invalid'});

    const member = cities.member(city.id, target.id);
    if (!member)
      throw notFound();
    if (member.role === 'owner')
      throw new HttpError(409, 'conflict');

    cities.setRole(city.id, target.id, body.role);
    rooms.membersChanged(city.id);
    json(ctx.res, 200, {members: membersView(city.id)});
  }, required);

  router.post('/api/cities/:id/members/:userId/remove', ctx => {
    const user = signedInUser(ctx);
    const {city, member: actor} = cities.forMember(ctx.params.id, user.id);
    const target = namedUser(ctx.params.userId);
    readEmpty(ctx.body);

    const member = cities.member(city.id, target.id);
    if (!member)
      throw notFound();
    if (actor.role !== 'owner' && target.id !== user.id)
      throw new HttpError(403, 'forbidden');
    // The owner does not leave a city: they delete it
    if (member.role === 'owner')
      throw new HttpError(409, 'conflict');

    cities.removeMember(city.id, target.id);
    rooms.membersChanged(city.id);
    log.info(target.id === user.id ? 'city.leave' : 'city.remove_member', {...logFields(ctx), city: city.public_id});
    noContent(ctx.res);
  }, required);

  // Handing a city over to another of its members
  router.post('/api/cities/:id/owner', ctx => {
    const user = signedInUser(ctx);
    const {city} = cities.forOwner(ctx.params.id, user.id);
    const body = readFields(ctx.body, ['member']);
    if (typeof body.member !== 'string')
      throw invalidInput({member: 'invalid'});
    const target = namedUser(body.member);

    db.transaction(() => {
      const member = cities.member(city.id, target.id);
      if (!member)
        throw notFound();
      if (member.role === 'owner')
        throw new HttpError(409, 'conflict');
      // A city of a region belongs to one of the region's members
      if (city.region_id !== null && !regions.isMember(city.region_id, target.id))
        throw new HttpError(409, 'conflict');
      if (cities.ownedCount(target.id) >= CITY_LIMITS.ownedCities)
        throw new HttpError(403, 'limit_reached');
      cities.setOwner(city.id, user.id, target.id, clock.now());
    });
    rooms.ownerChanged(city.id, target.username);
    // The cities beside it show its new mayor
    link.refreshAround([city.id]);

    log.info('city.hand_over', {...logFields(ctx), city: city.public_id, to: target.public_id});
    json(ctx.res, 200, {city: fullCityView(cities.byId(city.id) as CityRow, user.id)});
  }, required);

  // Moving a city to a free place of a region: its deals with the cities beside it, before and after, end
  router.post('/api/cities/:id/place', ctx => {
    const user = signedInUser(ctx);
    const {city} = cities.forOwner(ctx.params.id, user.id);
    const body = readFields(ctx.body, ['region']);
    const place = body.region;
    if (place === null || typeof place !== 'object' || Array.isArray(place))
      throw invalidInput({region: 'invalid'});
    const {id, x, y} = readFields(place, ['id', 'x', 'y']);
    if (typeof id !== 'string' || !isIntegerIn(x, 0, REGION_LIMITS.maxSize - 1) ||
        !isIntegerIn(y, 0, REGION_LIMITS.maxSize - 1))
      throw invalidInput({region: 'invalid'});

    const touched = db.transaction(() => {
      const region = regions.forMember(id, user.id);
      if (x >= region.width || y >= region.height)
        throw invalidInput({region: 'invalid'});
      const current = cities.byId(city.id) as CityRow;
      if (regions.cityAt(region.id, x, y) ||
          (current.region_id === region.id && current.region_x === x && current.region_y === y))
        throw new HttpError(409, 'conflict');

      const moved = current.region_id === null ? [] : link.clearAround(city.id);
      cities.setRegion(city.id, {id: region.id, x, y}, clock.now());
      return [...moved, ...link.clearAround(city.id)];
    });
    link.refreshAround(touched);

    log.info('city.move', {...logFields(ctx), city: city.public_id, region: id});
    json(ctx.res, 200, {city: fullCityView(cities.byId(city.id) as CityRow, user.id)});
  }, required);

  // Invitations

  // The invitation of that id, to a city or a region, that `who` may act on (else 404)
  const findInvitation = (publicId: unknown, userId: number, who: 'invitee' | 'inviter') => {
    const cityInvitation = cities.invitationByPublicId(publicId);
    if (cityInvitation) {
      const city = cities.byId(cityInvitation.city_id);
      const allowed = who === 'invitee' ? cityInvitation.invitee_id === userId :
        cityInvitation.inviter_id === userId || city?.owner_id === userId;
      if (allowed)
        return {kind: 'city' as const, invitation: cityInvitation};
    }

    const regionInvitation = regions.invitationByPublicId(publicId);
    if (regionInvitation) {
      const region = regions.byId(regionInvitation.region_id);
      const allowed = who === 'invitee' ? regionInvitation.invitee_id === userId :
        regionInvitation.inviter_id === userId || region?.owner_id === userId;
      if (allowed)
        return {kind: 'region' as const, invitation: regionInvitation};
    }

    throw notFound();
  };

  router.post('/api/invitations/decline-all', ctx => {
    const user = signedInUser(ctx);
    const body = readFields(ctx.body, ['from']);
    if (typeof body.from !== 'string')
      throw invalidInput({from: 'invalid'});
    const from = isPublicId(body.from) ? auth.users.byPublicId(body.from) : null;
    if (from) {
      db.transaction(() => {
        db.run('DELETE FROM city_invitations WHERE invitee_id = ? AND inviter_id = ?', user.id, from.id);
        db.run('DELETE FROM region_invitations WHERE invitee_id = ? AND inviter_id = ?', user.id, from.id);
      });
    }
    noContent(ctx.res);
  }, required);

  router.post('/api/invitations/:id/accept', ctx => {
    const user = signedInUser(ctx);
    readEmpty(ctx.body);
    const found = findInvitation(ctx.params.id, user.id, 'invitee');
    const now = clock.now();

    if (found.kind === 'city') {
      const invitation = found.invitation;
      const city = db.transaction(() => {
        const target = cities.byId(invitation.city_id);
        if (!target)
          throw notFound();
        if (cities.member(target.id, user.id)) {
          cities.deleteInvitation(invitation.id);
          throw new HttpError(409, 'conflict');
        }
        if (cities.memberCount(target.id) >= CITY_LIMITS.members)
          throw new HttpError(403, 'limit_reached');
        cities.addMember(target.id, user.id, invitation.role, now);
        cities.deleteInvitation(invitation.id);
        return target;
      });
      rooms.membersChanged(city.id);
      log.info('city.join', {...logFields(ctx), city: city.public_id});
      json(ctx.res, 200, {city: fullCityView(city, user.id)});
      return;
    }

    const invitation = found.invitation;
    const region = db.transaction(() => {
      const target = regions.byId(invitation.region_id);
      if (!target)
        throw notFound();
      if (regions.isMember(target.id, user.id)) {
        regions.deleteInvitation(invitation.id);
        throw new HttpError(409, 'conflict');
      }
      if (regions.memberCount(target.id) >= REGION_LIMITS.members)
        throw new HttpError(403, 'limit_reached');
      regions.addMember(target.id, user.id, now);
      regions.deleteInvitation(invitation.id);
      // Invited back by the owner: they may join the region again, if it is public, once they leave it
      regions.forgetRemoval(target.id, user.id);
      return target;
    });
    log.info('region.join', {...logFields(ctx), region: region.public_id});
    json(ctx.res, 200, {region: regionView(region, user.id)});
  }, required);

  router.post('/api/invitations/:id/decline', ctx => {
    const user = signedInUser(ctx);
    readEmpty(ctx.body);
    const found = findInvitation(ctx.params.id, user.id, 'invitee');
    if (found.kind === 'city')
      cities.deleteInvitation(found.invitation.id);
    else
      regions.deleteInvitation(found.invitation.id);
    noContent(ctx.res);
  }, required);

  router.post('/api/invitations/:id/cancel', ctx => {
    const user = signedInUser(ctx);
    readEmpty(ctx.body);
    const found = findInvitation(ctx.params.id, user.id, 'inviter');
    if (found.kind === 'city')
      cities.deleteInvitation(found.invitation.id);
    else
      regions.deleteInvitation(found.invitation.id);
    noContent(ctx.res);
  }, required);

  // Regions

  router.get('/api/regions', ctx => {
    const user = signedInUser(ctx);
    json(ctx.res, 200, {regions: regions.listForUser(user.id).map(region => ({
      id: region.public_id,
      name: region.name,
      ownerName: region.owner_name,
      width: region.width,
      height: region.height,
      public: region.is_public === 1,
      mine: region.owner_id === user.id,
      cities: region.cities,
    }))});
  }, required);

  router.get('/api/public-regions', ctx => {
    const user = signedInUser(ctx);
    json(ctx.res, 200, {regions: regions.publicFor(user.id).map(region => ({
      id: region.public_id,
      name: region.name,
      ownerName: region.owner_name,
      width: region.width,
      height: region.height,
      public: true,
      mine: false,
      cities: region.cities,
      members: region.members,
    }))});
  }, required);

  router.post('/api/regions', ctx => {
    const user = signedInUser(ctx);
    const body = readFields(ctx.body, ['name', 'width', 'height'], ['public']);
    const name = nameField(body.name, 'name', REGION_NAME_MAX);
    const fields: Record<string, 'invalid'> = {};
    for (const key of ['width', 'height'] as const) {
      if (!isIntegerIn(body[key], REGION_LIMITS.minSize, REGION_LIMITS.maxSize))
        fields[key] = 'invalid';
    }
    if (body.public !== undefined && typeof body.public !== 'boolean')
      fields.public = 'invalid';
    if (Object.keys(fields).length > 0)
      throw invalidInput(fields);

    const region = db.transaction(() => {
      if (regions.ownedCount(user.id) >= REGION_LIMITS.ownedRegions)
        throw new HttpError(403, 'limit_reached');
      return regions.create(user.id, name, body.width as number, body.height as number, body.public === true,
                            clock.now());
    });
    log.info('region.create', {...logFields(ctx), region: region.public_id, public: region.is_public === 1});
    json(ctx.res, 201, {region: regionView(region, user.id)});
  }, {...required, limits: [LOBBY_LIMITS.regionCreations]});

  router.get('/api/regions/:id', ctx => {
    const user = signedInUser(ctx);
    const region = regions.forMember(ctx.params.id, user.id);
    const placed = regions.slots(region.id);
    const slots = [];
    for (let y = 0; y < region.height; y++) {
      for (let x = 0; x < region.width; x++) {
        const slot = placed.find(s => s.region_x === x && s.region_y === y);
        const room = slot ? rooms.get(slot.city_id) : undefined;
        slots.push({x, y, city: slot ? {
          id: slot.city_public_id,
          name: slot.name,
          ownerName: slot.owner_name,
          population: room ? room.city.population : slot.population,
          role: cities.member(slot.city_id, user.id)?.role ?? null,
        } : null});
      }
    }

    const result: Record<string, unknown> = {
      region: regionView(region, user.id),
      slots,
      members: regions.members(region.id).map(member => ({id: member.public_id, username: member.username,
                                                          owner: member.user_id === region.owner_id})),
    };
    if (region.owner_id === user.id)
      result.invitations = db.all<{public_id: string; username: string; user_public_id: string; created_at: number}>(
        `SELECT i.public_id, u.username, u.public_id AS user_public_id, i.created_at
         FROM region_invitations i JOIN users u ON u.id = i.invitee_id WHERE i.region_id = ? ORDER BY i.created_at`,
        region.id).map(row => ({id: row.public_id, username: row.username, userId: row.user_public_id,
                                createdAt: row.created_at}));
    json(ctx.res, 200, result);
  }, required);

  router.patch('/api/regions/:id', ctx => {
    const user = signedInUser(ctx);
    const region = regions.forOwner(ctx.params.id, user.id);
    const body = readFields(ctx.body, [], ['name', 'public']);
    if (body.name === undefined && body.public === undefined)
      throw invalidInput();
    const name = body.name === undefined ? null : nameField(body.name, 'name', REGION_NAME_MAX);
    if (body.public !== undefined && typeof body.public !== 'boolean')
      throw invalidInput({public: 'invalid'});

    const now = clock.now();
    db.transaction(() => {
      if (name !== null)
        regions.rename(region.id, name, now);
      if (typeof body.public === 'boolean')
        regions.setPublic(region.id, body.public, now);
    });
    if (name !== null)
      link.refreshAround(regions.slots(region.id).map(slot => slot.city_id));
    if (typeof body.public === 'boolean' && body.public !== (region.is_public === 1))
      log.info('region.visibility', {...logFields(ctx), region: region.public_id, public: body.public});
    json(ctx.res, 200, {region: regionView(regions.byId(region.id) as RegionRow, user.id)});
  }, required);

  // A public region, joined without an invitation. Someone who is not a member of a region that is not public is told
  // it does not exist, as for any other route.
  router.post('/api/regions/:id/join', ctx => {
    const user = signedInUser(ctx);
    readEmpty(ctx.body);
    const found = regions.byPublicId(ctx.params.id);
    if (!found || (found.is_public !== 1 && !regions.isMember(found.id, user.id)))
      throw notFound();
    context.limit(ctx, LOBBY_LIMITS.regionJoins);

    const region = db.transaction(() => {
      const target = regions.byId(found.id);
      if (!target)
        throw notFound();
      if (regions.isMember(target.id, user.id))
        throw new HttpError(409, 'conflict');
      if (target.is_public !== 1)
        throw notFound();
      if (regions.wasRemoved(target.id, user.id))
        throw new HttpError(403, 'forbidden');
      if (regions.memberCount(target.id) >= REGION_LIMITS.members)
        throw new HttpError(403, 'limit_reached');
      regions.addMember(target.id, user.id, clock.now());
      // An invitation to it has no use any more
      const invitation = regions.invitationFor(target.id, user.id);
      if (invitation)
        regions.deleteInvitation(invitation.id);
      return target;
    });
    log.info('region.join', {...logFields(ctx), region: region.public_id, public: true});
    json(ctx.res, 200, {region: regionView(region, user.id)});
  }, required);

  // The cities leave their slots: the deals between them and their neighbours in the region end
  const leaveRegion = (cityIds: readonly number[]): number[] => {
    const touched: number[] = [];
    const now = clock.now();
    for (const id of cityIds) {
      touched.push(...link.clearAround(id));
      cities.setRegion(id, null, now);
    }
    return touched;
  };

  router.post('/api/regions/:id/delete', ctx => {
    const user = signedInUser(ctx);
    const region = regions.forOwner(ctx.params.id, user.id);
    readEmpty(ctx.body);

    const touched = db.transaction(() => {
      const moved = leaveRegion(regions.slots(region.id).map(slot => slot.city_id));
      regions.delete(region.id);
      return moved;
    });
    link.refreshAround(touched);
    log.info('region.delete', {...logFields(ctx), region: region.public_id});
    noContent(ctx.res);
  }, required);

  router.post('/api/regions/:id/invitations', ctx => {
    const user = signedInUser(ctx);
    const region = regions.forOwner(ctx.params.id, user.id);
    const body = readFields(ctx.body, ['username']);
    context.limit(ctx, LOBBY_LIMITS.invitations);
    const target = invitee(body.username);

    db.transaction(() => {
      if (regions.isMember(region.id, target.id))
        throw new HttpError(409, 'conflict');
      if (regions.memberCount(region.id) >= REGION_LIMITS.members)
        throw new HttpError(403, 'limit_reached');
      if (!regions.invitationFor(region.id, target.id) &&
          pendingInvitations(db, target.id) < CITY_LIMITS.pendingInvitations)
        regions.invite(region.id, user.id, target.id, clock.now());
    });

    log.info('region.invite', {...logFields(ctx), region: region.public_id});
    json(ctx.res, 201, {ok: true});
  }, required);

  router.post('/api/regions/:id/members/:userId/remove', ctx => {
    const user = signedInUser(ctx);
    const region = regions.forMember(ctx.params.id, user.id);
    const target = namedUser(ctx.params.userId);
    readEmpty(ctx.body);

    if (!regions.isMember(region.id, target.id))
      throw notFound();
    if (region.owner_id !== user.id && target.id !== user.id)
      throw new HttpError(403, 'forbidden');
    if (target.id === region.owner_id)
      throw new HttpError(409, 'conflict');

    const touched = db.transaction(() => {
      const moved = leaveRegion(regions.citiesOf(region.id, target.id));
      regions.removeMember(region.id, target.id);
      // Removed by the owner (not leaving): they do not join it again by themselves, were it public
      if (target.id !== user.id)
        regions.noteRemoval(region.id, target.id, clock.now());
      return moved;
    });
    link.refreshAround(touched);
    noContent(ctx.res);
  }, required);

  // The body names the city to take out: the one the player saw there, which may have left meanwhile (and another taken
  // its place, which cannot come back once out): 409 conflict when it is not the one there
  router.post('/api/regions/:id/slots/:x/:y/clear', ctx => {
    const user = signedInUser(ctx);
    const region = regions.forMember(ctx.params.id, user.id);
    const body = readFields(ctx.body, ['city']);
    if (!isPublicId(body.city))
      throw invalidInput({city: 'invalid'});
    const x = /^[0-3]$/.test(ctx.params.x) ? Number(ctx.params.x) : -1;
    const y = /^[0-3]$/.test(ctx.params.y) ? Number(ctx.params.y) : -1;
    const slot = x >= 0 && y >= 0 ? regions.cityAt(region.id, x, y) : null;
    if (!slot)
      throw notFound();
    if (slot.city_public_id !== body.city)
      throw new HttpError(409, 'conflict');
    if (slot.owner_id !== user.id && region.owner_id !== user.id)
      throw new HttpError(403, 'forbidden');

    const touched = db.transaction(() => leaveRegion([slot.city_id]));
    link.refreshAround(touched);
    noContent(ctx.res);
  }, required);
}
