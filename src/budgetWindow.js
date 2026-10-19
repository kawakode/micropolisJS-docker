/* micropolisJS. Adapted by Graeme McCutcheon from Micropolis.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details. Alternatively,
 * consult http://micropolisjs.graememcc.co.uk/LICENSE and
 * http://micropolisjs.graememcc.co.uk/COPYING
 *
 * The name/term "MICROPOLIS" is a registered trademark of Micropolis (https://www.micropolis.com) GmbH
 * (Micropolis Corporation, the "licensor") and is licensed here to the authors/publishers of the "Micropolis"
 * city simulation game and its source code (the project or "licensee(s)") as a courtesy of the owner.
 *
 */

import $ from "jquery";

import { Budget } from './budget.js';
import { I18n } from './i18n.js';
import { BUDGET_WINDOW_CLOSED } from './messages.ts';
import { MiscUtils } from './miscUtils.js';
import { ModalWindow } from './modalWindow.js';
import { Ordinances } from './ordinances.js';


var BudgetWindow = ModalWindow(function() {
  $(budgetCancelID).on('click', cancel.bind(this));
  $(budgetResetID).on('click', resetItems.bind(this));
  $(budgetFormID).on('submit', submit.bind(this));
});


var dataKeys = ['roadMaintenanceBudget', 'fireMaintenanceBudget', 'policeMaintenanceBudget'];
var spendKeys = ['roadRate', 'fireRate', 'policeRate'];

var budgetResetID = '#budgetReset';
var budgetCancelID = '#budgetCancel';
var budgetFormID = '#budgetForm';
var budgetOKID = '#budgetOK';


var setSpendRangeText = function(element, percentage, totalSpend) {
  var labelID = element + 'Label';
  var cash = Math.floor(totalSpend * (percentage / 100));
  var text = I18n.t('{percent}% of {total} = {cash}', {percent: percentage, total: I18n.money(totalSpend), cash: I18n.money(cash)});
  $(MiscUtils.normaliseDOMid(labelID)).text(text);
};


var onFundingUpdate = function(elementID, e) {
  var element = $(MiscUtils.normaliseDOMid(elementID))[0];
  var percentage = element.value - 0;
  var dataSource = element.getAttribute('data-source');
  setSpendRangeText(elementID, percentage, this[dataSource]);
};


var onTaxUpdate = function(e) {
  var elem = $('#taxRateLabel')[0];
  var sourceElem = $('#taxRate')[0];
  $(elem).text(I18n.t('Tax rate: {tax}%', {tax: sourceElem.value}));
};


// The loans the player is about to take
var onLoanUpdate = function() {
  var count = $('#loanCount')[0].value - 0;
  var text;
  if (this.loansAvailable === 0)
    text = I18n.t('No more loans: the debt is at its limit.');
  else if (count === 0)
    text = I18n.t('No new loan');
  else
    text = I18n.t('Borrow {amount}, repaid {payment} a year for {years} years',
                  {amount: I18n.money(count * Budget.LOAN_AMOUNT), payment: I18n.money(count * Budget.LOAN_PAYMENT),
                   years: Budget.LOAN_YEARS});
  $('#loanCountLabel').text(text);
};


// Shows the debt, and offers to pay it off when the city has the money
var showDebt = function(budgetData) {
  var debt = budgetData.debt || 0;
  var money = I18n.money;
  $('#debtInfo').text(debt > 0 ?
    I18n.t('Debt: {debt}, repaid {payment} a year', {debt: money(debt), payment: money(budgetData.debtPayment || 0)}) :
    I18n.t('No debt'));

  var repay = $('#repayDebt')[0];
  repay.checked = false;
  repay.disabled = budgetData.totalFunds < debt;
  $('#repayDebtText').text(I18n.t('Pay off the whole debt now ({debt})', {debt: money(debt)}));
  $('#repayDebtLabel').toggleClass('hidden', debt === 0).toggleClass('disabled', repay.disabled);
};


// The ordinances, each with what it would cost a year in the city as it is
var showOrdinances = function(mask, population) {
  var list = $('#ordinanceList').empty();
  Ordinances.LIST.forEach(function(ordinance) {
    var label = $('<label class="budgetData budgetCheck">').attr('title', I18n.t(ordinance.description));
    $('<input type="checkbox">').attr('data-bit', ordinance.bit).prop('checked', Ordinances.isOn(mask, ordinance))
      .appendTo(label);
    $('<span>').text(I18n.t('{name} ({cost} a year)', {name: I18n.t(ordinance.name),
                                                        cost: I18n.money(Ordinances.costOf(ordinance, population))}))
      .appendTo(label);
    label.appendTo(list);
  });
};


// The ordinances ticked in the window, as a mask
var chosenOrdinances = function() {
  var mask = 0;
  $('#ordinanceList input:checked').each(function() {
    mask |= 1 << Number(this.getAttribute('data-bit'));
  });
  return mask;
};


var resetItems = function(e) {
  for (var i = 0; i < spendKeys.length; i++) {
    var original = this['original' + spendKeys[i]];
    $(MiscUtils.normaliseDOMid(spendKeys[i]))[0].value = original;
    setSpendRangeText(spendKeys[i], original, this[dataKeys[i]]);
  }
  $('#taxRate')[0].value = this.originalTaxRate;
  onTaxUpdate();
  $('#loanCount')[0].value = 0;
  onLoanUpdate.call(this);
  $('#repayDebt')[0].checked = false;
  showOrdinances(this.originalOrdinances, this.population);

  e.preventDefault();
};


BudgetWindow.prototype.close = function(data) {
  data = data || {cancelled: true};
  this._emitEvent(BUDGET_WINDOW_CLOSED, data);
  this._toggleDisplay();
};


var cancel = function(e) {
  e.preventDefault();
  this.close({cancelled: true});
};


var submit = function(e) {
  e.preventDefault();

  // Get element values
  var roadPercent = $('#roadRate')[0].value;
  var firePercent = $('#fireRate')[0].value;
  var policePercent = $('#policeRate')[0].value;
  var taxPercent = $('#taxRate')[0].value;
  var borrow = $('#loanCount')[0].value - 0;
  var repay = $('#repayDebt')[0].checked;
  var ordinances = chosenOrdinances();

  var data = {cancelled: false, roadPercent: roadPercent, firePercent: firePercent,
                        policePercent: policePercent, taxPercent: taxPercent, borrow: borrow, repay: repay,
                        ordinances: ordinances,
                        e: e, original: e.type};
  this.close(data);
};


BudgetWindow.prototype.open = function(budgetData) {
  var i, elem;

  // Store max funding levels
  for (i = 0; i < dataKeys.length; i++) {
    if (budgetData[dataKeys[i]] === undefined)
      throw new Error('Missing budget data ('  + dataKeys[i] + ')');
    this[dataKeys[i]] = budgetData[dataKeys[i]];
  }

  // Update form elements with percentages, and set up listeners
  for (i = 0; i < spendKeys.length; i++) {
    if (budgetData[spendKeys[i]] === undefined)
      throw new Error('Missing budget data (' + spendKeys[i] + ')');

    elem = spendKeys[i];
    this['original' + elem] = budgetData[elem];
    setSpendRangeText(elem, budgetData[spendKeys[i]], this[dataKeys[i]]);
    elem = $(MiscUtils.normaliseDOMid(elem));
    // Replace the listeners of the last time the window was open
    elem.off('.budget').on('input.budget change.budget', onFundingUpdate.bind(this, spendKeys[i]));
    elem = elem[0];
    elem.value = budgetData[spendKeys[i]];
  }

  if (budgetData.taxRate === undefined)
    throw new Error('Missing budget data (taxRate)');

  this.originalTaxRate = budgetData.taxRate;
  elem = $('#taxRate');
  elem.off('.budget').on('input.budget change.budget', onTaxUpdate);
  elem = elem[0];
  elem.value = budgetData.taxRate;
  onTaxUpdate();

  // Update static parts
  var previousFunds = budgetData.totalFunds;
  if (previousFunds === undefined)
    throw new Error('Missing budget data (previousFunds)');

  var taxesCollected = budgetData.taxesCollected;
  if (taxesCollected === undefined)
    throw new Error('Missing budget data (taxesCollected)');

  // KawaCity: what the deals with the neighbouring cities earned or cost this year
  var dealsFund = budgetData.dealsFund || 0;
  // And what the upkeep of its schools and universities cost, and the repayment of its loans
  var upkeepFund = budgetData.upkeepFund || 0;
  var loanFund = budgetData.loanFund || 0;

  // The loans: none taken until the player chooses
  this.loansAvailable = budgetData.loansAvailable || 0;
  elem = $('#loanCount');
  elem.off('.budget').on('input.budget change.budget', onLoanUpdate.bind(this));
  elem.attr('max', Math.max(1, this.loansAvailable)).prop('disabled', this.loansAvailable === 0);
  elem[0].value = 0;
  onLoanUpdate.call(this);
  showDebt(budgetData);

  // The ordinances in force
  this.originalOrdinances = budgetData.ordinances || 0;
  this.population = budgetData.population || 0;
  showOrdinances(this.originalOrdinances, this.population);
  var ordinanceFund = budgetData.ordinanceFund || 0;

  var cashFlow = taxesCollected + dealsFund + upkeepFund + loanFund + ordinanceFund - this.roadMaintenanceBudget - this.fireMaintenanceBudget -
                 this.policeMaintenanceBudget;
  var currentFunds = previousFunds + cashFlow;
  var money = I18n.money;
  $('#taxesCollected').text(money(taxesCollected));
  $('#dealsFund').text(money(dealsFund));
  $('#dealsInfo').toggleClass('hidden', dealsFund === 0);
  $('#upkeepFund').text(money(upkeepFund));
  $('#upkeepInfo').toggleClass('hidden', upkeepFund === 0);
  $('#loanFund').text(money(loanFund));
  $('#loanInfo').toggleClass('hidden', loanFund === 0);
  $('#ordinanceFund').text(money(ordinanceFund));
  $('#ordinanceInfo').toggleClass('hidden', ordinanceFund === 0);
  $('#cashFlow').text(money(cashFlow));
  $('#previousFunds').text(money(previousFunds));
  $('#currentFunds').text(money(currentFunds));

  this._toggleDisplay();
};


// The rate a window shows for the share of a service's needs that is funded (0 to 1): rounded, as 0.29 * 100 is
// 28.999...
BudgetWindow.rateOf = function(share) {
  return Math.round(share * 100);
};


export { BudgetWindow };
