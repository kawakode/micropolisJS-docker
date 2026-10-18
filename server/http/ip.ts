/* KawaCity, a modified version of micropolisJS.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

import { isIPv4, isIPv6 } from 'node:net';

// IP addresses: parsing, CIDR ranges, and the keys rate limits count by. An IPv4 address is counted alone; an IPv6
// address by its /64 prefix (a single customer usually holds a whole /64 or more), with a coarser /48 aggregate.

export interface IpAddress {
  version: 4 | 6;
  bytes: Uint8Array;
}

export interface Cidr {
  version: 4 | 6;
  bytes: Uint8Array;
  prefix: number;
}

// The keys a rate limit counts a client by
export interface RateLimitKeys {
  key: string;
  aggregateKey: string | null;
}

const parseIPv4 = (text: string): Uint8Array => new Uint8Array(text.split('.').map(Number));

// The 16 bytes of a valid IPv6 address (`::`, and an IPv4 address in the last 32 bits, included)
const parseIPv6 = (text: string): Uint8Array => {
  const bytes = new Uint8Array(16);
  let tail = text;
  let ipv4: Uint8Array | null = null;

  const lastColon = tail.lastIndexOf(':');
  if (tail.indexOf('.', lastColon) !== -1) {
    ipv4 = parseIPv4(tail.slice(lastColon + 1));
    tail = tail.slice(0, lastColon + 1) + '0:0';
  }

  const halves = tail.split('::');
  const groupsOf = (part: string) => part === '' ? [] : part.split(':').map(group => parseInt(group, 16));
  const head = groupsOf(halves[0]);
  const rest = halves.length > 1 ? groupsOf(halves[1]) : [];
  const groups = halves.length > 1 ? [...head, ...new Array(8 - head.length - rest.length).fill(0), ...rest] : head;

  groups.forEach((group, i) => {
    bytes[i * 2] = group >> 8;
    bytes[i * 2 + 1] = group & 0xff;
  });

  if (ipv4)
    bytes.set(ipv4, 12);

  return bytes;
};

const isIPv4Mapped = (bytes: Uint8Array): boolean =>
  bytes.slice(0, 10).every(b => b === 0) && bytes[10] === 0xff && bytes[11] === 0xff;

// An address as written by a socket or a proxy, or null. IPv4-mapped IPv6 addresses (::ffff:192.0.2.1) are IPv4
// addresses; an IPv6 zone (%eth0) is dropped.
export function parseIp(text: string | undefined | null): IpAddress | null {
  if (typeof text !== 'string')
    return null;

  if (isIPv4(text))
    return {version: 4, bytes: parseIPv4(text)};

  const unzoned = text.replace(/%.*$/, '');
  if (!isIPv6(unzoned))
    return null;

  const bytes = parseIPv6(unzoned);
  if (isIPv4Mapped(bytes))
    return {version: 4, bytes: bytes.slice(12)};

  return {version: 6, bytes};
}

// The canonical text of an IPv6 address (RFC 5952): lower case, no leading zeros, the longest run of zero groups as ::
const formatIPv6 = (bytes: Uint8Array): string => {
  const groups: number[] = [];
  for (let i = 0; i < 16; i += 2)
    groups.push((bytes[i] << 8) | bytes[i + 1]);

  let bestStart = -1;
  let bestLength = 1;
  for (let i = 0; i < 8;) {
    if (groups[i] !== 0) {
      i++;
      continue;
    }

    let j = i;
    while (j < 8 && groups[j] === 0)
      j++;
    if (j - i > bestLength) {
      bestStart = i;
      bestLength = j - i;
    }
    i = j;
  }

  const hex = groups.map(group => group.toString(16));
  if (bestStart === -1)
    return hex.join(':');

  return hex.slice(0, bestStart).join(':') + '::' + hex.slice(bestStart + bestLength).join(':');
};

export function formatIp(ip: IpAddress): string {
  return ip.version === 4 ? Array.from(ip.bytes).join('.') : formatIPv6(ip.bytes);
}

const maskBytes = (bytes: Uint8Array, prefix: number): Uint8Array => {
  const masked = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    const bits = Math.max(0, Math.min(8, prefix - i * 8));
    masked[i] = bytes[i] & (0xff << (8 - bits));
  }
  return masked;
};

// A range such as 10.0.0.0/8 or fc00::/7; an address alone is a range of one
export function parseCidr(text: string): Cidr | null {
  const slash = text.indexOf('/');
  const address = parseIp(slash === -1 ? text : text.slice(0, slash));
  if (!address)
    return null;

  // ::ffff:10.0.0.0/104 is not accepted: write the IPv4 range
  if (slash !== -1 && address.version === 4 && !isIPv4(text.slice(0, slash)))
    return null;

  const maxPrefix = address.version === 4 ? 32 : 128;
  const prefixText = slash === -1 ? String(maxPrefix) : text.slice(slash + 1);
  if (!/^\d{1,3}$/.test(prefixText))
    return null;

  const prefix = Number(prefixText);
  if (prefix > maxPrefix)
    return null;

  return {version: address.version, bytes: maskBytes(address.bytes, prefix), prefix};
}

export function cidrContains(cidr: Cidr, ip: IpAddress): boolean {
  if (cidr.version !== ip.version)
    return false;

  const masked = maskBytes(ip.bytes, cidr.prefix);
  return masked.every((b, i) => b === cidr.bytes[i]);
}

export function inCidrs(ip: IpAddress, cidrs: readonly Cidr[]): boolean {
  return cidrs.some(cidr => cidrContains(cidr, ip));
}

export function formatCidr(cidr: Cidr): string {
  return formatIp({version: cidr.version, bytes: cidr.bytes}) + '/' + cidr.prefix;
}

export function rateLimitKeys(ip: IpAddress): RateLimitKeys {
  if (ip.version === 4)
    return {key: formatIp(ip), aggregateKey: null};

  return {
    key: formatIp({version: 6, bytes: maskBytes(ip.bytes, 64)}) + '/64',
    aggregateKey: formatIp({version: 6, bytes: maskBytes(ip.bytes, 48)}) + '/48',
  };
}
