/* KawaCity, a modified version of micropolisJS. Adapted by Graeme McCutcheon from Micropolis.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

import $ from "jquery";

import { I18n } from './i18n.js';
import { SCENARIO_WINDOW_CLOSED } from './messages.ts';
import { ModalWindow } from './modalWindow.js';
import { Scenarios } from './scenarios.js';


// Presents a scenario before it starts, and its outcome when its time is up.
//
// The window closes with one of the actions below: the game starts or carries on, the scenario is played again, or
// the player goes back to the title screen.

var ScenarioWindow = ModalWindow(function() {
  this.mode = null;

  $('#scenarioForm').on('submit', function(e) {
    e.preventDefault();
    this.close(this.mode === ScenarioWindow.INTRO ? ScenarioWindow.START : ScenarioWindow.CONTINUE);
  }.bind(this));

  $('#scenarioRetry').on('click', function(e) {
    e.preventDefault();
    this.close(ScenarioWindow.RETRY);
  }.bind(this));

  $('#scenarioTitle').on('click', function(e) {
    e.preventDefault();
    this.close(ScenarioWindow.TITLE);
  }.bind(this));
}, '#scenarioOK');


var WON_TEXT = ['Your mayorial skill and city planning expertise have earned you the KEY TO THE CITY. Local residents will erect monuments to your glory and name their first-born children after you. Why not run for governor?'];

var LOST_TEXT = ['The entire population of this city has finally had enough of your inept planning and incompetent management. An angry mob -- led by your mother -- has been spotted in the vicinity of city hall.',
                 'You should seriously consider taking an extended vacation -- NOW. (Or try again.)'];


// mode: INTRO, WON or LOST; scenario: an entry of Scenarios.list
ScenarioWindow.prototype.open = function(mode, scenario) {
  this.mode = mode;
  this.scenario = scenario;

  var title, paragraphs;
  if (mode === ScenarioWindow.WON) {
    title = I18n.t('You\'re a winner!');
    paragraphs = WON_TEXT;
  } else if (mode === ScenarioWindow.LOST) {
    title = I18n.t('Impeachment notice!');
    paragraphs = LOST_TEXT;
  } else {
    title = scenario.name;
    paragraphs = scenario.text;
  }

  $('#scenarioName').text(title);
  $('#scenarioWindow').toggleClass('won', mode === ScenarioWindow.WON).toggleClass('lost', mode === ScenarioWindow.LOST);
  $('#scenarioPlace').text(I18n.t(scenario.place).toUpperCase() + '  ' + scenario.year);
  $('#scenarioText').empty();
  paragraphs.forEach(function(text) {
    $('<p>').text(I18n.t(text)).appendTo('#scenarioText');
  });

  var goal = I18n.t(Scenarios.GOAL_TEXT[scenario.goal]);
  var years = Math.round(scenario.scoreWait / 48);
  $('#scenarioGoal').text(I18n.t(mode === ScenarioWindow.INTRO ? 'Goal: {goal} within {years} years.' :
                                 (mode === ScenarioWindow.WON ? 'Goal reached: {goal}.' : 'Goal missed: {goal}.'),
                                 {goal: goal, years: years}));

  // Which ways out there are
  $('#scenarioOK').val(I18n.t(mode === ScenarioWindow.INTRO ? 'Take office' : 'Keep playing')).toggle(mode !== ScenarioWindow.LOST);
  $('#scenarioRetry').toggle(mode === ScenarioWindow.LOST);
  $('#scenarioTitle').toggle(mode !== ScenarioWindow.INTRO);

  this._toggleDisplay();
  if (mode === ScenarioWindow.LOST)
    $('#scenarioRetry').focus();
};


ScenarioWindow.prototype.close = function(action) {
  // Escape closes the window as its main button would; a lost scenario can't simply be carried on
  if (!action) {
    if (this.mode === ScenarioWindow.LOST)
      return false;
    action = this.mode === ScenarioWindow.INTRO ? ScenarioWindow.START : ScenarioWindow.CONTINUE;
  }

  var scenario = this.scenario;
  this.mode = null;
  this.scenario = null;
  this._toggleDisplay();
  this._emitEvent(SCENARIO_WINDOW_CLOSED, {action: action, scenario: scenario});
  return true;
};


ScenarioWindow.INTRO = 'intro';
ScenarioWindow.WON = 'won';
ScenarioWindow.LOST = 'lost';

ScenarioWindow.START = 'start';
ScenarioWindow.CONTINUE = 'continue';
ScenarioWindow.RETRY = 'retry';
ScenarioWindow.TITLE = 'title';


export { ScenarioWindow };
