/* KawaCity, a modified version of micropolisJS.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

// SHA-256 (FIPS 180-4), written for the check that a player is not a robot (see Captcha): the server sends a salt and
// the digest of the salt followed by a secret number, and the game finds the number by trying 0, 1, 2... That takes
// up to a few hundred thousand digests, on phones too, so the search allocates nothing per try: the salt is encoded
// once, each try only writes the digits of its number after it, and the first rounds that depend on the salt alone
// are computed once. The digests are compared as 32-bit words.
//
// It runs in the page and in a worker (see captchaWorker.js), and needs nothing but typed arrays.

var K = new Int32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
]);

var INITIAL = new Int32Array([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
]);

// The most digits a number to try can have (Number.MAX_SAFE_INTEGER)
var MAX_DIGITS = 16;


// The message schedule of the block of 16 words at offset in words
var schedule = function(w, words, offset) {
  var i;
  for (i = 0; i < 16; i++)
    w[i] = words[offset + i];

  for (i = 16; i < 64; i++) {
    var x = w[i - 15];
    var y = w[i - 2];
    var s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
    var s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
    w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
  }
};


// The rounds first to last - 1 of a block: s holds the working variables a to h after round first - 1 (the block's
// starting state when first is 0), and receives them after round last - 1
var rounds = function(s, w, first, last) {
  var a = s[0], b = s[1], c = s[2], d = s[3], e = s[4], f = s[5], g = s[6], h = s[7];

  for (var i = first; i < last; i++) {
    var t1 = (h + (((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))) +
              ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
    var t2 = ((((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))) +
              ((a & b) ^ (a & c) ^ (b & c))) | 0;
    h = g;
    g = f;
    f = e;
    e = (d + t1) | 0;
    d = c;
    c = b;
    b = a;
    a = (t1 + t2) | 0;
  }

  s[0] = a; s[1] = b; s[2] = c; s[3] = d; s[4] = e; s[5] = f; s[6] = g; s[7] = h;
};


// Adds a block's result to the hash state
var add = function(state, s) {
  for (var i = 0; i < 8; i++)
    state[i] = (state[i] + s[i]) | 0;
};


// The UTF-8 bytes of a string, as an array of numbers
var utf8 = function(text) {
  var bytes = [];
  text = String(text);

  for (var i = 0; i < text.length; i++) {
    var c = text.charCodeAt(i);
    // A surrogate pair is one character; a lone surrogate becomes U+FFFD, as with TextEncoder
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
      var low = text.charCodeAt(i + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        c = 0x10000 + ((c - 0xd800) << 10) + (low - 0xdc00);
        i++;
      }
    }
    if (c >= 0xd800 && c <= 0xdfff)
      c = 0xfffd;

    if (c < 0x80) {
      bytes.push(c);
    } else if (c < 0x800) {
      bytes.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    } else if (c < 0x10000) {
      bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    } else {
      bytes.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    }
  }

  return bytes;
};


// The number of 32-bit words of a padded message of length bytes
var paddedWords = function(length) {
  return ((length + 9 + 63) >> 6) << 4;
};


// Writes a byte at position p of a message held as big-endian words
var putByte = function(words, p, value) {
  words[p >> 2] |= value << (24 - ((p & 3) << 3));
};


// Writes the padding and the length of a message of length bytes, whose words after it are zero
var pad = function(words, length) {
  var total = paddedWords(length);
  putByte(words, length, 0x80);
  // The length in bits, on 64 bits
  words[total - 2] = Math.floor(length / 0x20000000);
  words[total - 1] = (length * 8) | 0;
};


var hex = function(state) {
  var text = '';
  for (var i = 0; i < 8; i++)
    text += ('0000000' + (state[i] >>> 0).toString(16)).slice(-8);
  return text;
};


// The SHA-256 digest of a string (of its UTF-8 bytes), in lower case hexadecimal
var sha256Hex = function(text) {
  var bytes = utf8(text);
  var words = new Int32Array(paddedWords(bytes.length));
  for (var i = 0; i < bytes.length; i++)
    putByte(words, i, bytes[i]);
  pad(words, bytes.length);

  var state = new Int32Array(INITIAL);
  var s = new Int32Array(8);
  var w = new Int32Array(64);
  for (var offset = 0; offset < words.length; offset += 16) {
    schedule(w, words, offset);
    s.set(state);
    rounds(s, w, 0, 64);
    add(state, s);
  }

  return hex(state);
};


// The 8 words of a digest written in hexadecimal, or null if it is not one
var digestWords = function(digest) {
  if (typeof digest !== 'string' || !/^[0-9a-fA-F]{64}$/.test(digest))
    return null;

  var words = new Int32Array(8);
  for (var i = 0; i < 8; i++)
    words[i] = parseInt(digest.slice(i * 8, i * 8 + 8), 16) | 0;
  return words;
};


// Prepares the search for the number n such that sha256(salt + n) is the given digest (n written in decimal, without
// leading zeros). search(start, end) tries the numbers from start to end - 1, and returns the one found or -1.
var Searcher = function(salt, digest) {
  this._target = digestWords(digest);
  this._prefix = utf8(salt);

  var length = this._prefix.length;
  this._words = new Int32Array(paddedWords(length + MAX_DIGITS));
  this._w = new Int32Array(64);
  this._s = new Int32Array(8);
  this._state = new Int32Array(8);
  this._digits = new Int32Array(MAX_DIGITS);
  this._paddingSchedules = [];

  for (var i = 0; i < length; i++)
    putByte(this._words, i, this._prefix[i]);

  // The blocks made only of the salt are hashed once
  this._firstBlock = length >> 6;
  this._blockState = new Int32Array(INITIAL);
  for (var block = 0; block < this._firstBlock; block++) {
    schedule(this._w, this._words, block << 4);
    this._s.set(this._blockState);
    rounds(this._s, this._w, 0, 64);
    add(this._blockState, this._s);
  }

  // So are the rounds of the next block that only use words of the salt
  this._firstWord = this._firstBlock << 4;
  this._fixedRounds = (length & 63) >> 2;
  this._roundState = new Int32Array(this._blockState);
  schedule(this._w, this._words, this._firstWord);
  rounds(this._roundState, this._w, 0, this._fixedRounds);

  // The salt's last word, if the digits start inside it
  this._tailWord = length >> 2;
  this._tailValue = this._words[this._tailWord];
};


Searcher.prototype.search = function(start, end) {
  if (this._target === null)
    return -1;

  var words = this._words;
  var w = this._w;
  var s = this._s;
  var state = this._state;
  var digits = this._digits;
  var target = this._target;
  var length = this._prefix.length;
  var t0 = target[0];
  var tailWord = this._tailWord;
  var tailValue = this._tailValue;
  var firstWord = this._firstWord;
  var fixedRounds = this._fixedRounds;
  var roundState = this._roundState;
  var blockState = this._blockState;
  var paddingSchedules = this._paddingSchedules;

  start = Math.max(0, Math.ceil(start));
  end = Math.min(end, Math.pow(10, MAX_DIGITS));

  for (var n = start; n < end; n++) {
    // The digits of n, last first
    var count = 0;
    var rest = n;
    do {
      digits[count++] = rest % 10;
      rest = Math.floor(rest / 10);
    } while (rest > 0);

    // The message: the salt, the digits, the padding
    var size = length + count;
    var total = paddedWords(size);
    words[tailWord] = tailValue;
    for (var i = tailWord + 1; i < total; i++)
      words[i] = 0;
    for (var j = 0; j < count; j++)
      putByte(words, length + j, 0x30 + digits[count - 1 - j]);
    pad(words, size);

    // The first block that holds digits starts after its fixed rounds
    schedule(w, words, firstWord);
    s.set(roundState);
    rounds(s, w, fixedRounds, 64);
    state.set(blockState);
    add(state, s);

    for (var offset = firstWord + 16; offset < total; offset += 16) {
      // A last block of padding only has the same schedule for every number of this many digits
      var blockSchedule = w;
      if (offset === total - 16 && size < offset * 4) {
        blockSchedule = paddingSchedules[count];
        if (!blockSchedule) {
          blockSchedule = paddingSchedules[count] = new Int32Array(64);
          schedule(blockSchedule, words, offset);
        }
      } else {
        schedule(w, words, offset);
      }
      s.set(state);
      rounds(s, blockSchedule, 0, 64);
      add(state, s);
    }

    if (state[0] === t0 && state[1] === target[1] && state[2] === target[2] && state[3] === target[3] &&
        state[4] === target[4] && state[5] === target[5] && state[6] === target[6] && state[7] === target[7])
      return n;
  }

  return -1;
};


// Searches once, from start to end - 1 (see Searcher)
var search = function(salt, digest, start, end) {
  return new Searcher(salt, digest).search(start, end);
};


var Sha256 = {
  hex: sha256Hex,
  utf8: utf8,
  Searcher: Searcher,
  search: search
};


export { Sha256 };
