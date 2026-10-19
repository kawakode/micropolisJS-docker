/* KawaCity, a modified version of micropolisJS.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import type { IncomingMessage, OutgoingHttpHeaders, ServerResponse } from 'node:http';
import path from 'node:path';
import { brotliCompressSync, constants as zlib, gzipSync } from 'node:zlib';
import { NON_PAGE_CONTENT_SECURITY_POLICY } from './security';

// The game's files (STATIC_DIR, the build's dist/), read into memory at startup. Only the files found then are
// served, so no request can reach anything else. Text files are compressed once, with gzip and brotli.

export interface StaticFile {
  contentType: string;
  body: Buffer;
  gzip: Buffer | null;
  brotli: Buffer | null;
  etag: string;
  // Pages are revalidated on every load; other files are kept for a year when their URL carries a version
  alwaysRevalidate: boolean;
  // Pages and scripts (a worker's script sets the worker's policy) get the pages' Content-Security-Policy
  pagePolicy: boolean;
}

export interface StaticFiles {
  readonly directory: string;
  readonly files: ReadonlyMap<string, StaticFile>;
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  // Cities of the original game, read by the game itself
  '.cty': 'application/octet-stream',
  '.kawacity': 'application/json; charset=utf-8',
};

// Files without an extension (LICENSE, COPYING) are texts
const DEFAULT_TYPE = 'text/plain; charset=utf-8';

// Already compressed formats are not compressed again
const INCOMPRESSIBLE = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.woff2', '.woff']);

const BROTLI_QUALITY = 5;

const LONG_CACHE = 'public, max-age=31536000, immutable';

// A version in the URL (?v=<build>, or the bundle's ?<hash>) makes its content immutable
const VERSIONED_QUERY = /^\?(?:v=[A-Za-z0-9._+-]+|[0-9a-f]{8,})$/;

const typeOf = (file: string) => {
  const extension = path.extname(file).toLowerCase();
  return extension === '' ? DEFAULT_TYPE : TYPES[extension] ?? 'application/octet-stream';
};

// A compressed copy, kept only when it saves at least a tenth
const keepIfSmaller = (original: Buffer, compressed: Buffer): Buffer | null =>
  compressed.length <= original.length * 0.9 ? compressed : null;

const loadFile = (file: string): StaticFile => {
  const body = readFileSync(file);
  const extension = path.extname(file).toLowerCase();
  const compressible = !INCOMPRESSIBLE.has(extension) && body.length >= 256;
  const hash = createHash('sha256').update(body).digest('base64url').slice(0, 22);

  return {
    contentType: typeOf(file),
    body,
    gzip: compressible ? keepIfSmaller(body, gzipSync(body, {level: 9})) : null,
    brotli: compressible ? keepIfSmaller(body, brotliCompressSync(body, {
      params: {
        [zlib.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY,
        [zlib.BROTLI_PARAM_SIZE_HINT]: body.length,
      },
    })) : null,
    etag: hash,
    alwaysRevalidate: extension === '.html' || extension === '.webmanifest',
    pagePolicy: extension === '.html' || extension === '.js',
  };
};

// Every regular file under the directory, by its path with '/' separators. Hidden files, source maps and symbolic
// links are left out.
export function loadStaticFiles(directory: string): StaticFiles {
  if (!existsSync(path.join(directory, 'index.html')))
    throw new Error(`STATIC_DIR ${directory} has no index.html: build the game first (npm run build)`);

  const files = new Map<string, StaticFile>();
  const walk = (dir: string, prefix: string) => {
    for (const entry of readdirSync(dir, {withFileTypes: true})) {
      if (entry.name.startsWith('.') || entry.name.endsWith('.map'))
        continue;

      const full = path.join(dir, entry.name);
      if (entry.isDirectory())
        walk(full, prefix + entry.name + '/');
      else if (entry.isFile())
        files.set(prefix + entry.name, loadFile(full));
    }
  };
  walk(directory, '');

  return {directory, files};
}

// The file a path names: a directory's index.html for a path ending with a slash
export function findStaticFile(files: StaticFiles, segments: readonly string[]): StaticFile | null {
  const key = segments.join('/');
  const name = key === '' || key.endsWith('/') ? key + 'index.html' : key;
  return files.files.get(name) ?? null;
}

// The encodings the client accepts (q > 0)
const acceptedEncodings = (header: string | undefined): Set<string> => {
  const accepted = new Set<string>();
  if (typeof header !== 'string')
    return accepted;

  for (const part of header.split(',')) {
    const [name, ...parameters] = part.split(';').map(s => s.trim().toLowerCase());
    const q = parameters.find(p => p.startsWith('q='));
    if (q !== undefined && !(Number(q.slice(2)) > 0))
      continue;
    if (name === '*') {
      accepted.add('br');
      accepted.add('gzip');
    } else {
      accepted.add(name);
    }
  }
  return accepted;
};

const etagMatches = (header: string | undefined, file: StaticFile): boolean => {
  if (typeof header !== 'string')
    return false;

  return header.split(',').some(candidate => {
    const tag = candidate.trim().replace(/^W\//, '');
    return tag === '*' || tag.replace(/^"|"$/g, '').replace(/-(?:br|gz)$/, '') === file.etag;
  });
};

export interface ServeOptions {
  // Extra headers of pages and scripts (their Content-Security-Policy)
  pageHeaders: OutgoingHttpHeaders;
}

// Answers a GET or HEAD for a file
export function serveStaticFile(req: IncomingMessage, res: ServerResponse, file: StaticFile, search: string,
                                options: ServeOptions): void {
  const accepted = acceptedEncodings(req.headers['accept-encoding']);
  let body = file.body;
  let encoding: string | null = null;
  if (file.brotli && accepted.has('br')) {
    body = file.brotli;
    encoding = 'br';
  } else if (file.gzip && accepted.has('gzip')) {
    body = file.gzip;
    encoding = 'gzip';
  }

  const etag = '"' + file.etag + (encoding === 'br' ? '-br' : encoding === 'gzip' ? '-gz' : '') + '"';
  const headers: OutgoingHttpHeaders = {
    'ETag': etag,
    'Cache-Control': !file.alwaysRevalidate && VERSIONED_QUERY.test(search) ? LONG_CACHE : 'no-cache',
    ...(file.pagePolicy ? options.pageHeaders : {'Content-Security-Policy': NON_PAGE_CONTENT_SECURITY_POLICY}),
  };
  if (file.gzip || file.brotli)
    headers['Vary'] = 'Accept-Encoding';

  if (etagMatches(req.headers['if-none-match'], file)) {
    res.writeHead(304, headers);
    res.end();
    return;
  }

  headers['Content-Type'] = file.contentType;
  headers['Content-Length'] = body.length;
  if (encoding)
    headers['Content-Encoding'] = encoding;

  res.writeHead(200, headers);
  res.end(req.method === 'HEAD' ? undefined : body);
}
