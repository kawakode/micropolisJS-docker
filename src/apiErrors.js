/* KawaCity, a modified version of micropolisJS. Adapted by Graeme McCutcheon from Micropolis.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

// The errors the server can report, and what the game says about each. The server answers a request that fails with
// {"error": {"code": <code>, "fields": {<field>: <reason>}}} and sends {t: 'error', code} on the live connection to a
// shared city; it ends that connection with {t: 'kicked', reason}, and answers a tool command with
// {t: 'toolResult', reason}. The server takes its codes from the lists below, so that the game has a text for each.
//
// Each table maps a code to its English text, which is also the key of its translations (see I18n): show it with
// I18n.t(ERROR_TEXTS[code]). The texts say no more than the code does: the same failure always reads the same.

// The codes of a failed request or command
var ERROR_TEXTS = {
  invalid_input: 'Something in this form is not right. Please check it and try again.',
  bad_origin: 'This request did not come from the game\'s page. Please reload the page and try again.',
  unsupported_media_type: 'The server did not understand this request. Please reload the page and try again.',
  payload_too_large: 'This is too big to send to the server.',
  not_found: 'Not found. It may have been deleted.',
  method_not_allowed: 'The server cannot do that.',
  unauthenticated: 'Please log in to do that.',
  forbidden: 'You are not allowed to do that.',
  captcha_failed: 'The check that you are not a robot failed. Please try again.',
  captcha_expired: 'The check that you are not a robot expired. Please try again.',
  rate_limited: 'Too many requests at once. Please wait a moment and try again.',
  too_many_attempts: 'Too many failed attempts. Please wait a while before trying again.',
  invalid_credentials: 'Wrong username, email or password.',
  username_taken: 'This username is already taken. Please choose another one.',
  weak_password: 'Please choose a stronger password.',
  invalid_token: 'This link does not work any more: it has expired or was already used.',
  server_busy: 'The server is very busy. Please try again in a moment.',
  conflict: 'This is already done, or can no longer be done.',
  limit_reached: 'You have reached the limit: this cannot be done for now.',
  registration_closed: 'New accounts cannot be created on this server.',
  internal: 'Something went wrong on the server. Please try again later.',

  // Only the game reports these: the server could not be reached, or did not answer in time
  network: 'The server cannot be reached. Please check your connection and try again.',
  timeout: 'The server took too long to answer. Please try again.'
};

// Why a field of a form was refused (with invalid_input or weak_password)
var FIELD_TEXTS = {
  required: 'Please fill this in.',
  invalid: 'This does not look right.',
  too_short: 'This is too short.',
  too_long: 'This is too long.',
  common: 'This password is too common: anyone could guess it.',
  contains_username: 'Your password must not contain your username.',
  contains_email: 'Your password must not contain your email address.',
  too_simple: 'This password is too simple: use more different characters.',
  reserved: 'This name is reserved. Please choose another one.'
};

// Why the server ended the connection to a shared city (after shutdown, the game tries again until the server is
// back, as when the connection drops: see Multiplayer)
var KICK_TEXTS = {
  deleted: 'This city was deleted.',
  removed: 'You are no longer a member of this city.',
  session: 'You were logged out. Please log in again.',
  error: 'Something went wrong with this city on the server. Please try again later.',
  shutdown: 'The server is shutting down. The city was saved: please come back in a moment.'
};

// Why a tool could not be used everywhere it was dragged (the first two as in a city played alone, see Text)
var TOOL_TEXTS = {
  no_money: 'Insufficient funds to build that',
  needs_bulldoze: 'Area must be bulldozed first',
  failed: 'That cannot be built there'
};

// The codes only the game reports
var CLIENT_ERROR_CODES = ['network', 'timeout'];

// The codes the server can send
var ERROR_CODES = Object.keys(ERROR_TEXTS).filter(function(code) {
  return CLIENT_ERROR_CODES.indexOf(code) === -1;
});

var FIELD_REASONS = Object.keys(FIELD_TEXTS);
var KICK_REASONS = Object.keys(KICK_TEXTS);
var TOOL_REASONS = Object.keys(TOOL_TEXTS);


export { CLIENT_ERROR_CODES, ERROR_CODES, ERROR_TEXTS, FIELD_REASONS, FIELD_TEXTS, KICK_REASONS, KICK_TEXTS,
         TOOL_REASONS, TOOL_TEXTS };
