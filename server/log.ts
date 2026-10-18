/* KawaCity, a modified version of micropolisJS.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

import { Clock, systemClock } from './clock';

// The server's log: one JSON object per line on stdout, such as
//   {"time":"2026-10-18T12:00:00.000Z","level":"warn","event":"csrf.reject","requestId":"...","ip":"203.0.113.7"}
// Events are short dotted names (auth.login.fail, rate_limited...). Fields carry ids, never secrets: no passwords,
// tokens, cookies, captcha numbers, submitted logins or mail bodies.

export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

export const LOG_LEVELS: readonly LogLevel[] = ['error', 'warn', 'info', 'debug'];

export type LogFields = Record<string, unknown>;

export interface Logger {
  readonly level: LogLevel;
  enabled(level: LogLevel): boolean;
  error(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  debug(event: string, fields?: LogFields): void;
  // A security event that can be repeated at will (rate_limited, csrf.reject, ws.reject...): logged as a warning at
  // most once per event and key per minute. The next line for that event and key counts the ones left out, as
  // `suppressed`.
  security(event: string, key: string, fields?: LogFields): void;
}

export interface LoggerOptions {
  level?: LogLevel;
  clock?: Clock;
  write?: (line: string) => void;
}

const SECURITY_WINDOW = 60 * 1000;
const MAX_SECURITY_KEYS = 10000;
const RESERVED_FIELDS = new Set(['time', 'level', 'event']);

interface SecurityEntry {
  start: number;
  suppressed: number;
}

// Errors keep their stack; values JSON cannot write (bigint) become strings
const serialise = (_key: string, value: unknown): unknown => {
  if (value instanceof Error)
    return {name: value.name, message: value.message, stack: value.stack};

  if (typeof value === 'bigint')
    return value.toString();

  return value;
};

export function createLogger(options: LoggerOptions = {}): Logger {
  const level = options.level ?? 'info';
  const clock = options.clock ?? systemClock;
  const write = options.write ?? ((line: string) => { process.stdout.write(line + '\n'); });
  const threshold = LOG_LEVELS.indexOf(level);
  const securityEntries = new Map<string, SecurityEntry>();

  const enabled = (wanted: LogLevel) => LOG_LEVELS.indexOf(wanted) <= threshold;

  const emit = (lineLevel: LogLevel, event: string, fields?: LogFields) => {
    if (!enabled(lineLevel))
      return;

    const record: LogFields = {time: new Date(clock.now()).toISOString(), level: lineLevel, event};
    if (fields) {
      for (const [key, value] of Object.entries(fields)) {
        if (!RESERVED_FIELDS.has(key) && value !== undefined)
          record[key] = value;
      }
    }

    let line: string;
    try {
      line = JSON.stringify(record, serialise);
    } catch (e) {
      line = JSON.stringify({time: record.time, level: lineLevel, event, logError: String(e)});
    }
    write(line);
  };

  const forgetOldSecurityKeys = (now: number) => {
    for (const [key, entry] of securityEntries) {
      if (now - entry.start >= SECURITY_WINDOW)
        securityEntries.delete(key);
    }

    // Still full: forget the oldest, whose next line will merely not count what it left out
    while (securityEntries.size >= MAX_SECURITY_KEYS) {
      const oldest = securityEntries.keys().next().value;
      if (oldest === undefined)
        break;
      securityEntries.delete(oldest);
    }
  };

  const security = (event: string, key: string, fields?: LogFields) => {
    if (!enabled('warn'))
      return;

    const now = clock.now();
    const entryKey = event + '\u0000' + key;
    const entry = securityEntries.get(entryKey);

    if (entry && now - entry.start < SECURITY_WINDOW) {
      entry.suppressed++;
      return;
    }

    const suppressed = entry ? entry.suppressed : 0;
    securityEntries.delete(entryKey);
    if (securityEntries.size >= MAX_SECURITY_KEYS)
      forgetOldSecurityKeys(now);
    securityEntries.set(entryKey, {start: now, suppressed: 0});

    emit('warn', event, suppressed > 0 ? {...fields, suppressed} : fields);
  };

  return {
    level,
    enabled,
    error: (event, fields) => emit('error', event, fields),
    warn: (event, fields) => emit('warn', event, fields),
    info: (event, fields) => emit('info', event, fields),
    debug: (event, fields) => emit('debug', event, fields),
    security,
  };
}
