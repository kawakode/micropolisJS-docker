/* KawaCity, a modified version of micropolisJS. Adapted by Graeme McCutcheon from Micropolis.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

import $ from "jquery";

import { AccountScreens } from './accountScreens.js';
import { Api } from './api.js';
import { FIELD_TEXTS } from './apiErrors.js';
import { I18n } from './i18n.js';
import { LobbyData } from './lobbyData.js';
import { Multiplayer } from './multiplayer.js';
import { PlayersPanel } from './playersPanel.js';
import { Session } from './session.js';
import { SplashScreen } from './splashScreen.js';

// The multiplayer lobby, on the title screen (#/lobby, or the Multiplayer button of the account strip): the
// invitations the player received, their shared cities (to play or to manage) and their regions. It is made of cards
// of the account screens' stack (see AccountScreens): the lobby, a city's card and a region's card, each over the one
// that opened it; Back or Escape goes back. Everything the server sends is checked first (see LobbyData) and put in
// the page as text, the names in <bdi> so that a name written right to left does not reorder the sentence around it.
//
// A new shared city is made on the title screen (see SplashScreen.share): New shared city (or Build here, on a free
// place of a region) brings the title screen back with a banner; the player chooses a map, a sample city or a city
// file, then a name and a difficulty, as for a city played alone, and the city is sent to the server, then played.
//
// The address stays #/lobby while the lobby is open and while a shared city is played from it: loading the page again
// (as the game does to leave a shared city, see Multiplayer.backToLobby) comes back here.

var LOBBY_HASH = '#/lobby';

// A new city's save can be large: its upload has more time than other requests
var UPLOAD_TIMEOUT = 60000;

// A change of role is sent once the player stopped changing it (the keyboard changes a list's choice at each arrow)
var ROLE_DELAY = 600;

var forms = AccountScreens.forms;

// The lobby, as last received (see LobbyData.lobby), and the city and region shown in their cards
var lobby = null;
var cityId = null;
var city = null;
var regionId = null;
var region = null;

// Each card's answer on the way: an older one is dropped when it arrives
var generations = {lobby: 0, city: 0, region: 0};

// While the cards close because the player leaves the lobby (to play a city or to make one): the address stays, and
// the cards below are not loaded again
var leaving = false;

// The shared city being made on the title screen ({slot: the place in a region, or null}), or null
var creating = null;

var NAME_KEYS = ['name', 'city', 'region', 'file'];


// --- Helpers ---

var errorText = function(error) {
  return AccountScreens.errorText(error);
};


// Puts a translated sentence in element, after what it holds: template is the translated text, with {key} where each
// value goes; the names go in a <bdi> each
var sentence = function(element, template, values) {
  PlayersPanel.parts(template, values).forEach(function(part) {
    if (part.text !== undefined)
      element.append(document.createTextNode(part.text));
    else if (NAME_KEYS.indexOf(part.key) !== -1)
      element.append($('<bdi>').text(part.value));
    else
      element.append(document.createTextNode(String(part.value)));
  });

  return element;
};


// A note of a card (its role is status): a text, or a sentence (template and values) with names in it
var setNote = function(selector, template, values) {
  var note = $(selector).empty();
  if (template)
    sentence(note, template, values || {});
};


// A button made for a list: key names it the same each time the list is made again (see keepFocus)
var button = function(label, kind, describedBy, key) {
  var element = $('<button type="button" class="button small">').text(label);
  if (kind)
    element.addClass(kind);
  if (describedBy)
    element.attr('aria-describedby', describedBy);
  if (key)
    element.attr('data-key', key);
  return element;
};


// Makes a card's lists again (render) without losing the focus: it goes back to the control of the same key, or to
// the card's title when that control is gone
var keepFocus = function(card, title, render) {
  var focusedNow = document.activeElement;
  var inside = focusedNow !== null && $(card)[0].contains(focusedNow) && focusedNow !== $(title)[0];
  var key = inside ? $(focusedNow).attr('data-key') || null : null;

  render();

  if (!inside || $(card)[0].contains(document.activeElement))
    return;
  var again = key === null ? $() : $(card).find('[data-key]').filter(function() {
    return $(this).attr('data-key') === key;
  }).filter(':visible').first();
  if (again.length)
    again.trigger('focus');
  else
    $(title).trigger('focus');
};


var myId = function() {
  var user = Session.info().user;
  return user ? user.id : null;
};


// The address names the lobby, or not (without a new entry in the browser's history)
var setAddress = function(inLobby) {
  if (!window.history || typeof(window.history.replaceState) !== 'function')
    return;

  var here = window.location.hash === LOBBY_HASH || window.location.hash === LOBBY_HASH + '/';
  if (inLobby && !here)
    window.history.replaceState(null, '', window.location.pathname + window.location.search + LOBBY_HASH);
  else if (!inLobby && here)
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
};


// The player's session ended (on another device, or by expiring): log in again, then back to the lobby
var sessionEnded = function() {
  Session.setUser(null);
  AccountScreens.closeAll();
  AccountScreens.openLogin({note: I18n.t('You are no longer logged in. Please log in again.'),
                            next: function() { openLobby(null); }});
};


// A request failed: errorAt (an element with the role alert) says why
var failed = function(error, errorAt) {
  if (error && error.code === 'unauthenticated') {
    sessionEnded();
    return;
  }

  $(errorAt).text(errorText(error || Api.failure('internal')));
};


// A button's request (one at a time): the button and its card are busy meanwhile, then success(answer), or the error
// in errorAt
var act = function(element, card, request, success, errorAt) {
  element = $(element);
  if (element.attr('aria-disabled') === 'true')
    return;

  var done = function() {
    element.attr('aria-disabled', null).removeClass('busy');
    $(card).attr('aria-busy', null);
  };

  $(errorAt).text('');
  element.attr('aria-disabled', 'true').addClass('busy');
  $(card).attr('aria-busy', 'true');
  request().then(function(answer) {
    done();
    success(answer);
  }, function(error) {
    done();
    failed(error, errorAt);
  });
};


// Asks before doing what cannot be undone: the buttons of container give way to the question and two buttons, yes
// (which runs action(yes button)) and no (which puts the buttons back)
var confirmIn = function(container, question, yesLabel, action) {
  container = $(container);
  var saved = container.children().detach();
  var id = 'lobbyConfirm' + (++confirmCount);
  var box = $('<div class="lobbyConfirm" role="group">').attr('aria-labelledby', id);
  var text = $('<p class="lobbyConfirmText">').attr('id', id);
  if (typeof(question) === 'string')
    text.text(question);
  else
    text.append(question);

  var restore = function() {
    box.remove();
    container.append(saved);
    saved.filter('button').first().trigger('focus');
  };
  var yes = button(yesLabel, 'danger').on('click', function() { action(yes, restore); });
  var no = button(I18n.t('Cancel'), 'cancel').on('click', restore);

  box.append(text).append($('<div class="lobbyConfirmButtons">').append(no).append(yes));
  container.append(box);
  no.trigger('focus');
};

var confirmCount = 0;


// Saves a file the server sent (a copy of a city)
var saveFile = function(blob, file) {
  var url = URL.createObjectURL(blob);
  var link = $('<a>').attr({href: url, download: file}).addClass('hidden').appendTo('body');
  link[0].click();
  link.remove();
  setTimeout(function() { URL.revokeObjectURL(url); }, 60000);
};


// Focus goes somewhere sensible after a list was made again: its first button, or the card's title
var focusList = function(list, title) {
  var first = $(list).find('button').first();
  if (first.length)
    first.trigger('focus');
  else
    $(title).trigger('focus');
};


// --- Playing a city ---

var play = function(id) {
  setAddress(true);
  leaving = true;
  var started = Multiplayer.play(id);
  leaving = false;
  return started;
};


// --- The lobby ---

// Opens the lobby (after logging in, if the player is not): opener gets the focus back when it closes
var openLobby = function(opener, options) {
  var info = Session.info();
  if (!info.available || !info.features.multiplayer)
    return;

  if (!info.user) {
    AccountScreens.openLogin({opener: opener, note: I18n.t('Log in to play with others.'),
                              next: function() { openLobby(opener, options); }});
    return;
  }

  AccountScreens.openCard('lobbyCard', opener, options);
};


var loadLobby = function() {
  var generation = ++generations.lobby;
  $('#lobbyCard').attr('aria-busy', 'true');
  $('#lobbyStatus').text(I18n.t('Loading…'));

  return Promise.all([Api.get('/api/cities'), Api.get('/api/regions')]).then(function(answers) {
    if (generation !== generations.lobby)
      return;

    $('#lobbyCard').attr('aria-busy', null);
    $('#lobbyStatus').text('');
    lobby = LobbyData.lobby(answers[0], answers[1]);
    keepFocus('#lobbyCard', '#lobbyTitle', renderLobby);
  }, function(error) {
    if (generation !== generations.lobby)
      return;

    $('#lobbyCard').attr('aria-busy', null);
    $('#lobbyStatus').text('');
    failed(error, '#lobbyError');
  });
};


// The facts of a city of the list: its role, owner, population, year, players online and region
var cityFacts = function(entry) {
  var facts = [document.createTextNode(I18n.t('Your role: {role}', {role: PlayersPanel.roleText(entry.role)}))];
  if (entry.role !== 'owner')
    facts.push(sentence($('<span>'), I18n.t('Owner: {name}'), {name: entry.ownerName}));
  facts.push(document.createTextNode(I18n.t('Population: {population}',
                                            {population: I18n.formatNumber(entry.population)})));
  if (entry.year !== null)
    facts.push(document.createTextNode(I18n.t('Year: {year}', {year: entry.year})));
  if (entry.online === 1)
    facts.push(document.createTextNode(I18n.t('1 player online')));
  else if (entry.online > 1)
    facts.push(document.createTextNode(I18n.t('{count} players online', {count: entry.online})));
  if (entry.region !== null)
    facts.push(sentence($('<span>'), I18n.t('Region: {region}'), {region: entry.region.name}));
  return facts;
};


var factsLine = function(facts) {
  var line = $('<p class="lobbyItemFacts">');
  facts.forEach(function(fact) {
    line.append($('<span class="lobbyFact">').append(fact));
  });
  return line;
};


var renderInvitations = function() {
  var list = $('#lobbyInvitations').empty();
  $('#lobbyInvitationsSection').toggle(lobby.invitations.length > 0);

  LobbyData.invitationGroups(lobby.invitations).forEach(function(group) {
    group.invitations.forEach(function(invitation) {
      var id = 'invitation-' + invitation.id;
      var item = $('<li class="lobbyItem invitationItem">');
      var text = $('<p class="lobbyItemText">').attr('id', id).appendTo(item);
      var values = {name: invitation.inviterName, city: invitation.target.name, region: invitation.target.name};
      if (invitation.kind === 'region')
        sentence(text, I18n.t('{name} invites you to the region {region}.'), values);
      else if (invitation.role === 'player')
        sentence(text, I18n.t('{name} invites you to play the city {city} with them.'), values);
      else
        sentence(text, I18n.t('{name} invites you to watch the city {city}.'), values);

      var buttons = $('<div class="lobbyItemButtons">').appendTo(item);
      button(I18n.t('Accept'), 'primary', id, 'accept-' + invitation.id).on('click', function(e) {
        answerInvitation(e.currentTarget, invitation, true);
      }).appendTo(buttons);
      button(I18n.t('Decline'), '', id, 'decline-' + invitation.id).on('click', function(e) {
        answerInvitation(e.currentTarget, invitation, false);
      }).appendTo(buttons);
      list.append(item);
    });

    // Many invitations from the same player: all of them can be declined at once
    if (group.invitations.length > 1 && group.inviterId !== null) {
      var all = $('<button type="button" class="linkButton">').attr('data-key', 'declineAll-' + group.inviterId);
      sentence(all, I18n.t('Decline all the invitations from {name}'), {name: group.inviterName});
      all.on('click', function(e) { declineAll(e.currentTarget, group); });
      list.append($('<li class="lobbyItem declineAll">').append(all));
    }
  });
};


var answerInvitation = function(element, invitation, accept) {
  act(element, '#lobbyCard', function() {
    return Api.post('/api/invitations/' + encodeURIComponent(invitation.id) + (accept ? '/accept' : '/decline'), {});
  }, function() {
    if (!accept)
      setNote('#lobbyNote', I18n.t('Invitation declined.'));
    else if (invitation.kind === 'region')
      setNote('#lobbyNote', I18n.t('You joined the region {region}.'), {region: invitation.target.name});
    else
      setNote('#lobbyNote', I18n.t('You joined the city {city}.'), {city: invitation.target.name});
    loadLobby().then(function() { focusList('#lobbyInvitations', '#lobbyTitle'); });
  }, '#lobbyError');
};


var declineAll = function(element, group) {
  act(element, '#lobbyCard', function() {
    return Api.post('/api/invitations/decline-all', {from: group.inviterId});
  }, function() {
    setNote('#lobbyNote', I18n.t('You declined all the invitations from {name}.'), {name: group.inviterName});
    loadLobby().then(function() { focusList('#lobbyInvitations', '#lobbyTitle'); });
  }, '#lobbyError');
};


var renderCities = function() {
  var list = $('#lobbyCities').empty();
  $('#lobbyNoCity').toggle(lobby.cities.length === 0);

  lobby.cities.forEach(function(entry, i) {
    var nameId = 'lobbyCity' + i;
    var item = $('<li class="lobbyItem">');
    var main = $('<div class="lobbyItemMain">').appendTo(item);
    $('<bdi class="lobbyItemName">').attr('id', nameId).text(entry.name).appendTo(main);
    main.append(factsLine(cityFacts(entry)));

    var buttons = $('<div class="lobbyItemButtons">').appendTo(item);
    button(I18n.t('Play'), 'primary', nameId, 'play-' + entry.id).on('click', function() {
      play(entry.id);
    }).appendTo(buttons);
    button(I18n.t('Manage'), '', nameId, 'manage-' + entry.id).on('click', function(e) {
      AccountScreens.openCard('cityCard', e.currentTarget, {id: entry.id, name: entry.name});
    }).appendTo(buttons);
    list.append(item);
  });
};


var regionFacts = function(entry) {
  var facts = [];
  if (entry.mine)
    facts.push(document.createTextNode(I18n.t('Your region')));
  else
    facts.push(sentence($('<span>'), I18n.t('Owner: {name}'), {name: entry.ownerName}));
  facts.push(document.createTextNode(I18n.t('{columns} × {rows} places', {columns: entry.width, rows: entry.height})));
  if (entry.cities === 0)
    facts.push(document.createTextNode(I18n.t('No city yet')));
  else if (entry.cities === 1)
    facts.push(document.createTextNode(I18n.t('1 city')));
  else
    facts.push(document.createTextNode(I18n.t('{count} cities', {count: entry.cities})));
  return facts;
};


var renderRegions = function() {
  var list = $('#lobbyRegions').empty();
  $('#lobbyNoRegion').toggle(lobby.regions.length === 0);

  lobby.regions.forEach(function(entry, i) {
    var nameId = 'lobbyRegion' + i;
    var item = $('<li class="lobbyItem">');
    var main = $('<div class="lobbyItemMain">').appendTo(item);
    $('<bdi class="lobbyItemName">').attr('id', nameId).text(entry.name).appendTo(main);
    main.append(factsLine(regionFacts(entry)));

    var buttons = $('<div class="lobbyItemButtons">').appendTo(item);
    button(I18n.t('Open'), 'primary', nameId, 'open-' + entry.id).on('click', function(e) {
      AccountScreens.openCard('regionCard', e.currentTarget, {id: entry.id, name: entry.name});
    }).appendTo(buttons);
    list.append(item);
  });
};


var renderLobby = function() {
  renderInvitations();
  renderCities();
  renderRegions();
};


var submitRegion = function(e) {
  e.preventDefault();
  var form = $('#regionCreateForm');
  if (forms.isBusy(form))
    return;

  forms.clearErrors(form);
  var name = LobbyData.checkName($('#regionCreateName').val(), LobbyData.REGION_NAME_MAX);
  if (!forms.showFieldErrors([[$('#regionCreateName'), name.reason]]))
    return;

  var width = parseInt($('#regionCreateWidth').val(), 10);
  var height = parseInt($('#regionCreateHeight').val(), 10);
  forms.run(form, function() {
    return Api.post('/api/regions', {name: name.text, width: width, height: height}, {status: 201});
  }, function(answer) {
    var created = LobbyData.region(answer && answer.region);
    $('#regionCreateName').val('');
    $('#regionCreateSection').prop('open', false);
    loadLobby();
    if (created !== null)
      AccountScreens.openCard('regionCard', $('#regionCreateSection summary')[0], {id: created.id, name: created.name});
  }, function(error) {
    if (error.code === 'unauthenticated')
      sessionEnded();
    else
      forms.showError(form, error, {name: $('#regionCreateName')});
  });
};


var lobbyCard = {
  open: function(options) {
    setAddress(true);
    lobby = {cities: [], invitations: [], regions: []};
    $('#lobbyInvitations, #lobbyCities, #lobbyRegions').empty();
    $('#lobbyInvitationsSection, #lobbyNoCity, #lobbyNoRegion').hide();
    setNote('#lobbyNote', options.note || '', options.values);
    $('#lobbyError').text('');
    $('#regionCreateSection').prop('open', false);
    forms.clearErrors($('#regionCreateForm'));
    $('#regionCreateName').val('');
    loadLobby();
  },
  close: function() {
    generations.lobby++;
    $('#lobbyCard').attr('aria-busy', null);
    if (!leaving)
      setAddress(false);
  }
};


// The lobby is loaded again once a card over it closed (what it shows may have changed meanwhile). When all the cards
// close, the lobby closes next: its answer is then dropped.
var reloadBelow = function() {
  if (!leaving && AccountScreens.isOpen('lobbyCard'))
    loadLobby();
};


// Back to the lobby, which says what happened
var backToLobby = function(template, values) {
  AccountScreens.back();
  setNote('#lobbyNote', template, values);
};


// --- A city's card ---

var loadCity = function() {
  var generation = ++generations.city;
  $('#cityCard').attr('aria-busy', 'true');
  $('#cityStatus').text(I18n.t('Loading…'));

  return Api.get('/api/cities/' + encodeURIComponent(cityId)).then(function(answer) {
    if (generation !== generations.city)
      return;

    $('#cityCard').attr('aria-busy', null);
    $('#cityStatus').text('');
    var detail = LobbyData.cityDetail(answer);
    if (detail === null) {
      failed(Api.failure('internal'), '#cityError');
      return;
    }
    city = detail;
    keepFocus('#cityCard', '#cityTitle', renderCity);
  }, function(error) {
    if (generation !== generations.city)
      return;

    $('#cityCard').attr('aria-busy', null);
    $('#cityStatus').text('');
    if (error.code === 'not_found') {
      backToLobby(errorText(error));
      return;
    }
    failed(error, '#cityError');
  });
};


var renderCityMembers = function() {
  var list = $('#cityMembers').empty();
  var owner = city.city.role === 'owner';
  var me = myId();

  city.members.forEach(function(member, i) {
    var nameId = 'cityMember' + i;
    var item = $('<li class="memberItem">').attr('data-status', member.online ? 'online' : 'offline');
    item.append($('<span class="statusDot" aria-hidden="true"></span>'));
    var name = $('<span class="memberName">').attr('id', nameId).append($('<bdi>').text(member.username));
    if (member.id === me)
      name.append(document.createTextNode(' ' + I18n.t('(you)')));
    item.append(name);
    item.append($('<span class="memberState">').text(member.online ? I18n.t('online') : I18n.t('offline')));

    var controls = $('<span class="memberControls">').appendTo(item);
    if (owner && member.role !== 'owner') {
      var select = $('<select class="memberRole">').attr('aria-label', I18n.t('Role of {name}', {name: member.username}))
        .attr('data-key', 'role-' + member.id);
      LobbyData.INVITED_ROLES.forEach(function(role) {
        $('<option>').val(role).text(PlayersPanel.roleText(role)).prop('selected', role === member.role).appendTo(select);
      });
      select.on('change', function() { roleChanged(member, select); });
      controls.append(select);
      button(I18n.t('Remove'), '', nameId, 'remove-' + member.id).on('click', function() {
        confirmIn(controls, sentence($('<span>'), I18n.t('Remove {name} from the city?'), {name: member.username}),
                  I18n.t('Remove'), function(yes) { removeMember(yes, member); });
      }).appendTo(controls);
    } else {
      controls.append($('<span class="memberRoleText">').text(PlayersPanel.roleText(member.role)));
    }

    list.append(item);
  });
};


// A member's new role is sent once the player stopped changing it
var roleTimers = {};

var roleChanged = function(member, select) {
  clearTimeout(roleTimers[member.id]);
  roleTimers[member.id] = setTimeout(function() {
    delete roleTimers[member.id];
    var role = select.val();
    if (role === member.role || LobbyData.INVITED_ROLES.indexOf(role) === -1)
      return;

    $('#cityError').text('');
    select.prop('disabled', true);
    var id = cityId;
    Api.post('/api/cities/' + encodeURIComponent(id) + '/members/' + encodeURIComponent(member.id),
             {role: role}).then(function() {
      select.prop('disabled', false);
      member.role = role;
      if (id === cityId)
        setNote('#cityNote', I18n.t('The role of {name} is now: {role}.'), {name: member.username, role: PlayersPanel.roleText(role)});
      // Changed again meanwhile
      if (select.val() !== role)
        roleChanged(member, select);
    }, function(error) {
      select.prop('disabled', false);
      select.val(member.role);
      failed(error, '#cityError');
    });
  }, ROLE_DELAY);
};


var removeMember = function(element, member) {
  act(element, '#cityCard', function() {
    return Api.post('/api/cities/' + encodeURIComponent(cityId) + '/members/' + encodeURIComponent(member.id) +
                    '/remove', {});
  }, function() {
    setNote('#cityNote', I18n.t('{name} is no longer a member of this city.'), {name: member.username});
    loadCity().then(function() { focusList('#cityMembers', '#cityTitle'); });
  }, '#cityError');
};


// The invitations sent by the owner of a city or a region, not answered yet: card, note and errorAt are the
// selectors of the card's parts; reload loads the card again
var renderSentInvitations = function(list, invitations, card, note, errorAt, reload) {
  list = $(list).empty();
  (invitations || []).forEach(function(invitation, i) {
    var nameId = list.attr('id') + i;
    var item = $('<li class="memberItem">');
    item.append($('<span class="memberName">').attr('id', nameId).append($('<bdi>').text(invitation.username)));
    if (invitation.role !== null)
      item.append($('<span class="memberRoleText">').text(PlayersPanel.roleText(invitation.role)));
    var controls = $('<span class="memberControls">').appendTo(item);
    button(I18n.t('Cancel the invitation'), '', nameId, 'cancel-' + invitation.id).on('click', function(e) {
      act(e.currentTarget, card, function() {
        return Api.post('/api/invitations/' + encodeURIComponent(invitation.id) + '/cancel', {});
      }, function() {
        setNote(note, I18n.t('The invitation of {name} was cancelled.'), {name: invitation.username});
        reload();
      }, errorAt);
    }).appendTo(controls);
    list.append(item);
  });
};


var renderCity = function() {
  var detail = city.city;
  var owner = detail.role === 'owner';

  $('#cityName').text(detail.name);
  $('#cityOwner').text(detail.ownerName);
  $('#cityRole').text(PlayersPanel.roleText(detail.role));
  $('#cityPopulation').text(I18n.formatNumber(detail.population));
  $('#cityYear').text(detail.year === null ? '' : String(detail.year));
  var place = $('#cityRegion').empty();
  if (detail.region === null)
    place.text(I18n.t('None'));
  else
    sentence(place, I18n.t('{region}, row {row}, column {column}'),
             {region: detail.region.name, row: detail.region.y + 1, column: detail.region.x + 1});

  $('#cityInviteSection, #cityRenameSection, #cityDeleteSection').toggle(owner);
  $('#cityLeaveSection').toggle(!owner);
  $('#cityInvitationsSection').toggle(owner && city.invitations !== null && city.invitations.length > 0);
  if (!$('#cityRenameSection').prop('open'))
    $('#cityRenameName').val(detail.name);

  renderCityMembers();
  renderSentInvitations('#cityInvitations', city.invitations, '#cityCard', '#cityNote', '#cityError', loadCity);
};


// What the server says when an invitation cannot be sent
var invitationError = function(form, input, error, what) {
  if (error.code === 'unauthenticated') {
    sessionEnded();
  } else if (error.code === 'not_found') {
    forms.setFieldError(input, I18n.t('No player has this username.'));
    $(input).trigger('focus');
  } else if (error.code === 'conflict') {
    forms.setFieldError(input, what === 'region' ? I18n.t('This player is already a member of this region.') :
                                                   I18n.t('This player is already a member of this city.'));
    $(input).trigger('focus');
  } else {
    forms.showError(form, error, {username: input});
  }
};


var submitCityInvite = function(e) {
  e.preventDefault();
  var form = $('#cityInviteForm');
  if (forms.isBusy(form) || city === null)
    return;

  forms.clearErrors(form);
  var input = $('#cityInviteName');
  var username = LobbyData.checkUsername(input.val(), Session.info().limits.usernameMax);
  if (!forms.showFieldErrors([[input, username.reason]]))
    return;

  var role = $('#cityInviteRole').val();
  forms.run(form, function() {
    return Api.post('/api/cities/' + encodeURIComponent(cityId) + '/invitations',
                    {username: username.text, role: LobbyData.INVITED_ROLES.indexOf(role) === -1 ? 'player' : role});
  }, function() {
    input.val('');
    setNote('#cityNote', I18n.t('Invitation sent to {name}. It shows in their lobby.'), {name: username.text});
    loadCity();
    input.trigger('focus');
  }, function(error) {
    invitationError(form, input, error, 'city');
  });
};


var submitCityRename = function(e) {
  e.preventDefault();
  var form = $('#cityRenameForm');
  if (forms.isBusy(form) || city === null)
    return;

  forms.clearErrors(form);
  var input = $('#cityRenameName');
  var name = LobbyData.checkName(input.val(), LobbyData.CITY_NAME_MAX);
  if (!forms.showFieldErrors([[input, name.reason]]))
    return;

  forms.run(form, function() {
    return Api.request('PATCH', '/api/cities/' + encodeURIComponent(cityId), {name: name.text});
  }, function() {
    $('#cityRenameSection').prop('open', false);
    setNote('#cityNote', I18n.t('The city is now called {name}.'), {name: name.text});
    loadCity();
    $('#cityRenameSection summary').trigger('focus');
  }, function(error) {
    if (error.code === 'unauthenticated')
      sessionEnded();
    else
      forms.showError(form, error, {name: input});
  });
};


var leaveCity = function(e) {
  var me = myId();
  if (city === null || me === null)
    return;

  var name = city.city.name;
  act(e.currentTarget, '#cityCard', function() {
    return Api.post('/api/cities/' + encodeURIComponent(cityId) + '/members/' + encodeURIComponent(me) + '/remove', {});
  }, function() {
    backToLobby(I18n.t('You left the city {city}.'), {city: name});
  }, '#cityError');
};


var deleteCity = function(e) {
  if (city === null)
    return;

  var name = city.city.name;
  act(e.currentTarget, '#cityCard', function() {
    return Api.post('/api/cities/' + encodeURIComponent(cityId) + '/delete', {});
  }, function() {
    backToLobby(I18n.t('The city {city} was deleted.'), {city: name});
  }, '#cityError');
};


var downloadCity = function(e) {
  if (city === null)
    return;

  var file = LobbyData.downloadName(city.city.name);
  act(e.currentTarget, '#cityCard', function() {
    return Api.get('/api/cities/' + encodeURIComponent(cityId) + '/save', {blob: true});
  }, function(blob) {
    saveFile(blob, file);
    setNote('#cityNote', I18n.t('The copy of the city was saved in the file {file}.'), {file: file});
  }, '#cityError');
};


var cityCard = {
  open: function(options) {
    cityId = options.id;
    city = null;
    $('#cityName').text(options.name || '');
    $('#cityOwner, #cityRole, #cityPopulation, #cityYear, #cityRegion, #cityMembers, #cityInvitations').empty();
    $('#cityInviteSection, #cityRenameSection, #cityDeleteSection, #cityLeaveSection, #cityInvitationsSection').hide();
    $('#cityCard details').prop('open', false);
    ['#cityInviteForm', '#cityRenameForm'].forEach(function(form) { forms.clearErrors($(form)); });
    $('#cityInviteName').val('');
    $('#cityInviteRole').val('player');
    setNote('#cityNote', '');
    $('#cityError').text('');
    loadCity();
  },
  close: function() {
    generations.city++;
    Object.keys(roleTimers).forEach(function(id) { clearTimeout(roleTimers[id]); });
    roleTimers = {};
    $('#cityCard').attr('aria-busy', null);
    city = null;
    reloadBelow();
  }
};


// --- A region's card ---

var loadRegion = function() {
  var generation = ++generations.region;
  $('#regionCard').attr('aria-busy', 'true');
  $('#regionStatus').text(I18n.t('Loading…'));

  return Api.get('/api/regions/' + encodeURIComponent(regionId)).then(function(answer) {
    if (generation !== generations.region)
      return;

    $('#regionCard').attr('aria-busy', null);
    $('#regionStatus').text('');
    var detail = LobbyData.regionDetail(answer);
    if (detail === null) {
      failed(Api.failure('internal'), '#regionError');
      return;
    }
    region = detail;
    keepFocus('#regionCard', '#regionTitle', renderRegion);
  }, function(error) {
    if (generation !== generations.region)
      return;

    $('#regionCard').attr('aria-busy', null);
    $('#regionStatus').text('');
    if (error.code === 'not_found') {
      backToLobby(errorText(error));
      return;
    }
    failed(error, '#regionError');
  });
};


var renderRegionMap = function() {
  var grid = $('#regionGrid').empty();
  grid[0].style.setProperty('--columns', String(region.region.width));

  LobbyData.regionLayout(region).forEach(function(cell, i) {
    var placeId = 'regionPlace' + i;
    var item = $('<li class="regionSlot">').attr('data-free', cell.city === null ? 'true' : 'false');
    $('<span class="slotPosition">').attr('id', placeId)
      .text(I18n.t('Row {row}, column {column}', {row: cell.row, column: cell.column})).appendTo(item);

    var controls = $('<div class="slotButtons">');
    if (cell.city !== null) {
      var nameId = placeId + 'Name';
      $('<bdi class="slotName">').attr('id', nameId).text(cell.city.name).appendTo(item);
      item.append(sentence($('<span class="slotFact">'), I18n.t('Owner: {name}'), {name: cell.city.ownerName}));
      item.append($('<span class="slotFact">').text(I18n.t('Population: {population}',
                                                            {population: I18n.formatNumber(cell.city.population)})));
      if (cell.play) {
        button(I18n.t('Play'), 'primary', nameId, 'play-' + cell.x + '-' + cell.y).on('click', function() {
          play(cell.city.id);
        }).appendTo(controls);
      }
      if (cell.clear) {
        button(I18n.t('Take out of the region'), '', nameId, 'clear-' + cell.x + '-' + cell.y).on('click', function() {
          confirmIn(controls, sentence($('<span>'), I18n.t('Take {city} out of the region? It cannot come back to this place.'),
                                       {city: cell.city.name}),
                    I18n.t('Take it out'), function(yes) { clearSlot(yes, cell); });
        }).appendTo(controls);
      }
    } else {
      $('<span class="slotFree">').text(I18n.t('Free place')).appendTo(item);
      button(I18n.t('Build here'), 'primary', placeId, 'build-' + cell.x + '-' + cell.y).on('click', function() {
        startCreation({region: {id: region.region.id, name: region.region.name}, x: cell.x, y: cell.y});
      }).appendTo(controls);
    }

    item.append(controls);
    grid.append(item);
  });
};


var renderRegionMembers = function() {
  var list = $('#regionMembers').empty();
  var mine = region.region.mine;
  var me = myId();

  region.members.forEach(function(member, i) {
    var nameId = 'regionMember' + i;
    var item = $('<li class="memberItem">');
    var name = $('<span class="memberName">').attr('id', nameId).append($('<bdi>').text(member.username));
    if (member.id === me)
      name.append(document.createTextNode(' ' + I18n.t('(you)')));
    item.append(name);

    var controls = $('<span class="memberControls">').appendTo(item);
    if (member.owner)
      controls.append($('<span class="memberRoleText">').text(PlayersPanel.roleText('owner')));
    else if (mine) {
      button(I18n.t('Remove'), '', nameId, 'remove-' + member.id).on('click', function() {
        confirmIn(controls, sentence($('<span>'), I18n.t('Remove {name} from the region? Their cities leave it.'),
                                     {name: member.username}),
                  I18n.t('Remove'), function(yes) { removeRegionMember(yes, member); });
      }).appendTo(controls);
    }

    list.append(item);
  });
};


var renderRegion = function() {
  var detail = region.region;
  var mine = detail.mine;

  $('#regionName').text(detail.name);
  var facts = [];
  if (mine)
    facts.push(document.createTextNode(I18n.t('Your region')));
  else
    facts.push(sentence($('<span>'), I18n.t('Owner: {name}'), {name: detail.ownerName}));
  facts.push(document.createTextNode(I18n.t('{columns} × {rows} places', {columns: detail.width, rows: detail.height})));
  $('#regionFacts').empty().append(factsLine(facts).children());

  $('#regionInviteSection, #regionRenameSection, #regionDeleteSection').toggle(mine);
  $('#regionLeaveSection').toggle(!mine);
  $('#regionInvitationsSection').toggle(mine && region.invitations !== null && region.invitations.length > 0);
  if (!$('#regionRenameSection').prop('open'))
    $('#regionRenameName').val(detail.name);

  renderRegionMap();
  renderRegionMembers();
  renderSentInvitations('#regionInvitations', region.invitations, '#regionCard', '#regionNote', '#regionError',
                        loadRegion);
};


var clearSlot = function(element, cell) {
  act(element, '#regionCard', function() {
    return Api.post('/api/regions/' + encodeURIComponent(regionId) + '/slots/' + cell.x + '/' + cell.y + '/clear', {});
  }, function() {
    setNote('#regionNote', I18n.t('{city} left the region.'), {city: cell.city.name});
    loadRegion().then(function() { focusList('#regionGrid', '#regionTitle'); });
  }, '#regionError');
};


var removeRegionMember = function(element, member) {
  act(element, '#regionCard', function() {
    return Api.post('/api/regions/' + encodeURIComponent(regionId) + '/members/' + encodeURIComponent(member.id) +
                    '/remove', {});
  }, function() {
    setNote('#regionNote', I18n.t('{name} is no longer a member of this region.'), {name: member.username});
    loadRegion().then(function() { focusList('#regionMembers', '#regionTitle'); });
  }, '#regionError');
};


var submitRegionInvite = function(e) {
  e.preventDefault();
  var form = $('#regionInviteForm');
  if (forms.isBusy(form) || region === null)
    return;

  forms.clearErrors(form);
  var input = $('#regionInviteName');
  var username = LobbyData.checkUsername(input.val(), Session.info().limits.usernameMax);
  if (!forms.showFieldErrors([[input, username.reason]]))
    return;

  forms.run(form, function() {
    return Api.post('/api/regions/' + encodeURIComponent(regionId) + '/invitations', {username: username.text});
  }, function() {
    input.val('');
    setNote('#regionNote', I18n.t('Invitation sent to {name}. It shows in their lobby.'), {name: username.text});
    loadRegion();
    input.trigger('focus');
  }, function(error) {
    invitationError(form, input, error, 'region');
  });
};


var submitRegionRename = function(e) {
  e.preventDefault();
  var form = $('#regionRenameForm');
  if (forms.isBusy(form) || region === null)
    return;

  forms.clearErrors(form);
  var input = $('#regionRenameName');
  var name = LobbyData.checkName(input.val(), LobbyData.REGION_NAME_MAX);
  if (!forms.showFieldErrors([[input, name.reason]]))
    return;

  forms.run(form, function() {
    return Api.request('PATCH', '/api/regions/' + encodeURIComponent(regionId), {name: name.text});
  }, function() {
    $('#regionRenameSection').prop('open', false);
    setNote('#regionNote', I18n.t('The region is now called {region}.'), {region: name.text});
    loadRegion();
    $('#regionRenameSection summary').trigger('focus');
  }, function(error) {
    if (error.code === 'unauthenticated')
      sessionEnded();
    else
      forms.showError(form, error, {name: input});
  });
};


var leaveRegion = function(e) {
  var me = myId();
  if (region === null || me === null)
    return;

  var name = region.region.name;
  act(e.currentTarget, '#regionCard', function() {
    return Api.post('/api/regions/' + encodeURIComponent(regionId) + '/members/' + encodeURIComponent(me) + '/remove', {});
  }, function() {
    backToLobby(I18n.t('You left the region {region}.'), {region: name});
  }, '#regionError');
};


var deleteRegion = function(e) {
  if (region === null)
    return;

  var name = region.region.name;
  act(e.currentTarget, '#regionCard', function() {
    return Api.post('/api/regions/' + encodeURIComponent(regionId) + '/delete', {});
  }, function() {
    backToLobby(I18n.t('The region {region} was deleted.'), {region: name});
  }, '#regionError');
};


var regionCard = {
  open: function(options) {
    regionId = options.id;
    region = null;
    $('#regionName').text(options.name || '');
    $('#regionFacts, #regionGrid, #regionMembers, #regionInvitations').empty();
    $('#regionInviteSection, #regionRenameSection, #regionDeleteSection, #regionLeaveSection, #regionInvitationsSection')
      .hide();
    $('#regionCard details').prop('open', false);
    ['#regionInviteForm', '#regionRenameForm'].forEach(function(form) { forms.clearErrors($(form)); });
    $('#regionInviteName').val('');
    setNote('#regionNote', '');
    $('#regionError').text('');
    loadRegion();
  },
  close: function() {
    generations.region++;
    $('#regionCard').attr('aria-busy', null);
    region = null;
    reloadBelow();
  }
};


// --- A new shared city, made on the title screen ---

// What the server says when it does not make the city
var creationError = function(error) {
  switch (error.code) {
    case 'invalid_input':
      if (error.fields.name)
        return I18n.t(FIELD_TEXTS[error.fields.name]);
      return I18n.t('The server could not open this city. Choose another map or city.');

    case 'limit_reached':
      return I18n.t('You own as many shared cities as you can: delete one of them to make another.');

    case 'conflict':
      return I18n.t('Another city was built on this place meanwhile. Choose another place.');

    default:
      return errorText(error);
  }
};


// The title screen gave the start of the city (choice), its name and level: the city is made, then played. Resolves
// once it is; rejects with the text that says why it was not.
var createCity = function(choice, name, level) {
  var mine = creating;
  if (mine === null)
    return Promise.reject(errorText(Api.failure('internal')));

  var checked = LobbyData.checkName(name, LobbyData.CITY_NAME_MAX);
  if (checked.reason !== null)
    return Promise.reject(I18n.t(FIELD_TEXTS[checked.reason]));

  var body;
  try {
    body = LobbyData.creationRequest(checked.text, level, LobbyData.buildSave(choice, checked.text, level), mine.slot);
  } catch (e) {
    console.error(e);
    return Promise.reject(I18n.t('Sorry, the city could not be loaded.'));
  }

  return Api.post('/api/cities', body, {status: 201, timeout: UPLOAD_TIMEOUT}).then(function(answer) {
    var created = LobbyData.city(answer && answer.city);
    // Cancelled meanwhile: the city is in the lobby
    if (creating !== mine)
      return;
    if (created === null)
      throw Api.failure('internal');

    stopCreation();
    if (!play(created.id))
      openLobby(null, {note: I18n.t('The city {city} was created.'), values: {city: created.name}});
  }).catch(function(error) {
    if (error && error.code === 'unauthenticated' && creating === mine) {
      stopCreation();
      sessionEnded();
    }
    throw creationError(error && typeof(error.code) === 'string' ? error : Api.failure('internal'));
  });
};


var stopCreation = function() {
  creating = null;
  SplashScreen.stopSharing();
  $('#sharedBanner').removeClass('shown');
  $('#sharedBannerText').empty();
  $('#canvasContainer').removeClass('sharedCreation');
};


// Back from the title screen to the lobby (and to the region whose place was chosen)
var cancelCreation = function() {
  var slot = creating !== null ? creating.slot : null;
  stopCreation();
  openLobby(null);
  if (slot !== null)
    AccountScreens.openCard('regionCard', null, {id: slot.region.id, name: slot.region.name});
};


// The title screen comes back to choose the start of a new shared city: in the place slot of a region ({region: {id,
// name}, x, y}), or out of any region (null)
var startCreation = function(slot) {
  leaving = true;
  AccountScreens.closeAll();
  leaving = false;

  creating = {slot: slot || null};
  SplashScreen.share({create: createCity, cancel: cancelCreation});
  $('#canvasContainer').addClass('sharedCreation');
  $('#sharedBanner').addClass('shown');
  var text = $('#sharedBannerText').empty();
  if (slot)
    sentence(text, I18n.t('Choose the map of your shared city, in the region {region}'), {region: slot.region.name});
  else
    text.text(I18n.t('Choose the map of your shared city'));
  $('#splashPlay').trigger('focus');
};


// --- Start ---

var booted = false;

// At the page's start (see micropolis.js): the lobby's cards join the account screens, and #/lobby opens the lobby
var boot = function() {
  if (booted)
    return;
  booted = true;

  AccountScreens.addCard('lobbyCard', lobbyCard);
  AccountScreens.addCard('cityCard', cityCard);
  AccountScreens.addCard('regionCard', regionCard);
  AccountScreens.addRoute('lobby', function() {
    openLobby(null);
  });

  $('#accountMultiplayer').on('click', function(e) {
    openLobby(e.currentTarget);
  });
  $('#lobbyRefresh').on('click', function() {
    setNote('#lobbyNote', '');
    $('#lobbyError').text('');
    loadLobby();
  });
  $('#lobbyNewCity').on('click', function() {
    startCreation(null);
  });
  $('#regionCreateForm').on('submit', submitRegion);

  $('#cityPlay').on('click', function() {
    if (city !== null)
      play(cityId);
  });
  $('#cityDownload').on('click', downloadCity);
  $('#cityInviteForm').on('submit', submitCityInvite);
  $('#cityRenameForm').on('submit', submitCityRename);
  $('#cityLeave').on('click', leaveCity);
  $('#cityDelete').on('click', deleteCity);

  $('#regionInviteForm').on('submit', submitRegionInvite);
  $('#regionRenameForm').on('submit', submitRegionRename);
  $('#regionLeave').on('click', leaveRegion);
  $('#regionDelete').on('click', deleteRegion);

  $('#sharedCancel').on('click', function(e) {
    e.preventDefault();
    // (Not while the city is being sent: it is about to be played)
    if (creating !== null && $('#playForm').attr('aria-busy') !== 'true')
      cancelCreation();
  });
};


var Lobby = {
  boot: boot,
  open: openLobby,
  startCreation: startCreation,
  isCreating: function() {
    return creating !== null;
  }
};


export { Lobby };
