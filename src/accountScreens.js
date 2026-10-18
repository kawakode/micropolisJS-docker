/* KawaCity, a modified version of micropolisJS.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

import $ from "jquery";

import { Api } from './api.js';
import { ERROR_TEXTS, FIELD_TEXTS } from './apiErrors.js';
import { Captcha } from './captcha.js';
import { I18n } from './i18n.js';
import { Router } from './router.js';
import { Session } from './session.js';

// The accounts on the title screen, when the game's server offers them (see Session): a strip on the title card
// (#accountStrip: log in, create an account, or the account of the player signed in), and cards that take the title
// card's place, as the scenario picker does: Log in, Create an account, Finish creating your account (the link of
// the registration email), Forgot password?, Choose a new password (the link of that email), Your account, and
// Privacy. Without the server, none of it shows.
//
// The cards are a stack over the title card: Back or Escape returns to the card below, and to the button that
// opened the card. Every text shown comes from I18n, and every value from the server or the player is shown as text.
//
// The forms check what they can before sending (the same rules as the server, which has the last word), show what
// is wrong next to each field, and say when the server is busy with them.

// The names the server refuses for an account (see the server's rules)
var RESERVED_NAMES = ['admin', 'administrator', 'root', 'system', 'kawacity', 'moderator', 'support', 'staff', 'server',
                      'null', 'undefined', 'operator'];

// Usernames: Latin letters (accents too) and the digits 0-9, with _ . - between them
var USERNAME = /^[\p{Script=Latin}0-9](?:[\p{Script=Latin}0-9_.-]*[\p{Script=Latin}0-9])?$/u;

// The letters: an ASCII letter, or one of these, once accents are taken off (the other Latin letters, phonetic ones,
// small capitals..., often look like an ASCII letter: the server refuses them)
var OTHER_LETTERS = Array.from('ßẞæÆœŒøØłŁđĐðÐþÞħĦıŋŊŧŦəƏ');

var isUsernameCharacter = function(c) {
  var base = c.normalize('NFD').replace(/\p{M}/gu, '');
  return /^[A-Za-z0-9_.-]$/.test(base) || OTHER_LETTERS.indexOf(base) !== -1;
};

// What a browser accepts as an email address, roughly: the server checks it exactly
var EMAIL = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;

var EMAIL_MAX = 254;

// The name of the file of an account's data, as the server names it: in ASCII, like the game's other downloads
// (browsers may refuse other letters in a download's name)
var exportFile = function(user) {
  return ('kawacity-' + (user ? user.username : 'account')).replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 40) + '.json';
};

var CARDS = ['loginCard', 'registerCard', 'signupCard', 'forgotCard', 'resetCard', 'accountCard', 'privacyCard'];

var has = function(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
};


// --- The rules of the forms (reasons are keys of FIELD_TEXTS, null when all is well) ---

var length = function(text) {
  return Array.from(text).length;
};


var checkEmail = function(email) {
  email = String(email || '').trim();
  if (!email)
    return 'required';
  if (email.length > EMAIL_MAX || !EMAIL.test(email))
    return 'invalid';
  return null;
};


var checkUsername = function(username, limits) {
  username = String(username || '').normalize('NFKC');
  if (!username)
    return 'required';
  if (length(username) < limits.usernameMin)
    return 'too_short';
  if (length(username) > limits.usernameMax)
    return 'too_long';
  if (!USERNAME.test(username) || !Array.from(username).every(isUsernameCharacter))
    return 'invalid';
  if (RESERVED_NAMES.indexOf(username.toLowerCase()) !== -1)
    return 'reserved';
  return null;
};


// about: {username, email} of the account, to keep them out of its password
var checkPassword = function(password, limits, about) {
  password = String(password || '').normalize('NFC');
  about = about || {};
  if (!password)
    return 'required';
  if (length(password) < limits.passwordMin)
    return 'too_short';
  if (length(password) > limits.passwordMax)
    return 'too_long';

  var lower = password.toLowerCase();
  var username = String(about.username || '').normalize('NFKC').toLowerCase();
  if (length(username) >= 4 && lower.indexOf(username) !== -1)
    return 'contains_username';
  var local = String(about.email || '').split('@')[0].toLowerCase();
  if (length(local) >= 4 && lower.indexOf(local) !== -1)
    return 'contains_email';

  var distinct = {};
  Array.from(password).forEach(function(c) { distinct[c] = true; });
  if (Object.keys(distinct).length < 4)
    return 'too_simple';
  return null;
};


// What the game says about an error from the server (see Api)
var errorText = function(error) {
  var code = error && typeof error.code === 'string' && has(ERROR_TEXTS, error.code) ? error.code : 'internal';
  var text = I18n.t(ERROR_TEXTS[code]);
  var wait = error && error.retryAfter;

  if ((code === 'rate_limited' || code === 'too_many_attempts') && wait > 0) {
    if (wait < 60)
      text += ' ' + I18n.t('You can try again in {seconds} s.', {seconds: wait});
    else if (wait < 2 * 3600)
      text += ' ' + I18n.t('You can try again in {minutes} min.', {minutes: Math.ceil(wait / 60)});
    else
      text += ' ' + I18n.t('You can try again in {hours} h.', {hours: Math.ceil(wait / 3600)});
  }

  return text;
};


// --- The cards ---

// [{id, opener}], the card shown last
var stack = [];
// What each card does when it opens (with the options given to openCard) and closes
var cards = {};
// Handlers of the address's routes (see Router), by name
var routes = {};
// The route of the address at start, until the title screen shows
var pendingRoute = null;
var started = false;
var booted = false;
// Called after the next log in (see openLogin)
var afterLogin = null;
var captchas = {};


var current = function() {
  return stack.length ? stack[stack.length - 1].id : null;
};


var shown = function() {
  return stack.length ? $('#' + current()) : $('#splash');
};


var focusIn = function(element) {
  // (A closed section's fields can look visible: browsers hide them without removing their boxes)
  var field = element.find('input, select, textarea').filter(':visible').not('[tabindex="-1"]').filter(function() {
    return $(this).closest('details:not([open])').length === 0;
  }).first();
  if (field.length)
    field.trigger('focus');
  else
    element.find('.cardTitle').first().trigger('focus');
};


var onKeyDown = function(e) {
  if (e.key === 'Escape' && stack.length) {
    e.preventDefault();
    back();
  }
};


// Shows a card over the title card (or over the card shown): opener gets the focus back when it closes. Nothing
// opens over the other screens of the title (the scenario picker, the new city's form).
var openCard = function(id, opener, options) {
  if (!started || (!stack.length && !$('#splash').is(':visible')))
    return;

  shown().hide();
  stack.push({id: id, opener: opener || document.activeElement});
  if (stack.length === 1)
    $(document).on('keydown.accountCards', onKeyDown);

  var card = $('#' + id);
  if (cards[id] && cards[id].open)
    cards[id].open(options || {});
  card.show().scrollTop(0);
  focusIn(card);
};


var hideTop = function() {
  var top = stack.pop();
  if (cards[top.id] && cards[top.id].close)
    cards[top.id].close();
  $('#' + top.id).hide();
  if (!stack.length)
    $(document).off('keydown.accountCards');
  return top;
};


// Back to the card below (or the title card), and to the button that opened this one
var back = function() {
  if (!stack.length)
    return;

  var top = hideTop();
  var below = shown();
  below.show();
  if (top.opener && $(top.opener).is(':visible'))
    $(top.opener).trigger('focus');
  else if (!stack.length)
    $('#splashPlay').trigger('focus');
  else
    focusIn(below);
};


// Back to the title card
var closeAll = function() {
  var first = stack.length ? stack[0] : null;
  while (stack.length)
    hideTop();

  if (!started)
    return;
  $('#splash').show();
  if (first && first.opener && $(first.opener).is(':visible'))
    $(first.opener).trigger('focus');
  else
    $('#splashPlay').trigger('focus');
};


// --- Forms ---

// Shows a field's error (a text), or clears it (null): the field tells assistive technologies about it
var setFieldError = function(input, text) {
  input = $(input);
  var id = input.attr('id');
  var described = [];
  if (input.attr('data-hint'))
    described.push(input.attr('data-hint'));
  if (text)
    described.push(id + 'Error');

  $('#' + id + 'Error').text(text || '');
  input.attr('aria-invalid', text ? 'true' : null);
  input.attr('aria-describedby', described.length ? described.join(' ') : null);
};


var fieldsOf = function(form) {
  return $(form).find('input').not('.honeypot input');
};


var clearErrors = function(form) {
  fieldsOf(form).each(function(i, input) { setFieldError(input, null); });
  $(form).find('.formError').text('');
};


// Shows the errors of fields, given as [[input, reason], ...] with each reason a key of FIELD_TEXTS, or null when
// the field is right. Focuses the first field in error; returns whether all are right.
var showFieldErrors = function(errors) {
  var first = null;
  errors.forEach(function(entry) {
    setFieldError(entry[0], entry[1] ? I18n.t(FIELD_TEXTS[entry[1]]) : null);
    if (entry[1] && first === null)
      first = entry[0];
  });

  if (first !== null)
    $(first).trigger('focus');
  return first === null;
};


var isBusy = function(form) {
  return $(form).attr('aria-busy') === 'true';
};


// While the server works on a form: the form says so, and cannot be sent again
var setBusy = function(form, busy) {
  form = $(form);
  form.attr('aria-busy', busy ? 'true' : null);
  form.find('.accountSubmit').toggleClass('busy', busy).attr('aria-disabled', busy ? 'true' : null);
};


// Shows a server's error in a form: on the fields it names (fields maps the server's names to the inputs), or for
// the whole form
var showError = function(form, error, fields) {
  form = $(form);
  fields = fields || {};
  var named = Object.keys(error.fields || {}).filter(function(name) { return has(fields, name); });

  if (named.length) {
    showFieldErrors(named.map(function(name) { return [fields[name], error.fields[name]]; }));
    if (error.code !== 'invalid_input' && error.code !== 'weak_password')
      form.find('.formError').text(errorText(error));
    return;
  }

  form.find('.formError').text(errorText(error));
};


// Sends a form whose request needs a captcha's answer; a challenge that expired on the way is replaced once
var withCaptcha = function(captcha, send) {
  return captcha.take().then(send).catch(function(error) {
    if (!error || error.code !== 'captcha_expired')
      throw error;
    return captcha.take().then(send);
  });
};


// Runs a form's request: busy meanwhile, then success(answer) or failure(error). A captcha stopped because its form
// closed meanwhile is not an error.
var run = function(form, request, success, failure) {
  if (isBusy(form))
    return;

  setBusy(form, true);
  request().then(function(answer) {
    setBusy(form, false);
    success(answer);
  }, function(error) {
    setBusy(form, false);
    if (error && error.code === 'cancelled')
      return;
    failure(error || Api.failure('internal'));
  });
};


var captchaStatus = function(id) {
  return function(state, detail) {
    var element = $('#' + id);
    var text = '';
    if (state === 'solving')
      text = I18n.t('Checking that you are not a robot…');
    else if (state === 'ready')
      text = I18n.t('Ready');
    else if (state === 'error' && detail && detail.code !== 'cancelled')
      text = errorText(detail);

    // The same text is not announced again
    if (element.text() !== text)
      element.text(text);
    element.attr('data-state', state);
    if (element[0])
      element[0].style.setProperty('--progress', Math.round((state === 'solving' ? detail || 0 : 1) * 100) + '%');
  };
};


var limits = function() {
  return Session.info().limits;
};


var renderHints = function() {
  var rules = limits();
  $('.usernameHint').text(I18n.t('From {min} to {max} characters: letters, digits, and . _ - between them. The other players see it.',
                                 {min: rules.usernameMin, max: rules.usernameMax}));
  $('.passwordHint').each(function(i, hint) {
    var input = $('#' + $(hint).attr('data-for'));
    $(hint).text(I18n.t('At least {min} characters ({count} so far). A few words make a good password, easy to remember.',
                        {min: rules.passwordMin, count: length(String(input.val() || ''))}));
  });
};


// Passwords are hidden again, and forgotten, when their card closes
var forgetPasswords = function(card) {
  card = $(card);
  card.find('.passwordToggle').attr('aria-pressed', 'false');
  card.find('.passwordField input').attr('type', 'password').val('');
  renderHints();
};


var togglePassword = function(e) {
  var button = $(e.currentTarget);
  var visible = button.attr('aria-pressed') !== 'true';
  button.attr('aria-pressed', visible ? 'true' : 'false');
  $('#' + button.attr('aria-controls')).attr('type', visible ? 'text' : 'password');
};


// --- The strip of the title card ---

var setStatus = function(text) {
  $('#accountStatus').text(text || '');
};


var renderStrip = function() {
  var info = Session.info();
  var strip = $('#accountStrip');

  if (!info.available || !info.features.accounts) {
    strip.hide();
    return;
  }

  var here = Session.isPublicOrigin(window.location.origin);
  var user = info.user;
  $('#accountButtons').toggle(here);
  $('#accountLogin').toggle(here && !user);
  $('#accountRegister').toggle(here && !user && info.features.registration);
  $('#accountOpen').toggle(here && user !== null);
  $('#accountOpenName').text(user ? user.username : '');
  $('#accountAdminOnly').toggle(here && !user && !info.features.registration);

  // The server's cookies only work on its own address: the strip links there
  var elsewhere = $('#accountElsewhere').empty().toggle(!here);
  if (!here) {
    var parts = I18n.t('Accounts and multiplayer are at {url}').split('{url}');
    elsewhere.append(document.createTextNode(parts[0]))
      .append($('<a>').attr('href', info.publicUrl + '/').text(info.publicUrl.replace(/^https?:\/\//, '')))
      .append(document.createTextNode(parts.slice(1).join('')));
  }

  strip.show();
};


// --- Log in ---

// Opens the Log in card. options: note (a text shown at the top), next (called after logging in, instead of going
// back to the title card), opener.
var openLogin = function(options) {
  options = options || {};
  afterLogin = options.next || null;
  openCard('loginCard', options.opener, {note: options.note});
};


var loggedIn = function(user, status) {
  Session.setUser(user);
  Session.postLocale(I18n.getLanguage());

  var next = afterLogin;
  afterLogin = null;
  closeAll();
  setStatus(status);
  if (next)
    next();
};


var submitLogin = function(e) {
  e.preventDefault();
  var form = $('#loginForm');
  if (isBusy(form))
    return;

  clearErrors(form);
  var login = String($('#loginName').val() || '').trim();
  var password = String($('#loginPassword').val() || '');
  if (!showFieldErrors([[$('#loginName'), login ? null : 'required'], [$('#loginPassword'), password ? null : 'required']]))
    return;

  run(form, function() {
    return withCaptcha(captchas.login, function(captcha) {
      return Api.post('/api/auth/login', {login: login, password: password, captcha: captcha});
    });
  }, function(answer) {
    loggedIn(answer.user, I18n.t('Welcome back, {username}!', {username: answer.user.username}));
  }, function(error) {
    captchas.login.renew();
    showError(form, error, {login: $('#loginName'), password: $('#loginPassword')});
  });
};


cards.loginCard = {
  open: function(options) {
    var info = Session.info();
    clearErrors($('#loginForm'));
    $('#loginNote').text(options.note || '');
    $('#loginForgot').toggle(info.features.mail);
    $('#loginRegister').toggle(info.features.registration);
    captchas.login.start();
  },
  close: function() {
    captchas.login.stop();
    forgetPasswords('#loginCard');
  }
};


// --- Create an account ---

var submitRegister = function(e) {
  e.preventDefault();
  var form = $('#registerForm');
  if (isBusy(form))
    return;

  clearErrors(form);
  var email = String($('#registerEmail').val() || '').trim();
  if (!showFieldErrors([[$('#registerEmail'), checkEmail(email)]]))
    return;

  run(form, function() {
    return withCaptcha(captchas.register, function(captcha) {
      return Api.post('/api/auth/register', {email: email, locale: I18n.getLanguage(), captcha: captcha,
                                             website: String($('#registerWebsite').val() || '')});
    });
  }, function() {
    captchas.register.stop();
    form.hide();
    $('#registerDoneText').text(I18n.t('We sent an email to {email}. Open its link within 24 hours to choose your username and password. If it does not arrive, look in your spam folder.',
                                       {email: email}));
    $('#registerDone').show();
    $('#registerDone .button').trigger('focus');
  }, function(error) {
    captchas.register.renew();
    showError(form, error, {email: $('#registerEmail')});
  });
};


cards.registerCard = {
  open: function() {
    clearErrors($('#registerForm'));
    $('#registerForm').show();
    $('#registerDone').hide();
    $('#registerWebsite').val('');
    captchas.register.start();
  },
  close: function() {
    captchas.register.stop();
  }
};


// --- Finish creating an account (#/signup/<token>) ---

var signupToken = null;

var submitSignup = function(e) {
  e.preventDefault();
  var form = $('#signupForm');
  if (isBusy(form))
    return;

  clearErrors(form);
  var username = String($('#signupUsername').val() || '').trim();
  var password = String($('#signupPassword').val() || '');
  if (!showFieldErrors([[$('#signupUsername'), checkUsername(username, limits())],
                        [$('#signupPassword'), checkPassword(password, limits(), {username: username})]]))
    return;

  if (signupToken === null) {
    form.find('.formError').text(errorText(Api.failure('invalid_token')));
    return;
  }

  run(form, function() {
    return Api.post('/api/auth/complete-registration', {token: signupToken, username: username, password: password});
  }, function(answer) {
    signupToken = null;
    loggedIn(answer.user, I18n.t('Welcome, {username}! Your account is ready.', {username: answer.user.username}));
  }, function(error) {
    if (error.code === 'username_taken') {
      setFieldError($('#signupUsername'), errorText(error));
      $('#signupUsername').trigger('focus');
    } else if (error.code === 'weak_password' && !Object.keys(error.fields).length) {
      setFieldError($('#signupPassword'), errorText(error));
      $('#signupPassword').trigger('focus');
    } else {
      showError(form, error, {username: $('#signupUsername'), password: $('#signupPassword')});
    }
  });
};


cards.signupCard = {
  open: function(options) {
    signupToken = options.token || null;
    clearErrors($('#signupForm'));
    renderHints();
    if (signupToken === null)
      $('#signupForm .formError').text(errorText(Api.failure('invalid_token')));
  },
  close: function() {
    forgetPasswords('#signupCard');
  }
};


// --- Forgot password? ---

var submitForgot = function(e) {
  e.preventDefault();
  var form = $('#forgotForm');
  if (isBusy(form))
    return;

  clearErrors(form);
  var email = String($('#forgotEmail').val() || '').trim();
  if (!showFieldErrors([[$('#forgotEmail'), checkEmail(email)]]))
    return;

  run(form, function() {
    return withCaptcha(captchas.forgot, function(captcha) {
      return Api.post('/api/auth/forgot-password', {email: email, captcha: captcha,
                                                    website: String($('#forgotWebsite').val() || '')});
    });
  }, function() {
    // (Unless the player went back meanwhile)
    if (current() === 'forgotCard')
      back();
    $('#loginNote').text(I18n.t('If an account uses {email}, we sent it a link to choose a new password. It works for one hour.',
                                {email: email}));
  }, function(error) {
    captchas.forgot.renew();
    showError(form, error, {email: $('#forgotEmail')});
  });
};


cards.forgotCard = {
  open: function() {
    clearErrors($('#forgotForm'));
    $('#forgotWebsite').val('');
    // The address typed to log in, if it was one
    var login = String($('#loginName').val() || '').trim();
    if (!$('#forgotEmail').val() && checkEmail(login) === null)
      $('#forgotEmail').val(login);
    captchas.forgot.start();
  },
  close: function() {
    captchas.forgot.stop();
  }
};


// --- Choose a new password (#/reset/<token>) ---

var resetToken = null;

var submitReset = function(e) {
  e.preventDefault();
  var form = $('#resetForm');
  if (isBusy(form))
    return;

  clearErrors(form);
  var password = String($('#resetPassword').val() || '');
  if (!showFieldErrors([[$('#resetPassword'), checkPassword(password, limits())]]))
    return;

  if (resetToken === null) {
    form.find('.formError').text(errorText(Api.failure('invalid_token')));
    return;
  }

  run(form, function() {
    return Api.post('/api/auth/reset-password', {token: resetToken, password: password});
  }, function() {
    resetToken = null;
    var opener = stack.length ? stack[0].opener : null;
    closeAll();
    openCard('loginCard', opener, {note: I18n.t('Your password was changed. Log in with your new password.')});
    // Every session of that account ended: this browser's too, if it was logged in to it (and not to another)
    Session.refresh().catch(function() {});
  }, function(error) {
    if (error.code === 'weak_password' && !Object.keys(error.fields).length) {
      setFieldError($('#resetPassword'), errorText(error));
      $('#resetPassword').trigger('focus');
    } else {
      showError(form, error, {password: $('#resetPassword')});
    }
  });
};


cards.resetCard = {
  open: function(options) {
    resetToken = options.token || null;
    clearErrors($('#resetForm'));
    renderHints();
    if (resetToken === null)
      $('#resetForm .formError').text(errorText(Api.failure('invalid_token')));
  },
  close: function() {
    forgetPasswords('#resetCard');
  }
};


// --- A new email address (#/email/<token>) ---

var confirmEmail = function(token) {
  var request = token === null ? Promise.reject(Api.failure('invalid_token')) :
                Api.post('/api/auth/confirm-email-change', {token: token});
  var before = Session.info().user;
  var changed = function() {
    openLogin({note: I18n.t('Your email address was changed. You can log in with it now.')});
  };

  setStatus(I18n.t('Confirming your new email address…'));
  request.then(function() {
    setStatus('');
    if (!before) {
      changed();
      return;
    }

    // The link may be for another account than the one logged in here
    return Session.refresh().then(function(info) {
      if (info.user && info.user.id === before.id && info.user.email !== before.email)
        openCard('accountCard', null, {note: I18n.t('Your email address was changed.')});
      else
        changed();
    }, function() {
      setStatus(I18n.t('Your email address was changed.'));
    });
  }).catch(function(error) {
    setStatus('');
    if (Session.info().user)
      openCard('accountCard', null, {error: errorText(error)});
    else
      openLogin({note: errorText(error)});
  });
};


// --- Your account ---

// The account's session ended (expired, or ended on another device)
var sessionEnded = function() {
  Session.setUser(null);
  closeAll();
  openLogin({note: I18n.t('You are no longer logged in. Please log in again.')});
};


var renderAccount = function() {
  var user = Session.info().user;
  if (!user)
    return;

  $('#accountUsername').text(user.username);
  $('#accountEmail').text(user.email);
  $('#accountLanguage').text(has(I18n.NAMES, user.locale) ? I18n.NAMES[user.locale] : user.locale);
};


// An account form's error: a wrong current password is said so, rather than as for logging in
var accountFormError = function(form, error, passwordInput, fields) {
  if (error.code === 'unauthenticated') {
    sessionEnded();
  } else if (error.code === 'invalid_credentials') {
    setFieldError(passwordInput, I18n.t('Wrong password.'));
    $(passwordInput).trigger('focus');
  } else {
    showError(form, error, fields);
  }
};


var submitPasswordChange = function(e) {
  e.preventDefault();
  var form = $('#passwordForm');
  if (isBusy(form))
    return;

  clearErrors(form);
  var user = Session.info().user || {};
  var currentPassword = String($('#passwordCurrent').val() || '');
  var newPassword = String($('#passwordNew').val() || '');
  if (!showFieldErrors([[$('#passwordCurrent'), currentPassword ? null : 'required'],
                        [$('#passwordNew'), checkPassword(newPassword, limits(), user)]]))
    return;

  run(form, function() {
    return Api.post('/api/account/password', {currentPassword: currentPassword, newPassword: newPassword});
  }, function(answer) {
    if (answer && answer.user)
      Session.setUser(answer.user);
    forgetPasswords(form);
    $('#passwordSection').prop('open', false);
    $('#accountNote').text(I18n.t('Your password was changed. Your other devices were logged out.'));
    $('#passwordSection summary').trigger('focus');
  }, function(error) {
    if (error.code === 'weak_password' && !Object.keys(error.fields).length) {
      setFieldError($('#passwordNew'), errorText(error));
      $('#passwordNew').trigger('focus');
      return;
    }
    accountFormError(form, error, $('#passwordCurrent'),
                     {currentPassword: $('#passwordCurrent'), newPassword: $('#passwordNew'), password: $('#passwordNew')});
  });
};


var submitEmailChange = function(e) {
  e.preventDefault();
  var form = $('#emailForm');
  if (isBusy(form))
    return;

  clearErrors(form);
  var user = Session.info().user || {};
  var newEmail = String($('#emailNew').val() || '').trim();
  var currentPassword = String($('#emailCurrent').val() || '');
  var reason = checkEmail(newEmail);
  if (!showFieldErrors([[$('#emailNew'), reason], [$('#emailCurrent'), currentPassword ? null : 'required']]))
    return;
  if (newEmail.toLowerCase() === String(user.email || '').toLowerCase()) {
    setFieldError($('#emailNew'), I18n.t('This is already your email address.'));
    $('#emailNew').trigger('focus');
    return;
  }

  run(form, function() {
    return Api.post('/api/account/email', {currentPassword: currentPassword, newEmail: newEmail});
  }, function() {
    forgetPasswords(form);
    $('#emailNew').val('');
    $('#emailSection').prop('open', false);
    $('#accountNote').text(I18n.t('We sent a link to {email}. Open it to confirm your new address: until then, your address stays the same.',
                                  {email: newEmail}));
    $('#emailSection summary').trigger('focus');
  }, function(error) {
    accountFormError(form, error, $('#emailCurrent'), {newEmail: $('#emailNew'), currentPassword: $('#emailCurrent')});
  });
};


var loggedOut = function(status) {
  Session.setUser(null);
  closeAll();
  setStatus(status);
};


var submitDelete = function(e) {
  e.preventDefault();
  var form = $('#deleteForm');
  if (isBusy(form))
    return;

  clearErrors(form);
  var password = String($('#deletePassword').val() || '');
  if (!showFieldErrors([[$('#deletePassword'), password ? null : 'required']]))
    return;

  run(form, function() {
    return Api.post('/api/account/delete', {password: password});
  }, function() {
    loggedOut(I18n.t('Your account was deleted.'));
  }, function(error) {
    accountFormError(form, error, $('#deletePassword'), {password: $('#deletePassword')});
  });
};


// The account's buttons outside forms (log out, export...): busy one at a time
var accountAction = function(button, request, success) {
  button = $(button);
  if (button.attr('aria-disabled') === 'true')
    return;

  $('#accountError').text('');
  button.attr('aria-disabled', 'true').addClass('busy');
  $('#accountCard').attr('aria-busy', 'true');
  request().then(function(answer) {
    button.attr('aria-disabled', null).removeClass('busy');
    $('#accountCard').attr('aria-busy', null);
    success(answer);
  }, function(error) {
    button.attr('aria-disabled', null).removeClass('busy');
    $('#accountCard').attr('aria-busy', null);
    if (error.code === 'unauthenticated')
      sessionEnded();
    else
      $('#accountError').text(errorText(error));
  });
};


var exportData = function() {
  accountAction('#accountExport', function() {
    return Api.request('GET', '/api/account/export', null, {blob: true});
  }, function(blob) {
    var file = exportFile(Session.info().user);
    var url = URL.createObjectURL(blob);
    var link = $('<a>').attr({href: url, download: file}).addClass('hidden').appendTo('body');
    link[0].click();
    link.remove();
    setTimeout(function() { URL.revokeObjectURL(url); }, 60000);
    $('#accountNote').text(I18n.t('Your data was saved in the file {file}.', {file: file}));
  });
};


var logOut = function() {
  accountAction('#accountLogout', function() {
    return Api.post('/api/auth/logout', {});
  }, function() {
    loggedOut(I18n.t('You are logged out.'));
  });
};


var logOutEverywhere = function() {
  accountAction('#accountLogoutAll', function() {
    return Api.post('/api/account/logout-all', {});
  }, function() {
    loggedOut(I18n.t('You are logged out on all your devices.'));
  });
};


cards.accountCard = {
  open: function(options) {
    // The session may have ended meanwhile (on another device, or by expiring)
    Session.refresh().then(function(info) {
      if (current() === 'accountCard' && !info.user)
        sessionEnded();
    }, function() {});

    renderAccount();
    // A new address is confirmed by email
    $('#emailSection').toggle(Session.info().features.mail);
    $('#accountNote').text(options.note || '');
    $('#accountError').text(options.error || '');
    $('#accountCard details').prop('open', false);
    ['#passwordForm', '#emailForm', '#deleteForm'].forEach(function(form) { clearErrors($(form)); });
    $('#emailNew').val('');
    renderHints();
  },
  close: function() {
    forgetPasswords('#accountCard');
  }
};


// --- Privacy ---

cards.privacyCard = {
  open: function() {
    var operator = Session.info().operator;
    $('#privacyOperator').text(operator ? I18n.t('The people who run this server can be reached at: {contact}', {contact: operator}) :
                                          I18n.t('The people who run this server have not given a contact.'));
  }
};


// --- Start ---

var openAccountFor = function(route) {
  switch (route.name) {
    case 'signup':
      openCard('signupCard', null, {token: route.token});
      break;
    case 'reset':
      openCard('resetCard', null, {token: route.token});
      break;
    case 'email':
      confirmEmail(route.token);
      break;
    default:
      if (has(routes, route.name))
        routes[route.name](route);
  }
};


var bind = function() {
  CARDS.forEach(function(id) {
    var card = $('#' + id);
    card.on('click', '.accountBack', function(e) {
      e.preventDefault();
      back();
    });
    card.on('click', '.passwordToggle', togglePassword);
    card.on('click', '.privacyLink', function(e) {
      e.preventDefault();
      openCard('privacyCard', e.currentTarget);
    });
  });

  // Each field's place for its error, and the hint it keeps
  $('.accountForm').each(function(i, form) {
    fieldsOf(form).each(function(j, input) {
      input = $(input);
      if (input.attr('aria-describedby'))
        input.attr('data-hint', input.attr('aria-describedby'));
      var after = input.parent('.passwordField').length ? input.parent() : input;
      var hint = input.attr('data-hint') ? $('#' + input.attr('data-hint')) : $();
      $('<p class="fieldError">').attr('id', input.attr('id') + 'Error').insertAfter(hint.length ? hint : after);
    });
  });

  $('.passwordHint').each(function(i, hint) {
    $('#' + $(hint).attr('data-for')).on('input', renderHints);
  });

  $('#accountLogin').on('click', function(e) {
    openLogin({opener: e.currentTarget});
  });
  $('#accountRegister').on('click', function(e) {
    openCard('registerCard', e.currentTarget);
  });
  $('#accountOpen').on('click', function(e) {
    openCard('accountCard', e.currentTarget);
  });
  $('#loginForgot').on('click', function(e) {
    openCard('forgotCard', e.currentTarget);
  });
  $('#loginRegisterButton').on('click', function(e) {
    openCard('registerCard', e.currentTarget);
  });

  $('#loginForm').on('submit', submitLogin);
  $('#registerForm').on('submit', submitRegister);
  $('#signupForm').on('submit', submitSignup);
  $('#forgotForm').on('submit', submitForgot);
  $('#resetForm').on('submit', submitReset);
  $('#passwordForm').on('submit', submitPasswordChange);
  $('#emailForm').on('submit', submitEmailChange);
  $('#deleteForm').on('submit', submitDelete);
  $('#accountExport').on('click', exportData);
  $('#accountLogout').on('click', logOut);
  $('#accountLogoutAll').on('click', logOutEverywhere);

  captchas.login = new Captcha('login', captchaStatus('loginCaptcha'));
  captchas.register = new Captcha('register', captchaStatus('registerCaptcha'));
  captchas.forgot = new Captcha('forgot', captchaStatus('forgotCaptcha'));

  Session.onChange(function() {
    renderStrip();
    if (current() === 'accountCard')
      renderAccount();
  });
  I18n.onChange(function() {
    renderStrip();
    renderHints();
  });
};


// At the page's start: reads the address (its secret tokens are removed at once), and asks the server what it
// offers. Nothing shows until the title screen does (see start).
var boot = function() {
  if (booted)
    return;
  booted = true;

  pendingRoute = Router.take(window.location, window.history);
  bind();
  Session.detect();
};


// The title screen shows: the strip appears once the server answered, and the address's card opens
var start = function() {
  if (!booted)
    boot();
  if (started)
    return;
  started = true;

  Session.detect().then(function(available) {
    if (!started)
      return;

    renderStrip();
    var route = pendingRoute;
    pendingRoute = null;
    if (!available || !Session.info().features.accounts || !Session.isPublicOrigin(window.location.origin) ||
        route === null)
      return;
    openAccountFor(route);
  });
};


// The game starts: the cards close for good
var stop = function() {
  while (stack.length)
    hideTop();
  started = false;
  pendingRoute = null;
};


// For other screens of the title (the multiplayer lobby): a card of their own in the same stack, with open(options)
// and close() called as it opens and closes, and a handler of a route of the address
var addCard = function(id, handlers) {
  cards[id] = handlers || {};
  var card = $('#' + id);
  card.on('click', '.accountBack', function(e) {
    e.preventDefault();
    back();
  });
};


var addRoute = function(name, handler) {
  routes[name] = handler;
};


var AccountScreens = {
  checkEmail: checkEmail,
  checkUsername: checkUsername,
  checkPassword: checkPassword,
  errorText: errorText,
  boot: boot,
  start: start,
  stop: stop,
  openCard: openCard,
  openLogin: openLogin,
  back: back,
  closeAll: closeAll,
  addCard: addCard,
  addRoute: addRoute,
  setStatus: setStatus
};


export { AccountScreens };
