/* KawaCity, a modified version of micropolisJS.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { Cidr, formatIp, inCidrs, IpAddress, parseIp, rateLimitKeys } from './ip';
import { HttpError } from './response';
import { isJsonContentType } from './security';

// Reading requests: the path, the client's address, cookies and JSON bodies.

// The signed-in user of a request (set by the session resolver, see AppContext.setUserResolver)
export interface RequestUser {
  // Internal id: never sent to the game
  id: number;
  publicId: string;
  username: string;
  email: string;
  locale: string;
  createdAt: number;
}

// The session a request was made with (a row of the sessions table)
export interface RequestSession {
  tokenHash: string;
  userId: number;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
}

export interface RequestContext {
  req: IncomingMessage;
  res: ServerResponse;
  requestId: string;
  method: string;
  // The decoded path (/api/cities/abc) and its segments (['api', 'cities', 'abc'])
  path: string;
  segments: readonly string[];
  query: URLSearchParams;
  // The route's :parameters
  params: Readonly<Record<string, string>>;
  // The client's address, and the keys its rate limits count by (see ClientAddress)
  ip: string;
  ipKey: string;
  ipAggregateKey: string | null;
  cookies: ReadonlyMap<string, string>;
  // The parsed JSON body of a POST, PUT, PATCH or DELETE (validate it before use), else undefined
  body: unknown;
  user: RequestUser | null;
  session: RequestSession | null;
}

export interface RequestTarget {
  path: string;
  segments: string[];
  search: string;
}

// The path of a request, decoded segment by segment. Null when it could step out of its directory or alias another
// path: a '.' or '..' segment, an empty segment (//), or a segment that decodes to a slash, a backslash or NUL.
export function parseRequestTarget(rawUrl: string): RequestTarget | null {
  let pathPart: string;
  let search: string;

  if (rawUrl.startsWith('/')) {
    const query = rawUrl.indexOf('?');
    pathPart = query === -1 ? rawUrl : rawUrl.slice(0, query);
    search = query === -1 ? '' : rawUrl.slice(query);
  } else {
    // The absolute form (GET http://host/path), which only proxies send
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch (e) {
      return null;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:')
      return null;
    pathPart = url.pathname;
    search = url.search;
  }

  const raw = pathPart.slice(1).split('/');
  const segments: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    // Only the last segment may be empty: a trailing slash
    if (raw[i] === '' && i < raw.length - 1)
      return null;

    let segment: string;
    try {
      segment = decodeURIComponent(raw[i]);
    } catch (e) {
      return null;
    }
    if (segment === '.' || segment === '..' || /[/\\\u0000]/.test(segment))
      return null;
    segments.push(segment);
  }

  return {path: '/' + segments.join('/'), segments, search};
}

// The client's address, and the keys rate limits count it by: an IPv4 address alone, an IPv6 address by its /64 (with
// the /48 as an aggregate key)
export interface ClientAddress {
  ip: string;
  key: string;
  aggregateKey: string | null;
}

export interface ProxySettings {
  // How many reverse proxies stand in front of the server (TRUST_PROXY)
  trustProxy: number;
  // The addresses those proxies connect from (TRUSTED_PROXIES)
  trustedProxies: readonly Cidr[];
}

// An entry of X-Forwarded-For: an address, maybe with a port ([2001:db8::1]:443, 192.0.2.1:443)
const parseForwardedEntry = (entry: string): IpAddress | null => {
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(entry);
  if (bracketed)
    return parseIp(bracketed[1]);

  const withPort = /^(\d+\.\d+\.\d+\.\d+):\d+$/.exec(entry);
  return parseIp(withPort ? withPort[1] : entry);
};

// X-Forwarded-For is only believed from a trusted proxy (TRUSTED_PROXIES), and only TRUST_PROXY entries deep: each
// proxy appends the address it was connected from, so the Nth entry from the right is the one the outermost of our N
// proxies saw. Anything the client wrote itself lies further left, and is ignored.
export function clientAddress(socketAddress: string | undefined, forwardedFor: string | string[] | undefined,
                              proxies: ProxySettings): ClientAddress {
  const peer = parseIp(socketAddress);
  if (!peer)
    return {ip: 'unknown', key: 'unknown', aggregateKey: null};

  let client = peer;
  if (proxies.trustProxy > 0 && forwardedFor !== undefined && inCidrs(peer, proxies.trustedProxies)) {
    const header = Array.isArray(forwardedFor) ? forwardedFor.join(',') : forwardedFor;
    const entries = header.split(',').map(entry => entry.trim()).filter(entry => entry !== '');
    if (entries.length >= proxies.trustProxy)
      client = parseForwardedEntry(entries[entries.length - proxies.trustProxy]) ?? peer;
  }

  return {ip: formatIp(client), ...rateLimitKeys(client)};
}

// Cookies by name; the first of a repeated name wins
export function parseCookies(header: string | undefined): Map<string, string> {
  const cookies = new Map<string, string>();
  if (typeof header !== 'string')
    return cookies;

  for (const pair of header.split(';')) {
    const equals = pair.indexOf('=');
    if (equals === -1)
      continue;

    const name = pair.slice(0, equals).trim();
    let value = pair.slice(equals + 1).trim();
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"'))
      value = value.slice(1, -1);

    if (name !== '' && !cookies.has(name))
      cookies.set(name, value);
  }

  return cookies;
}

// The body of a request, up to `limit` bytes; beyond, 413 (and the connection is closed rather than read to its end)
export function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const tooLarge = () => new HttpError(413, 'payload_too_large', undefined, {Connection: 'close'});

  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > limit)
    return Promise.reject(tooLarge());

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;

    const finish = (error: Error | null) => {
      if (done)
        return;
      done = true;
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('error', onError);
      req.off('close', onClose);
      if (error) {
        req.pause();
        reject(error);
      } else {
        resolve(Buffer.concat(chunks, size));
      }
    };

    const onData = (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit)
        finish(tooLarge());
      else
        chunks.push(chunk);
    };
    const onEnd = () => finish(null);
    const onError = (error: Error) => finish(error);
    // Closed before its end: the client went away
    const onClose = () => finish(new Error('request closed'));

    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
    req.on('close', onClose);
  });
}

const utf8 = new TextDecoder('utf-8', {fatal: true, ignoreBOM: false});

// The JSON body of a request: Content-Type application/json (else 415), at most `limit` bytes (else 413), valid UTF-8
// and JSON (else 400 invalid_input). The value still has to be validated field by field.
export async function readJsonBody(req: IncomingMessage, limit: number): Promise<unknown> {
  if (!isJsonContentType(req.headers['content-type']))
    throw new HttpError(415, 'unsupported_media_type');

  const body = await readBody(req, limit);
  try {
    return JSON.parse(utf8.decode(body));
  } catch (e) {
    throw new HttpError(400, 'invalid_input');
  }
}
