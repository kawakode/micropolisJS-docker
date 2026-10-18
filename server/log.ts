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
  // A security event that can be repeated at will (rate_limited, csrf.reject, ws.reject...): logged (as a warning
  // unless another level is given) at most once per event and key per minute. The ones left out are counted, and the
  // count written once that minute is over, on a line of its own: the first line's fields, `suppressed` (how many)
  // and `windowStart` (the first line's time).
  security(event: string, key: string, fields?: LogFields, level?: LogLevel): void;
  // Writes the counts of the security events left out so far (hourly, and at shutdown)
  flush(): void;
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
  event: string;
  level: LogLevel;
  // The first line's fields but its request id: the count is written with them
  fields: LogFields;
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

  // Writes how many lines an entry left out, if any
  const writeSuppressed = (entry: SecurityEntry) => {
    if (entry.suppressed > 0)
      emit(entry.level, entry.event, {...entry.fields, suppressed: entry.suppressed,
                                      windowStart: new Date(entry.start).toISOString()});
    entry.suppressed = 0;
  };

  // Forgets the entries whose minute is over, their counts written. They are kept oldest first (an entry is made
  // when its minute starts), so the loop stops at the first whose minute is not over: each entry is looked at once.
  const forgetEndedMinutes = (now: number) => {
    for (const [key, entry] of securityEntries) {
      if (now - entry.start < SECURITY_WINDOW)
        break;
      writeSuppressed(entry);
      securityEntries.delete(key);
    }
  };

  const security = (event: string, key: string, fields: LogFields = {}, level: LogLevel = 'warn') => {
    if (!enabled(level))
      return;

    const now = clock.now();
    forgetEndedMinutes(now);

    const entryKey = event + '\u0000' + key;
    const entry = securityEntries.get(entryKey);
    if (entry) {
      entry.suppressed++;
      return;
    }

    // Still full: the oldest goes, its count written
    if (securityEntries.size >= MAX_SECURITY_KEYS) {
      const [oldestKey, oldest] = securityEntries.entries().next().value as [string, SecurityEntry];
      writeSuppressed(oldest);
      securityEntries.delete(oldestKey);
    }

    const kept = {...fields};
    delete kept.requestId;
    securityEntries.set(entryKey, {event, level, fields: kept, start: now, suppressed: 0});
    emit(level, event, fields);
  };

  const flush = () => {
    for (const entry of securityEntries.values())
      writeSuppressed(entry);
  };

  return {
    level,
    enabled,
    error: (event, fields) => emit('error', event, fields),
    warn: (event, fields) => emit('warn', event, fields),
    info: (event, fields) => emit('info', event, fields),
    debug: (event, fields) => emit('debug', event, fields),
    security,
    flush,
  };
}
