/* KawaCity, a modified version of micropolisJS. Adapted by Graeme McCutcheon from Micropolis.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

import $ from "jquery";

import { I18n } from './i18n.js';
import { NEIGHBOURS_WINDOW_CLOSED } from './messages.ts';
import { ModalWindow } from './modalWindow.js';
import { Neighbours } from './neighbours.js';
import { PixelIcons } from './pixelIcons.js';
import { Text } from './text.js';

// The deals with the neighbouring cities (see Neighbours): a card for each neighbour, with its links and the deals that
// can be signed with it. The changes are made when the window is closed with OK. A neighbour that is another player's
// city shows its mayor, and whether that city signed its side of each deal.

// What a deal waits for when its link is missing, signed or not
var needsText = function(kind, signed) {
  if (kind === 'trade')
    return signed ? I18n.t('On hold: build a road or a railway to this edge.') :
                    I18n.t('Needs a road or a railway to this edge.');

  return signed ? I18n.t('On hold: build a power line to this edge.') : I18n.t('Needs a power line to this edge.');
};


// What a deal with a player's city waits for, when that city has no link at its edge
var theirLinkText = function(kind, owner) {
  if (kind === 'trade')
    return I18n.t('On hold: {owner} has no road or railway at this edge yet.', {owner: owner});

  return I18n.t('On hold: {owner} has no power line at this edge yet.', {owner: owner});
};


var neighboursFormID = '#neighboursForm';
var listID = '#neighboursList';


var NeighboursWindow = ModalWindow(function() {
  // [{side, name, population, links, deals: [{kind, signed, state, yearly}]}], and the deals as they will be signed,
  // by side and kind
  this._neighbours = null;
  this._draft = null;

  $(neighboursFormID).on('submit', submit.bind(this));
  $('#neighboursCancel').on('click', cancel.bind(this));

  var self = this;
  $(listID).on('change', '.dealToggle', function() {
    var side = $(this).attr('data-side');
    var kind = $(this).attr('data-kind');
    var signed = $(this).prop('checked');

    self._draft[side][kind] = signed;
    if (signed && Neighbours.EXCLUSIVE[kind])
      self._draft[side][Neighbours.EXCLUSIVE[kind]] = false;

    self._render();
    $('#deal-' + side + '-' + kind).focus();
  });
});


NeighboursWindow.prototype.close = function(changes) {
  this._neighbours = null;
  this._draft = null;
  this._emitEvent(NEIGHBOURS_WINDOW_CLOSED, changes || []);
  this._toggleDisplay();
};


var cancel = function(e) {
  e.preventDefault();
  this.close([]);
};


// The deals signed or ended: [{side, kind, signed}], the deals ended first
var submit = function(e) {
  e.preventDefault();

  var changes = [];
  this._neighbours.forEach(function(n) {
    n.deals.forEach(function(deal) {
      var signed = this._draft[n.side][deal.kind];
      if (signed !== deal.signed)
        changes.push({side: n.side, kind: deal.kind, signed: signed});
    }, this);
  }, this);

  changes.sort(function(a, b) { return a.signed - b.signed; });
  this.close(changes);
};


// neighbours: see Neighbours.describe
NeighboursWindow.prototype.open = function(neighbours) {
  this._neighbours = neighbours;
  this._draft = {};
  neighbours.forEach(function(n) {
    this._draft[n.side] = {};
    n.deals.forEach(function(deal) {
      this._draft[n.side][deal.kind] = deal.signed;
    }, this);
  }, this);

  this._render();
  this._toggleDisplay();
};


// A text made safe to put in HTML, between tags or in an attribute's value (between double or single quotes): the
// names of the neighbours come from saves, which may come from anywhere
var ENTITIES = {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;'};

var escape = function(text) {
  return String(text).replace(/[&<>"']/g, function(c) { return ENTITIES[c]; });
};


var yearlyText = function(amount) {
  return I18n.t('{amount} a year', {amount: (amount > 0 ? '+' : '') + I18n.money(amount)});
};


// What to say about a deal with the neighbour, as it will be signed (or not): [text, class], or null
var stateOf = function(neighbour, deal, signed) {
  // A sale just signed is delivered at the next scan of the power grid, if it can be; a deal a player's city offered
  // is in force once signed
  var state = deal.state === 'noPower' && !deal.signed ? 'active' : deal.state;
  if (state === 'offered' && signed)
    state = 'active';

  // A player's city signed its side
  if (deal.theirs && !signed)
    return [I18n.t('{owner} offers this deal: tick it to accept.', {owner: neighbour.ownerName}), 'offer'];

  if (state === 'noLink')
    return [needsText(deal.kind, signed), signed ? 'warning' : 'muted'];

  if (!signed)
    return null;

  if (state === 'proposed')
    return [I18n.t('Proposed: waiting for {owner} to sign it too.', {owner: neighbour.ownerName}), 'warning'];

  if (state === 'theirLink')
    return [theirLinkText(deal.kind, neighbour.ownerName), 'warning'];

  if (state === 'noPower' && deal.kind === 'buyPower')
    return [I18n.t('Not delivered: {owner} has no power to spare at this edge.', {owner: neighbour.ownerName}), 'warning'];

  if (state === 'noPower')
    return [I18n.t('Not delivered: the grid does not reach this edge, or has no power to spare.'), 'warning'];

  return [I18n.t('In force'), 'good'];
};


NeighboursWindow.prototype._render = function() {
  var cards = this._cards();

  $(listID).html(cards.html);
  $('#neighboursBalance').text(I18n.t('Deals in force: {amount}.', {amount: yearlyText(cards.balance)}))
    .toggleClass('income', cards.balance > 0).toggleClass('cost', cards.balance < 0);
};


// The picture of a neighbour, which grows with it, as HTML
NeighboursWindow.prototype._picture = function(population) {
  return PixelIcons.picture('town', PixelIcons.townFor(population), 2).outerHTML;
};


// The neighbours' cards as HTML, and the yearly balance of the deals that would be in force: {html, balance}
NeighboursWindow.prototype._cards = function() {
  var balance = 0;

  var cards = this._neighbours.map(function(n) {
    var link = function(linked, text) {
      return '<span class="neighbourLink ' + (linked ? 'yes' : 'no') + '">' + escape(text) +
             '<span class="visuallyHidden"> ' + escape(I18n.t(linked ? 'linked' : 'not linked')) + '</span></span>';
    };

    var deals = n.deals.map(function(deal) {
      var id = 'deal-' + n.side + '-' + deal.kind;
      var signed = this._draft[n.side][deal.kind];
      var state = stateOf(n, deal, signed);
      if (signed && (state === null || state[1] === 'good'))
        balance += deal.yearly;

      return '<li class="deal' + (signed ? ' signed' : '') + '">' +
        '<input type="checkbox" class="dealToggle" id="' + escape(id) + '" data-side="' + escape(n.side) +
        '" data-kind="' + escape(deal.kind) + '"' + (signed ? ' checked' : '') + '>' +
        '<label for="' + escape(id) + '"><span class="dealName">' + escape(I18n.t(Text.deals[deal.kind])) + '</span>' +
        '<span class="dealAmount ' + (deal.yearly > 0 ? 'income' : 'cost') + '">' + escape(yearlyText(deal.yearly)) +
        '</span></label>' +
        (state ? '<p class="dealState ' + state[1] + '">' + escape(state[0]) + '</p>' : '') +
        '</li>';
    }, this);

    return '<section class="neighbour" aria-label="' + escape(n.name) + '"><div class="neighbourTop">' +
      this._picture(n.population) +
      '<div class="neighbourInfo"><header class="neighbourHeader"><span class="neighbourSide">' +
      escape(I18n.t(Text.sides[n.side])) + '</span><span class="neighbourName">' + escape(n.name) + '</span>' +
      (n.player ? '<span class="neighbourOwner">' + escape(I18n.t('Mayor: {owner}', {owner: n.ownerName})) + '</span>' :
                  '') +
      '<span class="neighbourPopulation">' +
      escape(I18n.t('{n} inhabitants', {n: I18n.formatNumber(n.population)})) + '</span></header>' +
      '<p class="neighbourLinks">' + link(n.links.transport, I18n.t('Road or railway')) +
      link(n.links.power, I18n.t('Power line')) +
      '</p></div></div><ul class="deals">' + deals.join('') + '</ul></section>';
  }, this);

  return {html: cards.join(''), balance: balance};
};


NeighboursWindow.escape = escape;


export { NeighboursWindow };
