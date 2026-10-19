/* KawaCity, a modified version of micropolisJS.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

import { readFileSync } from 'node:fs';
import { isIP } from 'node:net';
import path from 'node:path';
import { Cidr, parseCidr } from './http/ip';
import { LOG_LEVELS, LogLevel } from './log';

// The server's configuration, from environment variables (listed with their defaults in .env.example and README.md).
// parseConfig only reads the object it is given (and the files of *_FILE variables): server/main.ts passes it
// process.env. An empty variable counts as unset, as Compose passes ${VARIABLE:-} when it is not set.

export interface SmtpConfig {
  host: string;
  port: number;
  // Implicit TLS (port 465); otherwise STARTTLS, required unless requireTls is false
  secure: boolean;
  requireTls: boolean;
  user: string | null;
  password: string | null;
}

export interface MailAddress {
  name: string;
  address: string;
}

export type MailTransport = 'smtp' | 'log' | 'none';

export interface Config {
  port: number;
  host: string;
  // The address players open, as an origin: scheme, host and port only (https://kawacity.example.com). Links in mails
  // start with it, and requests that change something must come from it.
  publicOrigin: string;
  publicUrlDefaulted: boolean;
  https: boolean;
  allowInsecureHttp: boolean;
  dataDir: string;
  staticDir: string;
  trustProxy: number;
  trustedProxies: readonly Cidr[];
  ipLimitFactor: number;
  smtp: SmtpConfig | null;
  mailFrom: MailAddress | null;
  mailTransport: MailTransport;
  mailMaxPerHour: number;
  registration: 'open' | 'closed';
  operatorContact: string | null;
  captchaMaxNumber: number;
  captchaAllowEasy: boolean;
  captchaSecret: string | null;
  passwordHashCost: number;
  sessionIdleDays: number;
  sessionMaxDays: number;
  maxRooms: number;
  maxCities: number;
  maxWsConnections: number;
  hsts: boolean;
  logLevel: LogLevel;
  buildId: string;
}

export type Env = Readonly<Record<string, string | undefined>>;

export type ConfigResult = {ok: true; config: Config} | {ok: false; errors: string[]};

export interface ConfigOptions {
  // Reads the file of a *_FILE variable (tests give their own)
  readFile?: (file: string) => string;
  // BUILD_ID when the variable is not set: the build's own
  defaultBuildId?: string;
  // Relative DATA_DIR and STATIC_DIR are taken from here
  cwd?: string;
}

export const DEFAULT_PUBLIC_URL = 'http://localhost:8080';

export const DEFAULT_TRUSTED_PROXIES = '127.0.0.0/8,::1/128,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,fc00::/7';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

// The address part of MAIL_FROM: the grammar of an HTML email input, the one accounts' addresses follow
const EMAIL = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

const CONTROL_OR_FORMAT = /[\p{Cc}\p{Cf}]/u;

const MIN_CAPTCHA_SECRET = 32;

export function parseConfig(env: Env, options: ConfigOptions = {}): ConfigResult {
  const readFile = options.readFile ?? ((file: string) => readFileSync(file, 'utf8'));
  const cwd = options.cwd ?? process.cwd();
  const errors: string[] = [];

  const value = (name: string): string | undefined => {
    const text = env[name];
    return text === undefined || text === '' ? undefined : text;
  };

  const show = (text: string) => JSON.stringify(text);

  const integer = (name: string, fallback: number, min: number, max: number): number => {
    const text = value(name);
    if (text === undefined)
      return fallback;

    const n = /^\d{1,9}$/.test(text.trim()) ? Number(text.trim()) : NaN;
    if (!(n >= min && n <= max)) {
      errors.push(`${name} must be a whole number from ${min} to ${max} (it is ${show(text)})`);
      return fallback;
    }
    return n;
  };

  const boolean = (name: string, fallback: boolean): boolean => {
    const text = value(name);
    if (text === undefined)
      return fallback;

    const lower = text.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(lower))
      return true;
    if (['false', '0', 'no', 'off'].includes(lower))
      return false;

    errors.push(`${name} must be true or false (it is ${show(text)})`);
    return fallback;
  };

  const choice = <T extends string>(name: string, choices: readonly T[], fallback: T): T => {
    const text = value(name);
    if (text === undefined)
      return fallback;

    const lower = text.trim().toLowerCase();
    const found = choices.find(c => c === lower);
    if (found === undefined) {
      errors.push(`${name} must be one of ${choices.join(', ')} (it is ${show(text)})`);
      return fallback;
    }
    return found;
  };

  // A secret given in the variable itself or, with Docker secrets, in the file named by NAME_FILE (one trailing newline
  // dropped). Secrets are never repeated in error messages.
  const fileValue = (fileVariable: string): string | undefined => {
    const file = value(fileVariable);
    if (file === undefined)
      return undefined;

    try {
      return readFile(file).replace(/\r?\n$/, '');
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code ?? 'error';
      errors.push(`${fileVariable}: the file ${show(file)} cannot be read (${code})`);
      return undefined;
    }
  };

  const secret = (name: string): string | undefined => {
    if (value(name) !== undefined && value(name + '_FILE') !== undefined) {
      errors.push(`${name} and ${name}_FILE are both set: set only one of them`);
      return undefined;
    }

    return value(name) ?? fileValue(name + '_FILE');
  };

  const directory = (name: string, fallback: string): string => path.resolve(cwd, value(name) ?? fallback);

  // PORT, HOST
  const port = integer('PORT', 8080, 1, 65535);
  const host = value('HOST')?.trim() ?? '0.0.0.0';
  if (!isIP(host) && !/^[A-Za-z0-9.-]{1,253}$/.test(host))
    errors.push(`HOST must be an address to listen on, such as 0.0.0.0 or :: (it is ${show(host)})`);

  // PUBLIC_URL
  const allowInsecureHttp = boolean('ALLOW_INSECURE_HTTP', false);
  const publicUrlText = value('PUBLIC_URL')?.trim();
  const publicUrl = parsePublicUrl(publicUrlText ?? DEFAULT_PUBLIC_URL, allowInsecureHttp, errors);

  // Proxies
  const trustProxy = integer('TRUST_PROXY', 0, 0, 5);
  const trustedProxies: Cidr[] = [];
  for (const part of (value('TRUSTED_PROXIES') ?? DEFAULT_TRUSTED_PROXIES).split(',')) {
    const text = part.trim();
    if (text === '')
      continue;

    const cidr = parseCidr(text);
    if (cidr)
      trustedProxies.push(cidr);
    else
      errors.push(`TRUSTED_PROXIES: ${show(text)} is not an address or a range such as 10.0.0.0/8 or fc00::/7`);
  }
  const ipLimitFactor = integer('IP_LIMIT_FACTOR', 1, 1, 100);

  // Mail
  const smtpHost = value('SMTP_HOST')?.trim();
  const smtpPort = integer('SMTP_PORT', 587, 1, 65535);
  const smtpSecure = boolean('SMTP_SECURE', false);
  const smtpRequireTls = boolean('SMTP_REQUIRE_TLS', true);
  const smtpUser = secret('SMTP_USER') ?? null;
  const smtpPassword = secret('SMTP_PASSWORD') ?? null;
  const mailFromText = value('MAIL_FROM');
  const mailFrom = mailFromText === undefined ? null : parseMailAddress(mailFromText);
  if (mailFromText !== undefined && !mailFrom)
    errors.push(`MAIL_FROM must be an address, or a name and an address such as KawaCity <kawacity@example.com> (it is ${show(mailFromText)})`);

  // MAIL_TRANSPORT=log prints mails, links included, instead of sending them: for development only
  const mailTransportText = value('MAIL_TRANSPORT');
  const logTransport = mailTransportText?.trim().toLowerCase() === 'log';
  if (mailTransportText !== undefined && !logTransport)
    errors.push(`MAIL_TRANSPORT must be log, or unset (it is ${show(mailTransportText)})`);
  let smtp: SmtpConfig | null = null;
  if (smtpHost !== undefined) {
    if (logTransport)
      errors.push('MAIL_TRANSPORT=log and SMTP_HOST are both set: set only one of them');
    if (mailFromText === undefined)
      errors.push('MAIL_FROM is required with SMTP_HOST, for example: KawaCity <kawacity@example.com>');
    if (smtpPassword !== null && smtpUser === null)
      errors.push('SMTP_PASSWORD is set but SMTP_USER is not');

    smtp = {host: smtpHost, port: smtpPort, secure: smtpSecure, requireTls: smtpRequireTls, user: smtpUser,
            password: smtpPassword};
  }
  const mailTransport: MailTransport = smtp ? 'smtp' : logTransport ? 'log' : 'none';
  const mailMaxPerHour = integer('MAIL_MAX_PER_HOUR', 200, 1, 100000);

  // Accounts
  const registration = choice('REGISTRATION', ['open', 'closed'] as const, 'open');
  const operatorContact = value('OPERATOR_CONTACT')?.trim() ?? null;
  if (operatorContact !== null && (operatorContact.length > 300 || CONTROL_OR_FORMAT.test(operatorContact)))
    errors.push('OPERATOR_CONTACT must be one line of at most 300 characters');

  // CAPTCHA_ALLOW_EASY is for tests: it allows a captcha and a password hash that are fast to compute
  const captchaAllowEasy = boolean('CAPTCHA_ALLOW_EASY', false);
  const captchaMaxNumber = integer('CAPTCHA_MAX_NUMBER', 150000, captchaAllowEasy ? 1 : 100000, 10000000);
  const captchaSecret = fileValue('CAPTCHA_SECRET_FILE') ?? null;
  if (captchaSecret !== null && captchaSecret.length < MIN_CAPTCHA_SECRET)
    errors.push(`CAPTCHA_SECRET_FILE: the secret must be at least ${MIN_CAPTCHA_SECRET} characters long (for example the output of: openssl rand -hex 32)`);
  const passwordHashCost = integer('PASSWORD_HASH_COST', 15, captchaAllowEasy ? 10 : 15, 20);

  const sessionIdleDays = integer('SESSION_IDLE_DAYS', 7, 1, 365);
  const sessionMaxDays = integer('SESSION_MAX_DAYS', 30, 1, 365);
  if (sessionIdleDays > sessionMaxDays)
    errors.push(`SESSION_IDLE_DAYS (${sessionIdleDays}) must not be more than SESSION_MAX_DAYS (${sessionMaxDays})`);

  // Multiplayer
  const maxRooms = integer('MAX_ROOMS', 10, 1, 1000);
  const maxCities = integer('MAX_CITIES', 2000, 1, 1000000);
  const maxWsConnections = integer('MAX_WS_CONNECTIONS', 500, 1, 100000);

  // Operations
  const hsts = boolean('HSTS', true);
  const logLevel = choice('LOG_LEVEL', LOG_LEVELS, 'info');
  const buildId = value('BUILD_ID')?.trim() ?? options.defaultBuildId ?? 'unknown';
  if (!/^[A-Za-z0-9._+-]{1,64}$/.test(buildId))
    errors.push(`BUILD_ID must be at most 64 letters, digits and . _ + - (it is ${show(buildId)})`);

  if (errors.length > 0 || !publicUrl)
    return {ok: false, errors};

  return {
    ok: true,
    config: {
      port,
      host,
      publicOrigin: publicUrl.origin,
      publicUrlDefaulted: publicUrlText === undefined,
      https: publicUrl.protocol === 'https:',
      allowInsecureHttp,
      dataDir: directory('DATA_DIR', './data'),
      staticDir: directory('STATIC_DIR', './dist'),
      trustProxy,
      trustedProxies,
      ipLimitFactor,
      smtp,
      mailFrom,
      mailTransport,
      mailMaxPerHour,
      registration,
      operatorContact,
      captchaMaxNumber,
      captchaAllowEasy,
      captchaSecret,
      passwordHashCost,
      sessionIdleDays,
      sessionMaxDays,
      maxRooms,
      maxCities,
      maxWsConnections,
      hsts,
      logLevel,
      buildId,
    },
  };
}

// PUBLIC_URL is an origin only: http or https, a host and maybe a port, nothing else. Plain http is for a game played
// on this computer only, unless ALLOW_INSECURE_HTTP is set.
function parsePublicUrl(text: string, allowInsecureHttp: boolean, errors: string[]): URL | null {
  const problem = (why: string) => {
    errors.push(`PUBLIC_URL ${why} (it is ${JSON.stringify(text)})`);
    return null;
  };

  let url: URL;
  try {
    url = new URL(text);
  } catch (e) {
    return problem('must be the address players open, such as https://kawacity.example.com');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    return problem('must start with https:// or http://');
  if (url.username !== '' || url.password !== '')
    return problem('must not contain a user name or a password');
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '' || /[?#]/.test(text))
    return problem('must not have a path, a query or a fragment: the game is served from the root of its address');
  if (url.protocol === 'http:' && !LOCAL_HOSTS.has(url.hostname) && !allowInsecureHttp)
    return problem('must use https, except for localhost, 127.0.0.1 and [::1]: put the game behind a reverse proxy with TLS, or set ALLOW_INSECURE_HTTP=1 to play without it');

  return url;
}

// MAIL_FROM: "Name <address>" or "address"
export function parseMailAddress(text: string): MailAddress | null {
  const trimmed = text.trim();
  const withName = /^(.*?)\s*<([^<>]*)>$/.exec(trimmed);
  const name = withName ? withName[1].trim().replace(/^"(.*)"$/, '$1') : '';
  const address = withName ? withName[2].trim() : trimmed;

  if (!EMAIL.test(address) || address.length > 254)
    return null;
  if (name.length > 100 || CONTROL_OR_FORMAT.test(name) || /[<>"]/.test(name))
    return null;

  return {name, address};
}
