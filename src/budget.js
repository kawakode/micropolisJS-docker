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

import { EventEmitter } from './eventEmitter.js';
import * as Messages from './messages.ts';
import { MiscUtils } from './miscUtils.js';

// Cost of maintaining 1 police station
var policeMaintenanceCost = 100;

// KawaCity: the yearly upkeep of the buildings that aren't funded by a slider (see collectTax)
var UPKEEP = {schoolPop: 100, universityPop: 250};

// Cost of maintaining 1 fire station
var fireMaintenanceCost = 100;

// Cost of maintaining 1 road tile
var roadMaintenanceCost = 1;

// Cost of maintaining 1 rail tile
var railMaintenanceCost = 2;

// KawaCity: the most money a city may have
var MAX_FUNDS = 2147483647;

// KawaCity: the loans a city may take (see borrow). Each one brings LOAN_AMOUNT now, and costs LOAN_PAYMENT a year
// for LOAN_YEARS years. The debt may not go over MAX_LOANS loans.
var LOAN_AMOUNT = 10000;
var LOAN_PAYMENT = 1200;
var LOAN_YEARS = 10;
var MAX_LOANS = 5;
var MAX_DEBT = MAX_LOANS * LOAN_PAYMENT * LOAN_YEARS;


var Budget = EventEmitter(function() {
  Object.defineProperties(this,
   {MAX_ROAD_EFFECT: MiscUtils.makeConstantDescriptor(32),
    MAX_POLICESTATION_EFFECT: MiscUtils.makeConstantDescriptor(1000),
    MAX_FIRESTATION_EFFECT:  MiscUtils.makeConstantDescriptor(1000),
    // The same constants, under the names used by the simulation and the evaluation
    MAX_POLICE_STATION_EFFECT: MiscUtils.makeConstantDescriptor(1000),
    MAX_FIRE_STATION_EFFECT:  MiscUtils.makeConstantDescriptor(1000)});

  this.roadEffect = this.MAX_ROAD_EFFECT;
  this.policeEffect = this.MAX_POLICESTATION_EFFECT;
  this.fireEffect = this.MAX_FIRESTATION_EFFECT;
  this.totalFunds = 0;
  this.cityTax = 7;
  this.cashFlow = 0;
  this.taxFund = 0;

  // KawaCity: what the deals with the neighbouring cities earned (or cost, if negative) this year (see Neighbours)
  this.dealsFund = 0;
  // And what the upkeep of its schools and universities cost this year (negative)
  this.upkeepFund = 0;
  // The money still owed for its loans, what is repaid each year, and what was repaid this year (negative)
  this.debt = 0;
  this.debtPayment = 0;
  this.loanFund = 0;

  // These values denote how much money is required to fully maintain the relevant services
  this.roadMaintenanceBudget = 0;
  this.fireMaintenanceBudget = 0;
  this.policeMaintenanceBudget = 0;

  // Percentage of budget used
  this.roadPercent = 1;
  this.firePercent = 1;
  this.policePercent = 1;

  // Cash value of spending. Should equal Math.round(_MaintenanceBudget * _Percent)
  this.roadSpend = 0;
  this.fireSpend = 0;
  this.policeSpend = 0;

  this.awaitingValues = false;
  this.autoBudget = true;
  // The rates autobudget had to cut, short of money (see doBudgetNow)
  this._wanted = null;
});


var saveProps = ['autoBudget', 'totalFunds', 'policePercent', 'roadPercent', 'firePercent', 'roadSpend',
                 'policeSpend', 'fireSpend', 'roadMaintenanceBudget', 'policeMaintenanceBudget',
                 'fireMaintenanceBudget', 'cityTax', 'roadEffect', 'policeEffect', 'fireEffect', 'dealsFund',
                 'upkeepFund', 'debt', 'debtPayment', 'loanFund'];

Budget.prototype.save = function(saveData) {
  for (var i = 0, l = saveProps.length; i < l; i++)
    saveData[saveProps[i]] = this[saveProps[i]];
};


Budget.prototype.load = function(saveData) {
  for (var i = 0, l = saveProps.length; i < l; i++)
    this[saveProps[i]] = saveData[saveProps[i]];

  // Saved before there were deals, upkeep or loans
  this.dealsFund = this.dealsFund || 0;
  this.upkeepFund = this.upkeepFund || 0;
  this.debt = this.debt || 0;
  this.debtPayment = this.debtPayment || 0;
  this.loanFund = this.loanFund || 0;

  this._emitEvent(Messages.AUTOBUDGET_CHANGED, this.autoBudget);
  this._emitEvent(Messages.FUNDS_CHANGED, this.totalFunds);
};


Budget.prototype.setAutoBudget = function(value) {
  this.autoBudget = value;
  this._emitEvent(Messages.AUTOBUDGET_CHANGED, this.autoBudget);
};


var RLevels = [0.7, 0.9, 1.2];
var FLevels = [1.4, 1.2, 0.8];

// Calculates the best possible outcome in terms of funding the various services
// given the player's current funds and tax yield. On entry, roadPercent etc. are
// assumed to contain the desired percentage level, and taxFunds should contain the
// most recent tax collected. On exit, the *Percent members will be updated with what
// we can actually afford to spend. Returns an object containing the amount of cash
// that would be spent on each service.
Budget.prototype._calculateBestPercentages = function() {
  // How much would we be spending based on current percentages?
  // Note: the *Budget items are updated every January by collectTax
  this.roadSpend = Math.round(this.roadMaintenanceBudget * this.roadPercent);
  this.fireSpend = Math.round(this.fireMaintenanceBudget * this.firePercent);
  this.policeSpend = Math.round(this.policeMaintenanceBudget * this.policePercent);
  var total = this.roadSpend + this.fireSpend + this.policeSpend;

  // If we don't have any services on the map, we can bail early
  if (total === 0) {
    this.roadPercent = 1;
    this.firePercent = 1;
    this.policePercent = 1;
    return {road: 0, fire: 0, police: 0};
  }

  // How much are we actually going to spend?
  var roadCost = 0;
  var fireCost = 0;
  var policeCost = 0;

  // Deals that cost more than the city has can leave nothing to spend, but never less than nothing
  var cashRemaining = Math.max(0, this.totalFunds + this.taxFund + this.otherFunds());

  // Spending priorities: road, fire, police
  if (cashRemaining >= this.roadSpend)
    roadCost = this.roadSpend;
  else
    roadCost = cashRemaining;
  cashRemaining -= roadCost;

  if (cashRemaining >= this.fireSpend)
    fireCost = this.fireSpend;
  else
    fireCost = cashRemaining;
  cashRemaining -= fireCost;

  if (cashRemaining >= this.policeSpend)
    policeCost = this.policeSpend;
  else
    policeCost = cashRemaining;
  cashRemaining -= policeCost;

  if (this.roadMaintenanceBudget > 0)
    this.roadPercent = (roadCost / this.roadMaintenanceBudget).toPrecision(2) - 0;
  else
    this.roadPercent = 1;

  if (this.fireMaintenanceBudget > 0)
    this.firePercent = (fireCost / this.fireMaintenanceBudget).toPrecision(2) - 0;
  else
    this.firePercent = 1;

  if (this.policeMaintenanceBudget > 0)
    this.policePercent = (policeCost / this.policeMaintenanceBudget).toPrecision(2) - 0;
  else
    this.policePercent = 1;

  return {road: roadCost, police: policeCost, fire: fireCost};
};


// User initiated budget
Budget.prototype.doBudgetWindow = function() {
  return this.doBudgetNow(true);
};


Budget.prototype.doBudgetNow = function(fromWindow) {
  // KawaCity: after a year autobudget couldn't fund in full, it aims again for the rates it had to cut
  if (this.autoBudget && !fromWindow && this._wanted) {
    this.roadPercent = this._wanted.road;
    this.firePercent = this._wanted.fire;
    this.policePercent = this._wanted.police;
  }
  this._wanted = null;
  var wanted = {road: this.roadPercent, fire: this.firePercent, police: this.policePercent};

  var costs = this._calculateBestPercentages();

  if (!this.autoBudget && !fromWindow) {
    this.autoBudget = false;
    this.awaitingValues = true;
    this._emitEvent(Messages.BUDGET_NEEDED);
    return;
  }

  var roadCost = costs.road;
  var policeCost = costs.police;
  var fireCost = costs.fire;
  var totalCost = roadCost + policeCost + fireCost;
  var cashRemaining = this.totalFunds + this.taxFund + this.otherFunds() - totalCost;

  // Autobudget
  if ((cashRemaining > 0 && this.autoBudget) || fromWindow) {
    // Either we were able to fully fund services, or we have just normalised user input. Go ahead and spend.
    this.awaitingValues = false;
    this.doBudgetSpend(roadCost, fireCost, policeCost);
    return;
  }

  // KawaCity: not enough money. Instead of turning itself off and asking for the budget every year, autobudget
  // spends what there is (the city, out of money, says so) and stays on, to fund the services again when it can
  this._wanted = wanted;
  this.awaitingValues = false;
  this.doBudgetSpend(roadCost, fireCost, policeCost);
};


Budget.prototype.doBudgetSpend = function(roadValue, fireValue, policeValue) {
  this.roadSpend = roadValue;
  this.fireSpend = fireValue;
  this.policeSpend = policeValue;
  var total = this.roadSpend + this.fireSpend + this.policeSpend;

  this.spend(-(this.taxFund + this.otherFunds() - total));
  this.updateFundEffects();
};


Budget.prototype.updateFundEffects = function() {
  // The caller is assumed to have correctly set the percentage spend
  this.roadSpend = Math.round(this.roadMaintenanceBudget * this.roadPercent);
  this.fireSpend = Math.round(this.fireMaintenanceBudget * this.firePercent);
  this.policeSpend = Math.round(this.policeMaintenanceBudget * this.policePercent);

  // Update the effect this level of spending will have on infrastructure deterioration
  this.roadEffect = this.MAX_ROAD_EFFECT;
  this.policeEffect = this.MAX_POLICESTATION_EFFECT;
  this.fireEffect = this.MAX_FIRESTATION_EFFECT;

  if (this.roadMaintenanceBudget > 0)
    this.roadEffect = Math.floor(this.roadEffect * this.roadSpend / this.roadMaintenanceBudget);

  if (this.fireMaintenanceBudget > 0)
    this.fireEffect = Math.floor(this.fireEffect * this.fireSpend / this.fireMaintenanceBudget);

  if (this.policeMaintenanceBudget > 0)
    this.policeEffect = Math.floor(this.policeEffect * this.policeSpend / this.policeMaintenanceBudget);
};


// What the city earned or paid this year besides taxes and the services of the sliders: its deals, its upkeep and
// the repayment of its loans
Budget.prototype.otherFunds = function() {
  return this.dealsFund + this.upkeepFund + this.loanFund;
};


// How many more loans the city may take
Budget.prototype.loansAvailable = function() {
  return Math.max(0, Math.floor((MAX_DEBT - this.debt) / (LOAN_PAYMENT * LOAN_YEARS)));
};


// Takes count loans (as many as allowed): the money comes now, and is repaid with interest over the years (see
// collectTax). Returns how many were taken.
Budget.prototype.borrow = function(count) {
  count = Math.min(Math.floor(count) || 0, this.loansAvailable());
  if (count <= 0)
    return 0;

  this.debt += count * LOAN_PAYMENT * LOAN_YEARS;
  this.debtPayment += count * LOAN_PAYMENT;
  this.spend(-count * LOAN_AMOUNT);
  return count;
};


// Pays off the whole debt at once, if the city has the money. Returns whether it did.
Budget.prototype.repay = function() {
  if (this.debt <= 0 || this.totalFunds < this.debt)
    return false;

  this.spend(this.debt);
  this.debt = 0;
  this.debtPayment = 0;
  return true;
};


// The loans' repayment of the year: a negative amount
Budget.prototype._repayYear = function() {
  var payment = Math.min(this.debtPayment, this.debt);
  this.debt -= payment;
  if (this.debt === 0)
    this.debtPayment = 0;

  return payment > 0 ? -payment : 0;
};


// dealsFund: what the deals with the neighbouring cities earned (or cost) over the year. snowFactor: how much more
// the roads cost to keep clear after the snow of the year (see Weather.closeYear), 1 by default.
Budget.prototype.collectTax = function(gameLevel, census, dealsFund, snowFactor) {
  this.cashFlow = 0;
  this.dealsFund = dealsFund || 0;
  var upkeep = Object.keys(UPKEEP).reduce(function(total, counter) {
    return total + (census[counter] || 0) * UPKEEP[counter];
  }, 0);
  this.upkeepFund = upkeep > 0 ? -upkeep : 0;
  this.loanFund = this._repayYear();

  // How much would it cost to fully fund every service?
  this.policeMaintenanceBudget = census.policeStationPop * policeMaintenanceCost;
  this.fireMaintenanceBudget = census.fireStationPop * fireMaintenanceCost;

  var roadCost = Math.max(0, census.roadTotal + (census.roadUpkeep || 0)) * roadMaintenanceCost * (snowFactor || 1);
  var railCost = census.railTotal * railMaintenanceCost;
  this.roadMaintenanceBudget = Math.floor((roadCost + railCost) * RLevels[gameLevel]);

  this.taxFund = Math.floor(Math.floor(census.totalPop * census.landValueAverage / 120) * this.cityTax * FLevels[gameLevel]);

  if (census.totalPop > 0) {
    this.cashFlow = this.taxFund + this.otherFunds() -
                    (this.policeMaintenanceBudget + this.fireMaintenanceBudget + this.roadMaintenanceBudget);
    this.doBudgetNow(false);
  } else {
    // We don't want roads etc deteriorating when population hasn't yet been established
    // (particularly early game)
    this.roadEffect   = this.MAX_ROAD_EFFECT;
    this.policeEffect = this.MAX_POLICESTATION_EFFECT;
    this.fireEffect   = this.MAX_FIRESTATION_EFFECT;

    // The deals and the upkeep are settled all the same
    this.spend(-this.otherFunds());
  }
};


Budget.prototype.setTax = function(amount) {
  if (amount === this.cityTax)
    return;

  this.cityTax = amount;
};


Budget.prototype.setFunds = function(amount) {
  // KawaCity: at most what a save may hold (a 32-bit integer, as the server checks it)
  amount = Math.min(MAX_FUNDS, amount);
  if (amount === this.totalFunds)
    return;

  this.totalFunds = Math.max(0, amount);

  this._emitEvent(Messages.FUNDS_CHANGED, this.totalFunds);
  if (this.totalFunds === 0)
    this._emitEvent(Messages.NO_MONEY);
};


Budget.prototype.spend = function(amount) {
  this.setFunds(this.totalFunds - amount);
};


Budget.prototype.shouldDegradeRoad = function() {
  return this.roadEffect < Math.floor(15 * this.MAX_ROAD_EFFECT / 16);
};


Budget.LOAN_AMOUNT = LOAN_AMOUNT;
Budget.LOAN_PAYMENT = LOAN_PAYMENT;
Budget.LOAN_YEARS = LOAN_YEARS;
Budget.MAX_DEBT = MAX_DEBT;


export { Budget };
