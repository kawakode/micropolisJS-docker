/* KawaCity, a modified version of micropolisJS.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

import { BODY_LIMIT, UPLOAD_BODY_LIMIT } from '../limits';
import { Router } from '../http/router';

const segments = (path: string) => path.slice(1).split('/');
const nothing = () => undefined;

describe('Router', () => {
  const router = new Router();
  router.get('/api/cities', nothing);
  router.post('/api/cities', nothing, {auth: 'required', bodyLimit: UPLOAD_BODY_LIMIT});
  router.get('/api/cities/:id', nothing, {auth: 'required'});
  router.patch('/api/cities/:id', nothing, {auth: 'required'});
  router.post('/api/cities/:id/members/:userId/remove', nothing, {auth: 'required'});
  router.post('/api/invitations/:id/accept', nothing);
  router.post('/api/invitations/decline-all', nothing);
  router.post('/api/invitations/:id', nothing);

  test('Routes match their method and path, with parameters', () => {
    const match = router.match('POST', segments('/api/cities/AbC/members/xYz/remove'));
    expect(match.kind).toBe('found');
    if (match.kind === 'found') {
      expect(match.route.pattern).toBe('/api/cities/:id/members/:userId/remove');
      expect(match.params).toEqual({id: 'AbC', userId: 'xYz'});
    }
  });

  test('Options and their defaults', () => {
    const list = router.match('GET', segments('/api/cities'));
    const upload = router.match('POST', segments('/api/cities'));
    expect(list.kind === 'found' && [list.route.auth, list.route.bodyLimit, list.route.limits]).toEqual(
      ['none', BODY_LIMIT, []]);
    expect(upload.kind === 'found' && [upload.route.auth, upload.route.bodyLimit]).toEqual(['required',
                                                                                             UPLOAD_BODY_LIMIT]);
  });

  test('A literal segment wins over a parameter', () => {
    const match = router.match('POST', segments('/api/invitations/decline-all'));
    expect(match.kind === 'found' && match.route.pattern).toBe('/api/invitations/decline-all');
    const other = router.match('POST', segments('/api/invitations/abc'));
    expect(other.kind === 'found' && other.route.pattern).toBe('/api/invitations/:id');
  });

  test('Unknown paths are not found; known paths with another method are not allowed', () => {
    expect(router.match('GET', segments('/api/nothing')).kind).toBe('not_found');
    expect(router.match('GET', segments('/api/cities/a/b')).kind).toBe('not_found');
    expect(router.match('GET', segments('/api/cities/')).kind).toBe('not_found');
    expect(router.match('DELETE', segments('/api/cities/a'))).toEqual({kind: 'method_not_allowed',
                                                                      allow: ['GET', 'PATCH']});
    expect(router.match('HEAD', segments('/api/cities'))).toEqual({kind: 'method_not_allowed',
                                                                  allow: ['GET', 'POST']});
  });

  test('Mistakes in routes are caught when they are registered', () => {
    expect(() => router.get('/api/cities', nothing)).toThrow(/twice/);
    expect(() => router.get('api/x', nothing)).toThrow(/start with/);
    expect(() => router.get('/api//x', nothing)).toThrow(/empty segment/);
    expect(() => router.get('/api/:1x', nothing)).toThrow(/parameter/);
    expect(() => router.add('OPTIONS', '/api/x', nothing)).toThrow(/method/);
    expect(() => router.post('/api/x', nothing, {limits: [{name: 'x', limit: 1, windowMs: 1, per: 'user'}]}))
      .toThrow(/per-user and per-session limits need auth/);
    expect(() => router.post('/api/x', nothing, {auth: 'optional',
                                                 limits: [{name: 'x', limit: 1, windowMs: 1, per: 'session'}]}))
      .toThrow(/per-user and per-session limits need auth/);
  });
});
