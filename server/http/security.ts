/* KawaCity, a modified version of micropolisJS.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

import type { IncomingHttpHeaders, OutgoingHttpHeaders } from 'node:http';

// Security headers, the Content-Security-Policy, and the Origin check that protects against cross-site requests.

export const UNSAFE_METHODS: ReadonlySet<string> = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export interface SecurityOptions {
  publicOrigin: string;
  https: boolean;
  hsts: boolean;
}

// Sent with every response
export function securityHeaders(options: SecurityOptions): OutgoingHttpHeaders {
  const headers: OutgoingHttpHeaders = {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'X-Frame-Options': 'DENY',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  };

  // Not includeSubDomains: the game may live on a subdomain of a site that still serves http elsewhere
  if (options.https && options.hsts)
    headers['Strict-Transport-Security'] = 'max-age=31536000';

  return headers;
}

// The policy of the game's pages: nothing but the site itself, plus its WebSocket. Inline scripts are refused; inline
// style attributes, which cannot run code, are allowed.
export function pageContentSecurityPolicy(publicOrigin: string): string {
  const url = new URL(publicOrigin);
  const webSocket = (url.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + url.host;

  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self' ${webSocket}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

// The policy of everything that is not a page (API answers, errors): nothing may run or load
export const NON_PAGE_CONTENT_SECURITY_POLICY = "default-src 'none'; frame-ancestors 'none'";

export type OriginCheck = {ok: true} | {ok: false; origin: string | null};

// A request that changes something must say it comes from the game's own page: its Origin header must be exactly
// PUBLIC_URL's origin. A missing Origin, or "null" (sandboxed or privacy-sensitive contexts), is refused.
export function checkOrigin(headers: IncomingHttpHeaders, publicOrigin: string): OriginCheck {
  const origin = headers.origin;
  if (origin === publicOrigin)
    return {ok: true};

  return {ok: false, origin: typeof origin === 'string' ? origin : null};
}

// Content-Type: application/json, with or without parameters (charset=utf-8)
export function isJsonContentType(header: string | undefined): boolean {
  if (typeof header !== 'string')
    return false;

  return header.split(';')[0].trim().toLowerCase() === 'application/json';
}
