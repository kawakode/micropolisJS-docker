/* KawaCity, a modified version of micropolisJS.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

import path from 'node:path';
import { Config, Env, parseConfig, parseMailAddress } from '../config';
import { formatCidr } from '../http/ip';

const parse = (env: Env, files: Record<string, string> = {}) => parseConfig(env, {
  cwd: '/srv/kawacity',
  defaultBuildId: 'built',
  readFile: file => {
    if (!(file in files)) {
      const error: NodeJS.ErrnoException = new Error('missing');
      error.code = 'ENOENT';
      throw error;
    }
    return files[file];
  },
});

const config = (env: Env, files?: Record<string, string>): Config => {
  const result = parse(env, files);
  if (!result.ok)
    throw new Error(result.errors.join('\n'));
  return result.config;
};

const errors = (env: Env, files?: Record<string, string>): string[] => {
  const result = parse(env, files);
  return result.ok ? [] : result.errors;
};

describe('Configuration defaults', () => {
  test('An empty environment gives the documented defaults', () => {
    const c = config({});
    expect(c.port).toBe(8080);
    expect(c.host).toBe('0.0.0.0');
    expect(c.publicOrigin).toBe('http://localhost:8080');
    expect(c.publicUrlDefaulted).toBe(true);
    expect(c.https).toBe(false);
    expect(c.dataDir).toBe(path.resolve('/srv/kawacity', 'data'));
    expect(c.staticDir).toBe(path.resolve('/srv/kawacity', 'dist'));
    expect(c.trustProxy).toBe(0);
    expect(c.trustedProxies.map(formatCidr)).toEqual(['127.0.0.0/8', '::1/128', '10.0.0.0/8', '172.16.0.0/12',
                                                       '192.168.0.0/16', 'fc00::/7']);
    expect(c.ipLimitFactor).toBe(1);
    expect(c.smtp).toBeNull();
    expect(c.mailTransport).toBe('none');
    expect(c.mailMaxPerHour).toBe(200);
    expect(c.registration).toBe('open');
    expect(c.operatorContact).toBeNull();
    expect(c.captchaMaxNumber).toBe(150000);
    expect(c.captchaAllowEasy).toBe(false);
    expect(c.captchaSecret).toBeNull();
    expect(c.passwordHashCost).toBe(15);
    expect(c.sessionIdleDays).toBe(7);
    expect(c.sessionMaxDays).toBe(30);
    expect(c.maxRooms).toBe(10);
    expect(c.maxCities).toBe(2000);
    expect(c.maxWsConnections).toBe(500);
    expect(c.hsts).toBe(true);
    expect(c.logLevel).toBe('info');
    expect(c.buildId).toBe('built');
  });

  test('Empty variables count as unset, as Compose passes them', () => {
    const c = config({PUBLIC_URL: '', SMTP_HOST: '', PORT: '', TRUSTED_PROXIES: '', MAIL_TRANSPORT: ''});
    expect(c.publicUrlDefaulted).toBe(true);
    expect(c.smtp).toBeNull();
    expect(c.port).toBe(8080);
    expect(c.trustedProxies.length).toBe(6);
  });

  test('Values are read', () => {
    const c = config({
      PORT: '3000', HOST: '::', PUBLIC_URL: 'https://Game.Example.com:443/', DATA_DIR: '/data', STATIC_DIR: 'public',
      TRUST_PROXY: '2', TRUSTED_PROXIES: ' 10.1.0.0/16 , 2001:db8::/32 ', IP_LIMIT_FACTOR: '20', REGISTRATION: 'Closed',
      OPERATOR_CONTACT: 'Jo <jo@example.com>', SESSION_IDLE_DAYS: '1', SESSION_MAX_DAYS: '2', MAX_ROOMS: '4',
      MAX_CITIES: '50', MAX_WS_CONNECTIONS: '60', HSTS: 'false', LOG_LEVEL: 'DEBUG', BUILD_ID: 'v2.0.0',
      MAIL_MAX_PER_HOUR: '10',
    });
    expect(c.port).toBe(3000);
    expect(c.host).toBe('::');
    expect(c.publicOrigin).toBe('https://game.example.com');
    expect(c.https).toBe(true);
    expect(c.dataDir).toBe('/data');
    expect(c.staticDir).toBe('/srv/kawacity/public');
    expect(c.trustProxy).toBe(2);
    expect(c.trustedProxies.map(formatCidr)).toEqual(['10.1.0.0/16', '2001:db8::/32']);
    expect(c.ipLimitFactor).toBe(20);
    expect(c.registration).toBe('closed');
    expect(c.operatorContact).toBe('Jo <jo@example.com>');
    expect([c.sessionIdleDays, c.sessionMaxDays, c.maxRooms, c.maxCities, c.maxWsConnections]).toEqual([1, 2, 4, 50, 60]);
    expect(c.hsts).toBe(false);
    expect(c.logLevel).toBe('debug');
    expect(c.buildId).toBe('v2.0.0');
    expect(c.mailMaxPerHour).toBe(10);
  });
});

describe('PUBLIC_URL', () => {
  test.each([
    ['https://kawacity.example.com', 'https://kawacity.example.com'],
    ['https://kawacity.example.com/', 'https://kawacity.example.com'],
    ['https://KawaCity.Example.com:443', 'https://kawacity.example.com'],
    ['https://kawacity.example.com:8443/', 'https://kawacity.example.com:8443'],
    ['http://localhost:8080', 'http://localhost:8080'],
    ['http://127.0.0.1:3000/', 'http://127.0.0.1:3000'],
    ['http://[::1]:8080', 'http://[::1]:8080'],
    ['https://xn--caf-dma.example', 'https://xn--caf-dma.example'],
  ])('%s is the origin %s', (text, origin) => {
    expect(config({PUBLIC_URL: text}).publicOrigin).toBe(origin);
    expect(config({PUBLIC_URL: text}).publicUrlDefaulted).toBe(false);
  });

  test.each([
    'kawacity.example.com',
    'ftp://kawacity.example.com',
    'https://user:pass@kawacity.example.com',
    'https://kawacity.example.com/game',
    'https://kawacity.example.com/game/',
    'https://kawacity.example.com/?a=1',
    'https://kawacity.example.com/?',
    'https://kawacity.example.com/#top',
    'https://kawacity.example.com#',
    'javascript:alert(1)',
  ])('%s is refused', text => {
    const problems = errors({PUBLIC_URL: text});
    expect(problems.length).toBe(1);
    expect(problems[0]).toMatch(/^PUBLIC_URL/);
  });

  test('Plain http is refused for another host, unless ALLOW_INSECURE_HTTP is set', () => {
    expect(errors({PUBLIC_URL: 'http://192.168.1.10:8080'})[0]).toMatch(/ALLOW_INSECURE_HTTP/);
    expect(errors({PUBLIC_URL: 'http://kawacity.example.com'})[0]).toMatch(/must use https/);
    const c = config({PUBLIC_URL: 'http://192.168.1.10:8080', ALLOW_INSECURE_HTTP: '1'});
    expect(c.publicOrigin).toBe('http://192.168.1.10:8080');
    expect(c.allowInsecureHttp).toBe(true);
  });
});

describe('Secrets in files', () => {
  test('*_FILE variables are read, without one trailing newline', () => {
    const c = config({SMTP_HOST: 'smtp.example.com', MAIL_FROM: 'kawacity@example.com', SMTP_USER_FILE: '/run/user',
                      SMTP_PASSWORD_FILE: '/run/password', CAPTCHA_SECRET_FILE: '/run/captcha'},
                     {'/run/user': 'mailer\n', '/run/password': 'pa ss\n\n', '/run/captcha': 'k'.repeat(64) + '\r\n'});
    expect(c.smtp?.user).toBe('mailer');
    expect(c.smtp?.password).toBe('pa ss\n');
    expect(c.captchaSecret).toBe('k'.repeat(64));
  });

  test('A variable and its _FILE are not both accepted', () => {
    const problems = errors({SMTP_HOST: 'smtp.example.com', MAIL_FROM: 'a@example.com', SMTP_USER: 'u',
                             SMTP_PASSWORD: 'secret-value', SMTP_PASSWORD_FILE: '/run/password'},
                            {'/run/password': 'x'});
    expect(problems).toEqual(['SMTP_PASSWORD and SMTP_PASSWORD_FILE are both set: set only one of them']);
  });

  test('A missing file is reported, and secrets are never shown', () => {
    const problems = errors({CAPTCHA_SECRET_FILE: '/run/none'});
    expect(problems).toEqual(['CAPTCHA_SECRET_FILE: the file "/run/none" cannot be read (ENOENT)']);

    const short = errors({CAPTCHA_SECRET_FILE: '/run/short'}, {'/run/short': 'tooshort-secret'});
    expect(short.length).toBe(1);
    expect(short[0]).not.toContain('tooshort-secret');
  });
});

describe('Mail', () => {
  test('SMTP is configured by SMTP_HOST', () => {
    const c = config({SMTP_HOST: 'smtp.example.com', SMTP_PORT: '465', SMTP_SECURE: 'true', SMTP_USER: 'u',
                      SMTP_PASSWORD: 'p', MAIL_FROM: 'KawaCity <kawacity@example.com>'});
    expect(c.mailTransport).toBe('smtp');
    expect(c.smtp).toEqual({host: 'smtp.example.com', port: 465, secure: true, requireTls: true, user: 'u',
                            password: 'p'});
    expect(c.mailFrom).toEqual({name: 'KawaCity', address: 'kawacity@example.com'});
  });

  test('MAIL_FROM is required with SMTP_HOST', () => {
    expect(errors({SMTP_HOST: 'smtp.example.com'})[0]).toMatch(/^MAIL_FROM is required/);
  });

  test('MAIL_TRANSPORT=log', () => {
    expect(config({MAIL_TRANSPORT: 'log'}).mailTransport).toBe('log');
    expect(errors({MAIL_TRANSPORT: 'smtp'})[0]).toMatch(/^MAIL_TRANSPORT/);
    expect(errors({MAIL_TRANSPORT: 'log', SMTP_HOST: 'h', MAIL_FROM: 'a@example.com'})[0]).toMatch(/both set/);
  });

  test.each([
    ['kawacity@example.com', {name: '', address: 'kawacity@example.com'}],
    ['KawaCity <kawacity@example.com>', {name: 'KawaCity', address: 'kawacity@example.com'}],
    ['"Kawa City" <kawacity@example.com>', {name: 'Kawa City', address: 'kawacity@example.com'}],
    ['<kawacity@example.com>', {name: '', address: 'kawacity@example.com'}],
  ])('MAIL_FROM %s', (text, expected) => {
    expect(parseMailAddress(text)).toEqual(expected);
  });

  test.each(['kawacity', 'a@b', 'x<v@e.com>,y@e.com', 'a,b@e.com', 'Name <a@e.com> <b@e.com>', 'N‮ <a@e.com>'])(
    'MAIL_FROM %s is refused', text => {
      expect(parseMailAddress(text)).toBeNull();
    });
});

describe('Invalid values', () => {
  test('Every problem is reported, one line each', () => {
    const problems = errors({PORT: '80a', TRUST_PROXY: '6', IP_LIMIT_FACTOR: '0', HSTS: 'maybe', LOG_LEVEL: 'trace',
                             REGISTRATION: 'invite', TRUSTED_PROXIES: '10.0.0.0/33,not-an-ip', HOST: 'a b',
                             SESSION_IDLE_DAYS: '40', SESSION_MAX_DAYS: '30', BUILD_ID: '<script>'});
    expect(problems).toEqual([
      'PORT must be a whole number from 1 to 65535 (it is "80a")',
      'HOST must be an address to listen on, such as 0.0.0.0 or :: (it is "a b")',
      'TRUST_PROXY must be a whole number from 0 to 5 (it is "6")',
      'TRUSTED_PROXIES: "10.0.0.0/33" is not an address or a range such as 10.0.0.0/8 or fc00::/7',
      'TRUSTED_PROXIES: "not-an-ip" is not an address or a range such as 10.0.0.0/8 or fc00::/7',
      'IP_LIMIT_FACTOR must be a whole number from 1 to 100 (it is "0")',
      'REGISTRATION must be one of open, closed (it is "invite")',
      'SESSION_IDLE_DAYS (40) must not be more than SESSION_MAX_DAYS (30)',
      'HSTS must be true or false (it is "maybe")',
      'LOG_LEVEL must be one of error, warn, info, debug (it is "trace")',
      'BUILD_ID must be at most 64 letters, digits and . _ + - (it is "<script>")',
    ]);
  });

  test('Easy captchas and cheap password hashes only with CAPTCHA_ALLOW_EASY', () => {
    expect(errors({CAPTCHA_MAX_NUMBER: '10'})[0]).toMatch(/^CAPTCHA_MAX_NUMBER must be a whole number from 100000/);
    expect(errors({PASSWORD_HASH_COST: '10'})[0]).toMatch(/^PASSWORD_HASH_COST must be a whole number from 15/);
    const c = config({CAPTCHA_ALLOW_EASY: '1', CAPTCHA_MAX_NUMBER: '10', PASSWORD_HASH_COST: '10'});
    expect([c.captchaMaxNumber, c.passwordHashCost, c.captchaAllowEasy]).toEqual([10, 10, true]);
    expect(errors({PASSWORD_HASH_COST: '21'})[0]).toMatch(/^PASSWORD_HASH_COST/);
  });

  test('OPERATOR_CONTACT is one line', () => {
    expect(errors({OPERATOR_CONTACT: 'a\nb'})[0]).toMatch(/^OPERATOR_CONTACT/);
    expect(errors({OPERATOR_CONTACT: 'x'.repeat(301)})[0]).toMatch(/^OPERATOR_CONTACT/);
  });
});
