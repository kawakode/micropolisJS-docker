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
// can be signed with it. The changes are made when the window is closed with OK.

// What a deal waits for when its link is missing, signed or not
var needsText = function(kind, signed) {
  if (kind === 'trade')
    return signed ? I18n.t('On hold: build a road or a railway to this edge.') :
                    I18n.t('Needs a road or a railway to this edge.');

  return signed ? I18n.t('On hold: build a power line to this edge.') : I18n.t('Needs a power line to this edge.');
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


var escape = function(text) {
  return $('<div>').text(text).html();
};


var yearlyText = function(amount) {
  return I18n.t('{amount} a year', {amount: (amount > 0 ? '+' : '') + I18n.money(amount)});
};


// What to say about a deal: [text, class], or null
var stateOf = function(deal, signed) {
  // A sale just signed is delivered at the next scan of the power grid, if it can be
  var state = deal.state === 'noPower' && !deal.signed ? 'active' : deal.state;

  if (state === 'noLink')
    return [needsText(deal.kind, signed), signed ? 'warning' : 'muted'];

  if (!signed)
    return null;

  if (state === 'noPower')
    return [I18n.t('Not delivered: the grid does not reach this edge, or has no power to spare.'), 'warning'];

  return [I18n.t('In force'), 'good'];
};


NeighboursWindow.prototype._render = function() {
  var balance = 0;

  var cards = this._neighbours.map(function(n) {
    var link = function(linked, text) {
      return '<span class="neighbourLink ' + (linked ? 'yes' : 'no') + '">' + escape(text) +
             '<span class="visuallyHidden"> ' + escape(I18n.t(linked ? 'linked' : 'not linked')) + '</span></span>';
    };

    var deals = n.deals.map(function(deal) {
      var id = 'deal-' + n.side + '-' + deal.kind;
      var signed = this._draft[n.side][deal.kind];
      var state = stateOf(deal, signed);
      if (signed && (state === null || state[1] === 'good'))
        balance += deal.yearly;

      return '<li class="deal' + (signed ? ' signed' : '') + '">' +
        '<input type="checkbox" class="dealToggle" id="' + id + '" data-side="' + n.side + '" data-kind="' +
        deal.kind + '"' + (signed ? ' checked' : '') + '>' +
        '<label for="' + id + '"><span class="dealName">' + escape(I18n.t(Text.deals[deal.kind])) + '</span>' +
        '<span class="dealAmount ' + (deal.yearly > 0 ? 'income' : 'cost') + '">' + escape(yearlyText(deal.yearly)) +
        '</span></label>' +
        (state ? '<p class="dealState ' + state[1] + '">' + escape(state[0]) + '</p>' : '') +
        '</li>';
    }, this);

    // The neighbour's picture grows with it
    var picture = PixelIcons.picture('town', PixelIcons.townFor(n.population), 2).outerHTML;

    return '<section class="neighbour" aria-label="' + escape(n.name) + '"><div class="neighbourTop">' + picture +
      '<div class="neighbourInfo"><header class="neighbourHeader"><span class="neighbourSide">' +
      escape(I18n.t(Text.sides[n.side])) + '</span><span class="neighbourName">' + escape(n.name) +
      '</span><span class="neighbourPopulation">' +
      escape(I18n.t('{n} inhabitants', {n: I18n.formatNumber(n.population)})) + '</span></header>' +
      '<p class="neighbourLinks">' + link(n.links.transport, I18n.t('Road or railway')) +
      link(n.links.power, I18n.t('Power line')) +
      '</p></div></div><ul class="deals">' + deals.join('') + '</ul></section>';
  }, this);

  $(listID).html(cards.join(''));
  $('#neighboursBalance').text(I18n.t('Deals in force: {amount}.', {amount: yearlyText(balance)}))
    .toggleClass('income', balance > 0).toggleClass('cost', balance < 0);
};


export { NeighboursWindow };
