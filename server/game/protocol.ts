/* KawaCity, a modified version of micropolisJS.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

import type { ERROR_TEXTS, KICK_TEXTS } from '../../src/apiErrors.js';
import { Neighbours } from '../../src/neighbours.js';
import { Placements } from '../../src/placements.js';
import { CITY_HEIGHT, CITY_WIDTH, DISASTER_KINDS, DisasterKind, Point } from './headless';
import { CHAT_MAX, checkText } from './names';

// The live protocol of the shared cities (DESIGN §5.4): JSON text frames on the WebSocket at /api/ws, each an object
// whose `t` says what it is. What the game sends is read here into a fresh object of a known shape, or refused
// (null): only the keys of its type, each of its type and in its range.
//
// From the game (`seq`, an optional integer, comes back in the answer to the command):
//   {t: 'join', city}                                            first and once: the city's public id
//   {t: 'tool', seq, tool, from: {x, y}, to: {x, y}}             a tool dragged from one tile to another
//   {t: 'speed', seq, speed: 1|2|3}   {t: 'pause', seq, paused}
//   {t: 'budget', seq, roadPercent, firePercent, policePercent, taxPercent}   integers: 0-100, and the tax 0-20
//   {t: 'settings', seq, autoBudget?, autoBulldoze?, disasters?, level?}
//   {t: 'disaster', seq, kind}   {t: 'deal', seq, side, kind, signed}
//   {t: 'chat', text}   {t: 'cursor', x, y, tool, ax, ay}   {t: 'cursor', x: null}
//
// From the server: see the ServerMessage types below, and room.ts for when each is sent.

// The codes of {t: 'error'} (src/apiErrors.js)
export type ErrorCode = Exclude<keyof typeof ERROR_TEXTS, 'network' | 'timeout'>;

// Why the server ended a connection, in {t: 'kicked'} (src/apiErrors.js)
export type KickReason = keyof typeof KICK_TEXTS;

// The WebSocket close codes the server uses
export const CLOSE = Object.freeze({
  // Kicked: the city was deleted, the player removed from it, or logged out
  normal: 1000,
  // The server stops
  goingAway: 1001,
  // A protocol error: no join in time, a join refused (not_found), too many invalid messages
  policy: 1008,
  // Something went wrong with the city on the server
  internal: 1011,
  // Try again later: the server is busy, too many cities opened, or the connection could not keep up
  tryAgain: 1013,
});

export const SIDES = Neighbours.SIDES as readonly string[];
export const DEAL_KINDS = Neighbours.KINDS as readonly string[];

export interface JoinMessage {
  t: 'join';
  city: string;
}

export interface ToolMessage {
  t: 'tool';
  seq: number | null;
  tool: string;
  from: Point;
  to: Point;
}

export interface SpeedMessage {
  t: 'speed';
  seq: number | null;
  speed: number;
}

export interface PauseMessage {
  t: 'pause';
  seq: number | null;
  paused: boolean;
}

export interface BudgetMessage {
  t: 'budget';
  seq: number | null;
  roadPercent: number;
  firePercent: number;
  policePercent: number;
  taxPercent: number;
}

export interface SettingsMessage {
  t: 'settings';
  seq: number | null;
  autoBudget?: boolean;
  autoBulldoze?: boolean;
  disasters?: boolean;
  level?: number;
}

export interface DisasterMessage {
  t: 'disaster';
  seq: number | null;
  kind: DisasterKind;
}

export interface DealMessage {
  t: 'deal';
  seq: number | null;
  side: string;
  kind: string;
  signed: boolean;
}

export interface ChatMessage {
  t: 'chat';
  seq: number | null;
  // Cleaned: NFC, no control or format characters, trimmed, 1 to 300 code points
  text: string;
}

// Where a player points, with the tool in hand and, while dragging, where the drag started; or nothing (x null)
export interface CursorMessage {
  t: 'cursor';
  x: number | null;
  y: number | null;
  tool: string | null;
  ax: number | null;
  ay: number | null;
}

export type CommandMessage = ToolMessage | SpeedMessage | PauseMessage | BudgetMessage | SettingsMessage |
  DisasterMessage | DealMessage | ChatMessage | CursorMessage;

export type ClientMessage = JoinMessage | CommandMessage;

// The longest a chat line may be before it is cleaned (it is then cut down to CHAT_MAX code points at most)
const CHAT_RAW_MAX = CHAT_MAX * 4;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const isIntegerIn = (value: unknown, min: number, max: number): value is number =>
  Number.isInteger(value) && (value as number) >= min && (value as number) <= max;

const isSeq = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;

// Exactly these keys, the required ones present
const keysAre = (message: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []) =>
  required.every(key => Object.hasOwn(message, key)) &&
  Object.keys(message).every(key => key === 't' || key === 'seq' || required.includes(key) || optional.includes(key));

const tile = (value: unknown): Point | null => {
  if (!isPlainObject(value) || !keysAre(value, ['x', 'y']))
    return null;
  const {x, y} = value;
  return isIntegerIn(x, 0, CITY_WIDTH - 1) && isIntegerIn(y, 0, CITY_HEIGHT - 1) ? {x, y} : null;
};

// The tools a cursor may show: those a player can use, and the query tool
const isCursorTool = (value: unknown): value is string =>
  typeof value === 'string' && (Placements.isApplicable(value) || value === 'query');

function parseMessage(message: Record<string, unknown>): ClientMessage | null {
  const seq = Object.hasOwn(message, 'seq') ? message.seq : null;
  if (seq !== null && !isSeq(seq))
    return null;

  switch (message.t) {
    case 'join':
      if (!keysAre(message, ['city']) || typeof message.city !== 'string' || message.city.length > 64)
        return null;
      return {t: 'join', city: message.city};

    case 'tool': {
      if (!keysAre(message, ['tool', 'from', 'to']) || !Placements.isApplicable(message.tool))
        return null;
      const from = tile(message.from);
      const to = tile(message.to);
      return from && to ? {t: 'tool', seq, tool: message.tool as string, from, to} : null;
    }

    case 'speed':
      return keysAre(message, ['speed']) && isIntegerIn(message.speed, 1, 3) ?
        {t: 'speed', seq, speed: message.speed} : null;

    case 'pause':
      return keysAre(message, ['paused']) && typeof message.paused === 'boolean' ?
        {t: 'pause', seq, paused: message.paused} : null;

    case 'budget': {
      const {roadPercent, firePercent, policePercent, taxPercent} = message;
      if (!keysAre(message, ['roadPercent', 'firePercent', 'policePercent', 'taxPercent']) ||
          !isIntegerIn(roadPercent, 0, 100) || !isIntegerIn(firePercent, 0, 100) ||
          !isIntegerIn(policePercent, 0, 100) || !isIntegerIn(taxPercent, 0, 20))
        return null;
      return {t: 'budget', seq, roadPercent, firePercent, policePercent, taxPercent};
    }

    case 'settings': {
      if (!keysAre(message, [], ['autoBudget', 'autoBulldoze', 'disasters', 'level']))
        return null;
      const settings: SettingsMessage = {t: 'settings', seq};
      for (const key of ['autoBudget', 'autoBulldoze', 'disasters'] as const) {
        if (!Object.hasOwn(message, key))
          continue;
        const value = message[key];
        if (typeof value !== 'boolean')
          return null;
        settings[key] = value;
      }
      if (Object.hasOwn(message, 'level')) {
        if (!isIntegerIn(message.level, 0, 2))
          return null;
        settings.level = message.level;
      }
      return settings;
    }

    case 'disaster':
      return keysAre(message, ['kind']) && DISASTER_KINDS.includes(message.kind as DisasterKind) ?
        {t: 'disaster', seq, kind: message.kind as DisasterKind} : null;

    case 'deal':
      return keysAre(message, ['side', 'kind', 'signed']) && SIDES.includes(message.side as string) &&
             DEAL_KINDS.includes(message.kind as string) && typeof message.signed === 'boolean' ?
        {t: 'deal', seq, side: message.side as string, kind: message.kind as string, signed: message.signed} : null;

    case 'chat': {
      if (!keysAre(message, ['text']) || typeof message.text !== 'string' || message.text.length > CHAT_RAW_MAX)
        return null;
      const text = checkText(message.text, CHAT_MAX);
      return text.ok ? {t: 'chat', seq, text: text.text} : null;
    }

    case 'cursor': {
      if (message.x === null)
        return keysAre(message, ['x']) ? {t: 'cursor', x: null, y: null, tool: null, ax: null, ay: null} : null;

      if (!keysAre(message, ['x', 'y'], ['tool', 'ax', 'ay']))
        return null;
      const at = tile({x: message.x, y: message.y});
      const tool = message.tool ?? null;
      if (at === null || (tool !== null && !isCursorTool(tool)))
        return null;

      const ax = message.ax ?? null;
      const ay = message.ay ?? null;
      if ((ax === null) !== (ay === null))
        return null;
      if (ax !== null && tile({x: ax, y: ay}) === null)
        return null;
      return {t: 'cursor', x: at.x, y: at.y, tool, ax: ax as number | null, ay: ay as number | null};
    }

    default:
      return null;
  }
}

// The seq of a message that is not valid, if it has one, to answer it
export function seqOf(text: string): number | null {
  try {
    const message = JSON.parse(text) as unknown;
    return isPlainObject(message) && isSeq(message.seq) ? message.seq : null;
  } catch (e) {
    return null;
  }
}

// A message from the game, read; null when it is not one
export function parseClientMessage(text: string): ClientMessage | null {
  let message: unknown;
  try {
    message = JSON.parse(text);
  } catch (e) {
    return null;
  }

  return isPlainObject(message) && typeof message.t === 'string' ? parseMessage(message) : null;
}

// What the server sends (see room.ts)

export interface PlayerEntry {
  id: string;
  username: string;
  role: string;
  colour: string;
  online: boolean;
}

export interface ChatEntry {
  from: {id: string; username: string; colour: string};
  text: string;
  at: number;
}

// [user's public id, x, y, tool, anchor x, anchor y]
export type CursorEntry = [string, number, number, string | null, number | null, number | null];
