/* KawaCity, a modified version of micropolisJS.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

import { randomBytes } from 'node:crypto';
import http, { IncomingMessage, OutgoingHttpHeaders, ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import type { Clock } from './clock';
import type { Config } from './config';
import { registerCoreRoutes } from './coreRoutes';
import type { Database } from './db/database';
import { purgeExpired } from './db/purge';
import { ClientAddress, clientAddress, parseCookies, parseRequestTarget, readJsonBody, RequestContext,
         RequestSession, RequestTarget, RequestUser } from './http/request';
import { HttpError, sendError } from './http/response';
import { RateLimitRule, Router } from './http/router';
import { checkOrigin, isJsonContentType, NON_PAGE_CONTENT_SECURITY_POLICY, pageContentSecurityPolicy,
         securityHeaders, UNSAFE_METHODS } from './http/security';
import { findStaticFile, loadStaticFiles, serveStaticFile, StaticFiles } from './http/static';
import { createLogger, Logger } from './log';
import { IpRateLimiter, RateLimitDecision, RateLimiter } from './security/rateLimit';

// The HTTP server: the game's files, the JSON API under /api/, and WebSocket upgrades. Every request gets the security
// headers; an API request then goes through, in this order:
//   1. the Origin check, for a request that changes something (POST, PUT, PATCH, DELETE): 403 bad_origin
//   2. the overall API limit per client (600 a minute): 429 rate_limited
//   3. the Content-Type of a request that changes something: 415 unsupported_media_type unless application/json
//   4. the route: 404 not_found, 405 method_not_allowed
//   5. the route's per-IP limits
//   6. the session (auth: 'optional' or 'required'): 401 unauthenticated when required and missing
//   7. the route's per-user limits
//   8. the JSON body, up to the route's size: 413 payload_too_large, 400 invalid_input
//   9. the handler, which validates the body and answers (HttpError for errors, anything else is a 500 internal)

// The mail sender (mail/mailer.ts): routes reach it through the context
export interface Mailer {
  close?(): void | Promise<void>;
}

export interface AppDeps {
  clock: Clock;
  db: Database;
  log?: Logger;
  mailer?: Mailer | null;
  // The game's files: loaded from config.staticDir when not given
  staticFiles?: StaticFiles;
}

export interface ResolvedSession {
  user: RequestUser;
  session: RequestSession;
}

// Finds the signed-in user of a request from its cookies (auth/sessions.ts)
export type UserResolver = (ctx: RequestContext) => ResolvedSession | null;

export interface UpgradeRequest {
  req: IncomingMessage;
  socket: Duplex;
  head: Buffer;
  requestId: string;
  address: ClientAddress;
  cookies: ReadonlyMap<string, string>;
}

// Takes over a WebSocket upgrade whose Origin was checked; it accepts it, or refuses it with rejectUpgrade
export type UpgradeHandler = (upgrade: UpgradeRequest) => void;

export type ShutdownTask = () => void | Promise<void>;

// What the parts of the server share: stage A2's account routes and stage B's multiplayer register themselves with it
export interface AppContext {
  readonly config: Config;
  readonly clock: Clock;
  readonly db: Database;
  readonly log: Logger;
  readonly mailer: Mailer | null;
  readonly router: Router;
  // The limiter of that name, created on first use (IP_LIMIT_FACTOR applied, the IPv6 /48 at 10 times the limit)
  ipLimiter(name: string, limit: number, windowMs: number): IpRateLimiter;
  // The limiter of that name, per user id
  userLimiter(name: string, limit: number, windowMs: number): RateLimiter;
  setUserResolver(resolver: UserResolver): void;
  setUpgradeHandler(path: string, handler: UpgradeHandler): void;
  // Run at shutdown, in the order given, after the server stops accepting connections and before the database closes
  onShutdown(task: ShutdownTask): void;
  // Run every hour (and once at startup)
  addPurgeTask(name: string, task: (now: number) => void): void;
}

export interface App {
  readonly server: http.Server;
  readonly context: AppContext;
  runPurge(): void;
  // Stops accepting connections, runs the shutdown tasks, and waits (a few seconds at most) for requests to finish.
  // The database is left open for the caller to close.
  shutdown(): Promise<void>;
}

// Every API route. Stage A2 adds the account routes here (registerAuthRoutes), stage B the multiplayer ones and the
// WebSocket at /api/ws (registerGameRoutes).
function registerRoutes(context: AppContext): void {
  registerCoreRoutes(context);
}

export const API_LIMIT = {name: 'api', limit: 600, windowMs: 60 * 1000};

const PURGE_INTERVAL = 60 * 60 * 1000;

// How long requests still running at shutdown may take to finish
const SHUTDOWN_DRAIN_MS = 5000;

const STATUS_TEXT: Record<number, string> = {400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden',
                                             404: 'Not Found', 429: 'Too Many Requests', 503: 'Service Unavailable'};

// Refuses a WebSocket upgrade with a bare HTTP answer
export function rejectUpgrade(socket: Duplex, status: number): void {
  if (!socket.writable) {
    socket.destroy();
    return;
  }

  socket.end(`HTTP/1.1 ${status} ${STATUS_TEXT[status] ?? 'Error'}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  // A client that does not read its answer is not waited for
  setTimeout(() => socket.destroy(), 1000).unref();
}

const newRequestId = () => randomBytes(6).toString('hex');

// A refused Origin, as logged: the client chose it, so it is shortened. Refusals are logged once a minute per client
// (per IPv6 /48), not per origin: a client sending a new origin with each request must not flood the log.
const shownOrigin = (origin: string | null) => origin === null ? 'none' : origin.slice(0, 100);
const refusalKey = (address: ClientAddress) => address.aggregateKey ?? address.key;

const isApiPath = (target: RequestTarget) => target.segments[0] === 'api';

const plainText = (res: ServerResponse, status: number, text: string, headers: OutgoingHttpHeaders = {}) => {
  res.writeHead(status, {
    ...headers,
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Content-Security-Policy': NON_PAGE_CONTENT_SECURITY_POLICY,
  });
  res.end(text);
};

export function createApp(config: Config, deps: AppDeps): App {
  const {clock, db} = deps;
  const log = deps.log ?? createLogger({level: config.logLevel, clock});
  const staticFiles = deps.staticFiles ?? loadStaticFiles(config.staticDir);
  const router = new Router();
  const baseHeaders = securityHeaders(config);
  const pageHeaders: OutgoingHttpHeaders = {'Content-Security-Policy': pageContentSecurityPolicy(config.publicOrigin)};

  const limiters = new Map<string, {per: 'ip' | 'user'; limit: number; windowMs: number;
                                    limiter: IpRateLimiter | RateLimiter}>();
  const upgradeHandlers = new Map<string, UpgradeHandler>();
  const shutdownTasks: ShutdownTask[] = [];
  const purgeTasks: {name: string; task: (now: number) => void}[] = [];
  let resolveUser: UserResolver = () => null;

  const namedLimiter = (name: string, per: 'ip' | 'user', limit: number, windowMs: number) => {
    const existing = limiters.get(name);
    if (existing) {
      if (existing.per !== per || existing.limit !== limit || existing.windowMs !== windowMs)
        throw new Error(`rate limit ${name} is declared twice with different settings`);
      return existing.limiter;
    }

    const limiter = per === 'ip' ?
      new IpRateLimiter({limit, windowMs, clock, factor: config.ipLimitFactor}) :
      new RateLimiter({limit, windowMs, clock});
    limiters.set(name, {per, limit, windowMs, limiter});
    return limiter;
  };

  const context: AppContext = {
    config,
    clock,
    db,
    log,
    mailer: deps.mailer ?? null,
    router,
    ipLimiter: (name, limit, windowMs) => namedLimiter(name, 'ip', limit, windowMs) as IpRateLimiter,
    userLimiter: (name, limit, windowMs) => namedLimiter(name, 'user', limit, windowMs) as RateLimiter,
    setUserResolver: resolver => { resolveUser = resolver; },
    setUpgradeHandler: (path, handler) => { upgradeHandlers.set(path, handler); },
    onShutdown: task => { shutdownTasks.push(task); },
    addPurgeTask: (name, task) => { purgeTasks.push({name, task}); },
  };

  context.addPurgeTask('expired rows', now => {
    const counts = purgeExpired(db, now, config.sessionIdleDays * 24 * 60 * 60 * 1000);
    log.debug('purge', {...counts});
  });
  context.addPurgeTask('rate limits', () => {
    for (const {limiter} of limiters.values())
      limiter.prune();
  });

  registerRoutes(context);
  const apiLimiter = context.ipLimiter(API_LIMIT.name, API_LIMIT.limit, API_LIMIT.windowMs);

  const tooManyRequests = (ctx: RequestContext, name: string, decision: RateLimitDecision): HttpError => {
    log.security('rate_limited', name + ' ' + ctx.ipKey, {requestId: ctx.requestId, ip: ctx.ipKey, limit: name,
                                                           user: ctx.user?.publicId});
    return new HttpError(429, 'rate_limited', undefined,
                         {'Retry-After': String(Math.max(1, Math.ceil(decision.retryAfterMs / 1000)))});
  };

  const applyLimits = (ctx: RequestContext, rules: readonly RateLimitRule[], per: 'ip' | 'user') => {
    for (const rule of rules) {
      if (rule.per !== per)
        continue;

      const decision = per === 'ip' ?
        context.ipLimiter(rule.name, rule.limit, rule.windowMs).hit({key: ctx.ipKey, aggregateKey: ctx.ipAggregateKey}) :
        context.userLimiter(rule.name, rule.limit, rule.windowMs).hit(String(ctx.user?.id));
      if (!decision.allowed)
        throw tooManyRequests(ctx, rule.name, decision);
    }
  };

  const handleApi = async (ctx: RequestContext) => {
    const {req, res} = ctx;
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', NON_PAGE_CONTENT_SECURITY_POLICY);

    const overall = apiLimiter.hit({key: ctx.ipKey, aggregateKey: ctx.ipAggregateKey});
    if (!overall.allowed)
      throw tooManyRequests(ctx, API_LIMIT.name, overall);

    if (UNSAFE_METHODS.has(ctx.method) && !isJsonContentType(req.headers['content-type']))
      throw new HttpError(415, 'unsupported_media_type');

    const match = router.match(ctx.method, ctx.segments);
    if (match.kind === 'not_found')
      throw new HttpError(404, 'not_found');
    if (match.kind === 'method_not_allowed')
      throw new HttpError(405, 'method_not_allowed', undefined, {Allow: match.allow.join(', ')});

    const route = match.route;
    ctx.params = match.params;
    applyLimits(ctx, route.limits, 'ip');

    if (route.auth !== 'none') {
      const resolved = resolveUser(ctx);
      ctx.user = resolved?.user ?? null;
      ctx.session = resolved?.session ?? null;
      if (route.auth === 'required' && !ctx.user)
        throw new HttpError(401, 'unauthenticated');
    }
    applyLimits(ctx, route.limits, 'user');

    if (UNSAFE_METHODS.has(ctx.method))
      ctx.body = await readJsonBody(req, route.bodyLimit);

    await route.handler(ctx);

    if (!res.headersSent)
      throw new Error(`${route.method} ${route.pattern} did not answer`);
  };

  const handleStatic = (req: IncomingMessage, res: ServerResponse, target: RequestTarget | null) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      plainText(res, 405, 'Method not allowed\n', {Allow: 'GET, HEAD'});
      return;
    }

    const file = target ? findStaticFile(staticFiles, target.segments) : null;
    if (!file) {
      plainText(res, 404, 'Not found\n');
      return;
    }

    serveStaticFile(req, res, file, target?.search ?? '', {pageHeaders});
  };

  const fail = (ctx: RequestContext, error: unknown) => {
    const {res} = ctx;
    if (res.headersSent) {
      log.error('http.error_after_answer', {requestId: ctx.requestId, err: error});
      res.destroy();
      return;
    }

    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', NON_PAGE_CONTENT_SECURITY_POLICY);
    if (error instanceof HttpError) {
      sendError(res, error.status, error.code, {fields: error.fields, headers: error.headers});
      return;
    }

    log.error('http.error', {requestId: ctx.requestId, method: ctx.method, path: ctx.path, ip: ctx.ipKey, err: error});
    sendError(res, 500, 'internal', {requestId: ctx.requestId});
  };

  const handleRequest = async (req: IncomingMessage, res: ServerResponse) => {
    const started = clock.now();
    const method = req.method ?? 'GET';
    const target = parseRequestTarget(req.url ?? '');
    const address = clientAddress(req.socket.remoteAddress, req.headers['x-forwarded-for'], config);
    const ctx: RequestContext = {
      req,
      res,
      requestId: newRequestId(),
      method,
      path: target?.path ?? '',
      segments: target?.segments ?? [],
      query: new URLSearchParams(target?.search ?? ''),
      params: {},
      ip: address.ip,
      ipKey: address.key,
      ipAggregateKey: address.aggregateKey,
      cookies: parseCookies(req.headers.cookie),
      body: undefined,
      user: null,
      session: null,
    };

    for (const [name, value] of Object.entries(baseHeaders))
      res.setHeader(name, value as string);

    if (log.enabled('debug')) {
      res.on('finish', () => {
        log.debug('http.request', {requestId: ctx.requestId, method, path: ctx.path, status: res.statusCode,
                                   ms: clock.now() - started, ip: ctx.ipKey});
      });
    }

    try {
      if (UNSAFE_METHODS.has(method)) {
        const origin = checkOrigin(req.headers, config.publicOrigin);
        if (!origin.ok) {
          const shown = shownOrigin(origin.origin);
          const message = origin.origin === null ? `A ${method} without an Origin header was refused` :
            `Origin ${shown} does not match PUBLIC_URL ${config.publicOrigin}`;
          log.security('csrf.reject', refusalKey(address), {requestId: ctx.requestId, ip: ctx.ipKey, origin: shown,
                                                            message});
          throw new HttpError(403, 'bad_origin');
        }
      }

      if (target && isApiPath(target))
        await handleApi(ctx);
      else if (!target && (req.url ?? '').startsWith('/api/'))
        throw new HttpError(404, 'not_found');
      else
        handleStatic(req, res, target);
    } catch (error) {
      fail(ctx, error);
    }
  };

  const handleUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    socket.on('error', () => socket.destroy());

    const requestId = newRequestId();
    const target = parseRequestTarget(req.url ?? '');
    const handler = target ? upgradeHandlers.get(target.path) : undefined;
    if (!handler) {
      rejectUpgrade(socket, 404);
      return;
    }

    const address = clientAddress(req.socket.remoteAddress, req.headers['x-forwarded-for'], config);
    const origin = checkOrigin(req.headers, config.publicOrigin);
    if (!origin.ok) {
      const shown = shownOrigin(origin.origin);
      log.security('ws.reject', 'origin ' + refusalKey(address), {requestId, ip: address.key, reason: 'origin',
                                                                  origin: shown});
      rejectUpgrade(socket, 403);
      return;
    }

    try {
      handler({req, socket, head, requestId, address, cookies: parseCookies(req.headers.cookie)});
    } catch (error) {
      log.error('ws.upgrade_error', {requestId, err: error});
      rejectUpgrade(socket, 503);
    }
  };

  const server = http.createServer({
    requestTimeout: 30 * 1000,
    headersTimeout: 15 * 1000,
    keepAliveTimeout: 5 * 1000,
  }, (req, res) => { void handleRequest(req, res); });
  server.maxConnections = 2000;
  server.on('upgrade', handleUpgrade);

  const runPurge = () => {
    const now = clock.now();
    for (const {name, task} of purgeTasks) {
      try {
        task(now);
      } catch (error) {
        log.error('purge.error', {task: name, err: error});
      }
    }
  };

  const purgeTimer = setInterval(runPurge, PURGE_INTERVAL);
  purgeTimer.unref();

  let shuttingDown: Promise<void> | null = null;
  const shutdown = () => {
    shuttingDown ??= (async () => {
      clearInterval(purgeTimer);
      const closed = new Promise<void>(resolve => server.close(() => resolve()));
      server.closeIdleConnections();

      for (const task of shutdownTasks) {
        try {
          await task();
        } catch (error) {
          log.error('server.shutdown_task', {err: error});
        }
      }

      const drain = setTimeout(() => server.closeAllConnections(), SHUTDOWN_DRAIN_MS);
      await closed;
      clearTimeout(drain);
    })();
    return shuttingDown;
  };

  return {server, context, runPurge, shutdown};
}
