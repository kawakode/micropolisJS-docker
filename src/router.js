/* KawaCity, a modified version of micropolisJS.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

// The screens the page's address can open, after the #:
// - #/signup/<token>: finish creating an account (the link of the email sent at registration)
// - #/reset/<token>: choose a new password (the link of the email sent by "Forgot password?")
// - #/email/<token>: confirm a new email address (the link of the email sent to that address)
// - #/lobby: the multiplayer lobby (where the game comes back to after a shared city)
// - #scenario=<id>: play a scenario again (see SplashScreen)
//
// The links' tokens are secrets: once read, they are removed from the address and from the browser's history.

// A token in a link: base64url
var TOKEN = /^[A-Za-z0-9_-]{16,256}$/;

var TOKEN_ROUTES = ['signup', 'reset', 'email'];


// The route of an address's fragment: {name, token} for the token links (token is null when it is damaged),
// {name: 'lobby'}, {name: 'scenario', id}, or null
var parse = function(hash) {
  hash = typeof hash === 'string' ? hash : '';

  var link = /^#\/(signup|reset|email)\/(.*)$/.exec(hash);
  if (link)
    return {name: link[1], token: TOKEN.test(link[2]) ? link[2] : null};

  if (/^#\/lobby\/?$/.test(hash))
    return {name: 'lobby'};

  var scenario = /^#scenario=([a-z]+)$/.exec(hash);
  if (scenario)
    return {name: 'scenario', id: scenario[1]};

  return null;
};


var hasToken = function(route) {
  return route !== null && TOKEN_ROUTES.indexOf(route.name) !== -1;
};


// Reads the route of the page's address, and removes a token from it (and from the history)
var take = function(location, history) {
  var route = parse(location.hash);

  if (hasToken(route) && history && typeof history.replaceState === 'function')
    history.replaceState(null, '', location.pathname + location.search);

  return route;
};


var Router = {
  parse: parse,
  take: take,
  hasToken: hasToken
};


export { Router };
