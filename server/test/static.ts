/* KawaCity, a modified version of micropolisJS.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

import { gunzipSync, brotliDecompressSync } from 'node:zlib';
import { loadStaticFiles } from '../http/static';
import { cleanUp, startTestApp, TestApp, temporaryDirectory } from '../testing';

afterAll(cleanUp);

describe('The game\'s files', () => {
  let t: TestApp;
  beforeAll(async () => { t = await startTestApp(); });

  test('/ is index.html, revalidated on every load', async () => {
    const response = await t.request('/');
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(response.headers['cache-control']).toBe('no-cache');
    expect(response.text).toMatch(/^<!DOCTYPE html><title>KawaCity<\/title>/);
    expect((await t.request('/index.html')).body).toEqual(response.body);
  });

  test('Types', async () => {
    const types: Record<string, string> = {
      '/about.html': 'text/html; charset=utf-8',
      '/src/micropolis.js': 'text/javascript; charset=utf-8',
      '/images/tiles.png': 'image/png',
      '/cities/kobe.cty': 'application/octet-stream',
      '/LICENSE': 'text/plain; charset=utf-8',
      '/manifest.webmanifest': 'application/manifest+json; charset=utf-8',
    };
    for (const [path, type] of Object.entries(types)) {
      const response = await t.request(path);
      expect([path, response.status, response.headers['content-type']]).toEqual([path, 200, type]);
    }
  });

  test('Text is compressed with brotli or gzip, as the browser accepts', async () => {
    const original = (await t.request('/src/micropolis.js')).body;
    expect(original.length).toBe(11500);

    const br = await t.request('/src/micropolis.js', {headers: {'Accept-Encoding': 'gzip, deflate, br'}});
    expect(br.headers['content-encoding']).toBe('br');
    expect(br.headers.vary).toBe('Accept-Encoding');
    expect(Number(br.headers['content-length'])).toBe(br.body.length);
    expect(brotliDecompressSync(br.body)).toEqual(original);

    const gzip = await t.request('/src/micropolis.js', {headers: {'Accept-Encoding': 'gzip'}});
    expect(gzip.headers['content-encoding']).toBe('gzip');
    expect(gunzipSync(gzip.body)).toEqual(original);

    const refused = await t.request('/src/micropolis.js', {headers: {'Accept-Encoding': 'br;q=0, gzip;q=0.5'}});
    expect(refused.headers['content-encoding']).toBe('gzip');

    const none = await t.request('/src/micropolis.js', {headers: {'Accept-Encoding': 'identity'}});
    expect(none.headers['content-encoding']).toBeUndefined();
    expect(none.body).toEqual(original);

    const any = await t.request('/src/micropolis.js', {headers: {'Accept-Encoding': '*'}});
    expect(any.headers['content-encoding']).toBe('br');

    // Images are already compressed
    const image = await t.request('/images/tiles.png', {headers: {'Accept-Encoding': 'gzip, br'}});
    expect(image.headers['content-encoding']).toBeUndefined();
    expect(image.headers.vary).toBeUndefined();
  });

  test('ETag and 304', async () => {
    const first = await t.request('/src/micropolis.js');
    const etag = first.headers.etag as string;
    expect(etag).toMatch(/^"[A-Za-z0-9_-]{22}"$/);

    for (const match of [etag, 'W/' + etag, `"other", ${etag}`, '*']) {
      const again = await t.request('/src/micropolis.js', {headers: {'If-None-Match': match}});
      expect(again.status).toBe(304);
      expect(again.body.length).toBe(0);
      expect(again.headers.etag).toBe(etag);
    }

    // The compressed copies have their own ETags, which revalidate too
    const br = await t.request('/src/micropolis.js', {headers: {'Accept-Encoding': 'br'}});
    expect(br.headers.etag).toBe(etag.slice(0, -1) + '-br"');
    const brAgain = await t.request('/src/micropolis.js', {headers: {'Accept-Encoding': 'br',
                                                                     'If-None-Match': br.headers.etag as string}});
    expect(brAgain.status).toBe(304);

    expect((await t.request('/src/micropolis.js', {headers: {'If-None-Match': '"stale"'}})).status).toBe(200);
  });

  test('HEAD gives the headers without the body', async () => {
    const head = await t.request('/src/micropolis.js', {method: 'HEAD', headers: {'Accept-Encoding': 'gzip'}});
    expect(head.status).toBe(200);
    expect(head.body.length).toBe(0);
    expect(head.headers['content-encoding']).toBe('gzip');
    expect(Number(head.headers['content-length'])).toBeGreaterThan(0);
  });

  test('Versioned URLs are cached for a year, pages never', async () => {
    expect((await t.request('/images/tiles.png?v=a1033f7c69d1')).headers['cache-control']).toBe(
      'public, max-age=31536000, immutable');
    expect((await t.request('/src/micropolis.js?d3f455b952412e2f6283')).headers['cache-control']).toBe(
      'public, max-age=31536000, immutable');
    expect((await t.request('/images/tiles.png')).headers['cache-control']).toBe('no-cache');
    expect((await t.request('/images/tiles.png?v=1&x=2')).headers['cache-control']).toBe('no-cache');
    expect((await t.request('/about.html?v=1')).headers['cache-control']).toBe('no-cache');
    expect((await t.request('/manifest.webmanifest?v=1')).headers['cache-control']).toBe('no-cache');
  });

  test('Only the files found at startup are served: no way out of the directory', async () => {
    for (const path of ['/../package.json', '/src/../../package.json', '/%2e%2e/package.json', '/%2E%2E%2Fpackage.json',
                        '/src%2fmicropolis.js', '/src%2Fmicropolis.js', '/src%5Cmicropolis.js', '/src\\micropolis.js',
                        '//src/micropolis.js', '/src//micropolis.js', '/./index.html', '/index.html%00',
                        '/%C0%AE%C0%AE/package.json', '/etc/passwd', 'http://localhost/etc/passwd',
                        '/nothing.html', '/src/', '/images', '/.hidden', '/src/micropolis.js.map',
                        '/src/micropolis.js/', '/index.html/']) {
      const response = await t.request(path);
      expect([path, response.status]).toEqual([path, 404]);
      expect(response.headers['content-type']).toBe('text/plain; charset=utf-8');
      expect(response.text).toBe('Not found\n');
    }
  });

  test('The absolute form of a request target reads its path only', async () => {
    const response = await t.request('http://evil.example/src/micropolis.js');
    expect(response.status).toBe(200);
  });

  test('Other methods are refused', async () => {
    const response = await t.request('/index.html', {method: 'PUT', body: '{}',
                                                     headers: {Origin: 'http://localhost:8080'}});
    expect(response.status).toBe(405);
    expect(response.headers.allow).toBe('GET, HEAD');
    expect((await t.request('/', {method: 'OPTIONS'})).status).toBe(405);
  });

  test('A game directory needs index.html', () => {
    expect(() => loadStaticFiles(temporaryDirectory())).toThrow(/has no index.html/);
  });
});
