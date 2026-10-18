/* KawaCity, a modified version of micropolisJS.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

import { BODY_LIMIT } from '../limits';
import type { RequestContext } from './request';

// The API's routes: a method and a path pattern such as /api/cities/:id/members/:userId, with what the route needs
// before its handler runs (a session, a body size, rate limits). See createApp for the order of the checks.

export type Handler = (ctx: RequestContext) => void | Promise<void>;

// none: the session is not even looked up; optional: ctx.user may be null; required: 401 unauthenticated without one
export type AuthRequirement = 'none' | 'optional' | 'required';

// A sliding-window limit, shared by every route that names it: per client IP key (times IP_LIMIT_FACTOR, with the
// IPv6 /48 at 10 times the limit), or per signed-in user (the route then needs a session)
export interface RateLimitRule {
  name: string;
  limit: number;
  windowMs: number;
  per: 'ip' | 'user';
}

export interface RouteOptions {
  auth?: AuthRequirement;
  // Largest JSON body in bytes (BODY_LIMIT by default, UPLOAD_BODY_LIMIT for city uploads)
  bodyLimit?: number;
  limits?: readonly RateLimitRule[];
}

type Part = {literal: string} | {param: string};

export interface Route {
  method: string;
  pattern: string;
  handler: Handler;
  auth: AuthRequirement;
  bodyLimit: number;
  limits: readonly RateLimitRule[];
  parts: readonly Part[];
}

export type RouteMatch =
  {kind: 'found'; route: Route; params: Record<string, string>} |
  {kind: 'not_found'} |
  {kind: 'method_not_allowed'; allow: string[]};

const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

const parsePattern = (pattern: string): Part[] => {
  if (!pattern.startsWith('/'))
    throw new Error(`route pattern must start with /: ${pattern}`);

  return pattern.slice(1).split('/').map(segment => {
    if (segment.startsWith(':')) {
      if (!/^:[A-Za-z][A-Za-z0-9]*$/.test(segment))
        throw new Error(`bad route parameter ${segment} in ${pattern}`);
      return {param: segment.slice(1)};
    }
    if (segment === '')
      throw new Error(`empty segment in route pattern ${pattern}`);
    return {literal: segment};
  });
};

const matchParts = (parts: readonly Part[], segments: readonly string[]): Record<string, string> | null => {
  if (parts.length !== segments.length)
    return null;

  const params: Record<string, string> = {};
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if ('literal' in part) {
      if (part.literal !== segments[i])
        return null;
    } else {
      if (segments[i] === '')
        return null;
      params[part.param] = segments[i];
    }
  }
  return params;
};

// Literal segments win over parameters, from the left: /api/invitations/decline-all over /api/invitations/:id
const moreSpecific = (a: Route, b: Route): boolean => {
  for (let i = 0; i < a.parts.length; i++) {
    const aLiteral = 'literal' in a.parts[i];
    const bLiteral = 'literal' in b.parts[i];
    if (aLiteral !== bLiteral)
      return aLiteral;
  }
  return false;
};

export class Router {
  private readonly routes: Route[] = [];

  add(method: string, pattern: string, handler: Handler, options: RouteOptions = {}): void {
    if (!METHODS.has(method))
      throw new Error(`unsupported method ${method} for ${pattern}`);
    if (this.routes.some(route => route.method === method && route.pattern === pattern))
      throw new Error(`route registered twice: ${method} ${pattern}`);

    const limits = options.limits ?? [];
    const auth = options.auth ?? 'none';
    if (limits.some(rule => rule.per === 'user') && auth !== 'required')
      throw new Error(`per-user limits need auth: 'required' (${method} ${pattern})`);

    this.routes.push({
      method,
      pattern,
      handler,
      auth,
      bodyLimit: options.bodyLimit ?? BODY_LIMIT,
      limits,
      parts: parsePattern(pattern),
    });
  }

  get(pattern: string, handler: Handler, options?: RouteOptions): void {
    this.add('GET', pattern, handler, options);
  }

  post(pattern: string, handler: Handler, options?: RouteOptions): void {
    this.add('POST', pattern, handler, options);
  }

  put(pattern: string, handler: Handler, options?: RouteOptions): void {
    this.add('PUT', pattern, handler, options);
  }

  patch(pattern: string, handler: Handler, options?: RouteOptions): void {
    this.add('PATCH', pattern, handler, options);
  }

  delete(pattern: string, handler: Handler, options?: RouteOptions): void {
    this.add('DELETE', pattern, handler, options);
  }

  match(method: string, segments: readonly string[]): RouteMatch {
    let best: {route: Route; params: Record<string, string>} | null = null;
    const allow = new Set<string>();

    for (const route of this.routes) {
      const params = matchParts(route.parts, segments);
      if (!params)
        continue;

      allow.add(route.method);
      if (route.method === method && (!best || moreSpecific(route, best.route)))
        best = {route, params};
    }

    if (best)
      return {kind: 'found', ...best};
    if (allow.size > 0)
      return {kind: 'method_not_allowed', allow: [...allow].sort()};
    return {kind: 'not_found'};
  }

  list(): readonly Route[] {
    return this.routes;
  }
}
