/* KawaCity, a modified version of micropolisJS.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

import { PassThrough } from 'node:stream';
import type { IncomingMessage } from 'node:http';
import { Cidr, cidrContains, formatCidr, formatIp, parseCidr, parseIp, rateLimitKeys } from '../http/ip';
import { clientAddress, parseCookies, parseRequestTarget, readJsonBody } from '../http/request';
import { HttpError } from '../http/response';
import { DEFAULT_TRUSTED_PROXIES } from '../config';

const cidrs = (text: string): Cidr[] => text.split(',').map(part => parseCidr(part) as Cidr);
const trusted = cidrs(DEFAULT_TRUSTED_PROXIES);

describe('IP addresses', () => {
  test.each([
    ['192.0.2.1', '192.0.2.1'],
    ['::ffff:192.0.2.1', '192.0.2.1'],
    ['::FFFF:c000:0201', '192.0.2.1'],
    ['2001:0DB8:0000:0000:0000:0000:0000:0001', '2001:db8::1'],
    ['2001:db8:0:0:1:0:0:1', '2001:db8::1:0:0:1'],
    ['fe80::1%eth0', 'fe80::1'],
    ['::1', '::1'],
    ['::', '::'],
    ['1::', '1::'],
    ['64:ff9b::192.0.2.33', '64:ff9b::c000:221'],
  ])('%s is %s', (text, canonical) => {
    const ip = parseIp(text);
    expect(ip).not.toBeNull();
    expect(formatIp(ip!)).toBe(canonical);
  });

  test.each(['', 'localhost', '1.2.3', '256.1.1.1', '1.2.3.4:80', '[::1]', '::g', '1:2:3:4:5:6:7:8:9'])(
    '%s is not an address', text => {
      expect(parseIp(text)).toBeNull();
    });

  test('CIDR ranges', () => {
    expect(formatCidr(parseCidr('10.1.2.3/8')!)).toBe('10.0.0.0/8');
    expect(formatCidr(parseCidr('2001:db8::1')!)).toBe('2001:db8::1/128');
    expect(formatCidr(parseCidr('fc00::/7')!)).toBe('fc00::/7');
    expect(parseCidr('10.0.0.0/33')).toBeNull();
    expect(parseCidr('::/129')).toBeNull();
    expect(parseCidr('10.0.0.0/-1')).toBeNull();
    expect(parseCidr('10.0.0.0/')).toBeNull();
    expect(parseCidr('::ffff:10.0.0.0/8')).toBeNull();

    const range = parseCidr('172.16.0.0/12')!;
    expect(cidrContains(range, parseIp('172.31.255.255')!)).toBe(true);
    expect(cidrContains(range, parseIp('172.32.0.1')!)).toBe(false);
    expect(cidrContains(range, parseIp('::ffff:172.17.0.1')!)).toBe(true);
    const ula = parseCidr('fc00::/7')!;
    expect(cidrContains(ula, parseIp('fd12:3456::1')!)).toBe(true);
    expect(cidrContains(ula, parseIp('fe80::1')!)).toBe(false);
    expect(cidrContains(ula, parseIp('10.0.0.1')!)).toBe(false);
  });

  test('Rate limit keys: IPv4 alone, IPv6 by /64 with a /48 aggregate', () => {
    expect(rateLimitKeys(parseIp('203.0.113.9')!)).toEqual({key: '203.0.113.9', aggregateKey: null});
    expect(rateLimitKeys(parseIp('2001:db8:aaaa:bbbb:1:2:3:4')!)).toEqual(
      {key: '2001:db8:aaaa:bbbb::/64', aggregateKey: '2001:db8:aaaa::/48'});
    expect(rateLimitKeys(parseIp('2001:db8:aaaa:bbbb:ffff::')!).key).toBe('2001:db8:aaaa:bbbb::/64');
    expect(rateLimitKeys(parseIp('2001:db8:aaaa:bbbc::1')!).key).not.toBe('2001:db8:aaaa:bbbb::/64');
    expect(rateLimitKeys(parseIp('::ffff:203.0.113.9')!).key).toBe('203.0.113.9');
  });
});

describe('Client address', () => {
  const noProxy = {trustProxy: 0, trustedProxies: trusted};
  const oneProxy = {trustProxy: 1, trustedProxies: trusted};
  const twoProxies = {trustProxy: 2, trustedProxies: trusted};

  test('Without proxies, the socket address, whatever X-Forwarded-For says', () => {
    expect(clientAddress('::ffff:203.0.113.9', undefined, noProxy).ip).toBe('203.0.113.9');
    expect(clientAddress('127.0.0.1', '198.51.100.1', noProxy).ip).toBe('127.0.0.1');
  });

  test('Behind a trusted proxy, the address it saw', () => {
    expect(clientAddress('172.18.0.1', '198.51.100.7', oneProxy)).toEqual(
      {ip: '198.51.100.7', key: '198.51.100.7', aggregateKey: null});
    expect(clientAddress('::1', '2001:db8:1:2::99', oneProxy)).toEqual(
      {ip: '2001:db8:1:2::99', key: '2001:db8:1:2::/64', aggregateKey: '2001:db8:1::/48'});
  });

  test('What the client wrote itself is ignored: only the last TRUST_PROXY entries count', () => {
    // The client sent "X-Forwarded-For: 1.1.1.1"; the proxy appended the address it saw
    expect(clientAddress('10.0.0.2', '1.1.1.1, 198.51.100.7', oneProxy).ip).toBe('198.51.100.7');
    expect(clientAddress('10.0.0.2', ['1.1.1.1', '198.51.100.7'], oneProxy).ip).toBe('198.51.100.7');
    // Two proxies (a CDN, then nginx): the client is the second from the right
    expect(clientAddress('10.0.0.2', '1.1.1.1, 198.51.100.7, 203.0.113.50', twoProxies).ip).toBe('198.51.100.7');
  });

  test('X-Forwarded-For from an untrusted peer is ignored (a client reaching the port directly)', () => {
    expect(clientAddress('203.0.113.66', '127.0.0.1', oneProxy).ip).toBe('203.0.113.66');
    expect(clientAddress('2001:db8::66', '10.0.0.1', oneProxy).ip).toBe('2001:db8::66');
    expect(clientAddress('10.0.0.2', '198.51.100.7', {trustProxy: 1, trustedProxies: cidrs('127.0.0.1/32')}).ip)
      .toBe('10.0.0.2');
  });

  test('Too few entries, or unreadable ones, give the socket address', () => {
    expect(clientAddress('10.0.0.2', '198.51.100.7', twoProxies).ip).toBe('10.0.0.2');
    expect(clientAddress('10.0.0.2', '', oneProxy).ip).toBe('10.0.0.2');
    expect(clientAddress('10.0.0.2', ' , ', oneProxy).ip).toBe('10.0.0.2');
    expect(clientAddress('10.0.0.2', 'unknown', oneProxy).ip).toBe('10.0.0.2');
    expect(clientAddress('10.0.0.2', '198.51.100.7, <script>', oneProxy).ip).toBe('10.0.0.2');
    expect(clientAddress('10.0.0.2', '_hidden', oneProxy).ip).toBe('10.0.0.2');
  });

  test('Entries with ports', () => {
    expect(clientAddress('10.0.0.2', '198.51.100.7:4711', oneProxy).ip).toBe('198.51.100.7');
    expect(clientAddress('10.0.0.2', '[2001:db8::7]:4711', oneProxy).ip).toBe('2001:db8::7');
    expect(clientAddress('10.0.0.2', '[2001:db8::7]', oneProxy).ip).toBe('2001:db8::7');
  });

  test('No socket address', () => {
    expect(clientAddress(undefined, '198.51.100.7', oneProxy)).toEqual({ip: 'unknown', key: 'unknown',
                                                                        aggregateKey: null});
  });
});

describe('Cookies', () => {
  test('Cookies are read by name, the first of a name winning', () => {
    const cookies = parseCookies('a=1; kc_session=abc-DEF_123; b="quoted"; a=2; broken; =x; c=');
    expect([...cookies.entries()]).toEqual([['a', '1'], ['kc_session', 'abc-DEF_123'], ['b', 'quoted'], ['c', '']]);
    expect(parseCookies(undefined).size).toBe(0);
  });
});

describe('Request paths', () => {
  test.each([
    ['/', '/', ['']],
    ['/index.html?v=1', '/index.html', ['index.html']],
    ['/api/cities/abc', '/api/cities/abc', ['api', 'cities', 'abc']],
    ['/images/a%20b.png', '/images/a b.png', ['images', 'a b.png']],
    ['/cities/', '/cities/', ['cities', '']],
    ['http://evil.example/src/x.js?v=2', '/src/x.js', ['src', 'x.js']],
  ])('%s', (raw, pathName, segments) => {
    const target = parseRequestTarget(raw);
    expect(target?.path).toBe(pathName);
    expect(target?.segments).toEqual(segments);
  });

  test.each(['/../etc/passwd', '/src/../index.html', '/%2e%2e/etc/passwd', '/src/%2E%2E/x', '/./index.html',
             '/src%2fmicropolis.js', '/src%2Fmicropolis.js', '/src%5cmicropolis.js', '/src\\micropolis.js',
             '//etc/passwd', '/src//micropolis.js', '/%00', '/%E0%A4%A', 'index.html', '*', 'file:///etc/passwd'])(
    '%s is refused', raw => {
      expect(parseRequestTarget(raw)).toBeNull();
    });

  test('The query is kept', () => {
    expect(parseRequestTarget('/api/captcha?action=login')?.search).toBe('?action=login');
  });
});

describe('JSON bodies', () => {
  const fakeRequest = (contentType: string | undefined, chunks: (string | Buffer)[], length?: number) => {
    const stream = new PassThrough();
    const req = stream as unknown as IncomingMessage;
    (req as any).headers = {
      ...(contentType !== undefined ? {'content-type': contentType} : {}),
      ...(length !== undefined ? {'content-length': String(length)} : {}),
    };
    setImmediate(() => {
      chunks.forEach(chunk => stream.write(chunk));
      stream.end();
    });
    return req;
  };

  const failure = async (promise: Promise<unknown>): Promise<HttpError> => {
    try {
      await promise;
    } catch (e) {
      return e as HttpError;
    }
    throw new Error('expected a failure');
  };

  test('A JSON body is parsed', async () => {
    await expect(readJsonBody(fakeRequest('application/json', ['{"a":', ' [1, "é"]}']), 100))
      .resolves.toEqual({a: [1, 'é']});
    await expect(readJsonBody(fakeRequest('Application/JSON; charset=utf-8', ['{}']), 100)).resolves.toEqual({});
  });

  test('Other content types are refused with 415', async () => {
    for (const type of [undefined, 'text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data',
                        'application/jsonp', 'application/json-patch+json']) {
      const error = await failure(readJsonBody(fakeRequest(type, ['{}']), 100));
      expect([error.status, error.code]).toEqual([415, 'unsupported_media_type']);
    }
  });

  test('Bodies over the limit are refused with 413, declared or not', async () => {
    const declared = await failure(readJsonBody(fakeRequest('application/json', ['{}'], 5000), 100));
    expect([declared.status, declared.code, declared.headers]).toEqual([413, 'payload_too_large',
                                                                        {Connection: 'close'}]);

    const streamed = await failure(readJsonBody(fakeRequest('application/json', ['{"a":"', 'x'.repeat(200), '"}']),
                                                100));
    expect([streamed.status, streamed.code]).toEqual([413, 'payload_too_large']);

    const exact = '{"a":"' + 'x'.repeat(92) + '"}';
    expect(exact.length).toBe(100);
    await expect(readJsonBody(fakeRequest('application/json', [exact]), 100)).resolves.toEqual({a: 'x'.repeat(92)});
  });

  test('Bad JSON, an empty body and bad UTF-8 are refused with 400 invalid_input', async () => {
    for (const body of ['{"a":', '', 'undefined', "{'a': 1}", Buffer.from([0x7b, 0x22, 0xff, 0x22, 0x7d])]) {
      const error = await failure(readJsonBody(fakeRequest('application/json', [body]), 100));
      expect([error.status, error.code]).toEqual([400, 'invalid_input']);
    }
  });

  test('__proto__ in a body stays a plain own property', async () => {
    const body = await readJsonBody(fakeRequest('application/json', ['{"__proto__": {"admin": true}}']), 100) as any;
    expect(Object.getPrototypeOf(body)).toBe(Object.prototype);
    expect(({} as any).admin).toBeUndefined();
  });
});
