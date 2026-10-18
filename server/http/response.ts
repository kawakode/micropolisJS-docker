/* KawaCity, a modified version of micropolisJS.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

import type { OutgoingHttpHeaders, ServerResponse } from 'node:http';
import type { ERROR_TEXTS, FIELD_TEXTS } from '../../src/apiErrors.js';

// Writing API responses. A request that fails is answered with
//   {"error": {"code": "<code>", "fields": {"<field>": "<reason>"}}}
// where the codes and reasons are those of src/apiErrors.js, which gives the game a text for each.

// The codes the server can answer with (network and timeout are the game's own)
export type ErrorCode = Exclude<keyof typeof ERROR_TEXTS, 'network' | 'timeout'>;

// Why a field was refused, with invalid_input or weak_password
export type FieldReason = keyof typeof FIELD_TEXTS;

export type FieldErrors = Readonly<Record<string, FieldReason>>;

// Thrown by request handlers (and the request readers) to answer with an error
export class HttpError extends Error {
  constructor(readonly status: number, readonly code: ErrorCode, readonly fields?: FieldErrors,
              readonly headers?: OutgoingHttpHeaders) {
    super(code);
    this.name = 'HttpError';
  }
}

export function json(res: ServerResponse, status: number, body: unknown, headers: OutgoingHttpHeaders = {}): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    ...headers,
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
  });
  res.end(text);
}

export interface ErrorDetails {
  fields?: FieldErrors;
  headers?: OutgoingHttpHeaders;
  // Given with internal errors, so that a report can be matched with the server's log
  requestId?: string;
}

export function sendError(res: ServerResponse, status: number, code: ErrorCode, details: ErrorDetails = {}): void {
  const error: Record<string, unknown> = {code};
  if (details.fields && Object.keys(details.fields).length > 0)
    error.fields = details.fields;
  if (details.requestId)
    error.requestId = details.requestId;

  json(res, status, {error}, details.headers);
}

export function noContent(res: ServerResponse, headers: OutgoingHttpHeaders = {}): void {
  res.writeHead(204, headers);
  res.end();
}

// Lone surrogates cannot be percent-encoded: they become U+FFFD
const wellFormed = (text: string) =>
  text.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '�');

// RFC 5987 attr-chars: encodeURIComponent leaves ' ( ) * as they are
const encodeExtValue = (text: string) =>
  encodeURIComponent(wellFormed(text)).replace(/['()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());

// The Content-Disposition of a download named after something a player chose (a city's name): an ASCII filename
// (the rule the game uses for its own downloads) that cannot break out of its quotes, and the exact name in UTF-8
// for the browsers that read filename*. The extension is given without its dot.
export function contentDisposition(name: string, extension: string, fallback = 'city'): string {
  const ascii = name.replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 40) || fallback;
  return `attachment; filename="${ascii}.${extension}"; filename*=UTF-8''${encodeExtValue(name || fallback)}.${extension}`;
}

export interface Attachment {
  name: string;
  extension: string;
  contentType: string;
  body: string | Buffer;
  fallbackName?: string;
}

export function attachment(res: ServerResponse, file: Attachment): void {
  res.writeHead(200, {
    'Content-Type': file.contentType,
    'Content-Length': Buffer.byteLength(file.body),
    'Content-Disposition': contentDisposition(file.name, file.extension, file.fallbackName),
  });
  res.end(file.body);
}
