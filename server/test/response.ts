/* KawaCity, a modified version of micropolisJS.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { attachment, contentDisposition } from '../http/response';
import { request } from '../testing';

// What a browser that reads filename* gets back
const extended = (header: string) => decodeURIComponent(/filename\*=UTF-8''(.*)$/.exec(header)![1]);
const plain = (header: string) => /filename="([^"]*)"/.exec(header)![1];

describe('Content-Disposition', () => {
  test.each([
    ['Kawa City', 'Kawa_City.kawacity'],
    ['a"; filename=evil.html', 'a_filename_evil_html.kawacity'],
    ['Tokyo €', 'Tokyo_.kawacity'],
    ['Москва', '_.kawacity'],
    ['abc‮gpj.exe', 'abc_gpj_exe.kawacity'],
    ["it's (a) *city*", 'it_s_a_city_.kawacity'],
    ['x'.repeat(60), 'x'.repeat(40) + '.kawacity'],
    ['', 'city.kawacity'],
  ])('%s', (name, ascii) => {
    const header = contentDisposition(name, 'kawacity');
    expect(header.startsWith('attachment; filename="')).toBe(true);
    expect(plain(header)).toBe(ascii);
    expect(extended(header)).toBe((name || 'city') + '.kawacity');
    // One filename and one filename*, nothing an attacker could add
    expect(header.split(';').length).toBe(3);
    expect(header).toMatch(/^[\x20-\x7e]+$/);
  });

  test('Lone surrogates do not break the header', () => {
    expect(extended(contentDisposition('a\uD800b', 'kawacity'))).toBe('a�b.kawacity');
  });

  test('A fallback name', () => {
    expect(plain(contentDisposition('€', 'json', 'kawacity-account'))).toBe('_.json');
    expect(plain(contentDisposition('', 'json', 'kawacity-account'))).toBe('kawacity-account.json');
  });

  test('Node accepts the header for any name (a header Node refuses would be a 500)', async () => {
    const names = ['Tokyo €', 'Москва', 'abc‮gpj', '日本の街', 'a"b', 'a\r\nb'];
    const server = http.createServer((req, res) => {
      const name = names[Number(req.url!.slice(1))];
      attachment(res, {name, extension: 'kawacity', contentType: 'application/json', body: '{}'});
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      for (let i = 0; i < names.length; i++) {
        const response = await request(url, '/' + i);
        expect(response.status).toBe(200);
        expect(extended(response.headers['content-disposition'] as string)).toBe(names[i] + '.kawacity');
        expect(response.headers['content-type']).toBe('application/json');
      }
    } finally {
      server.close();
    }
  });
});
