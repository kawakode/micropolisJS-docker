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

import { BaseTool } from './baseTool.js';
import { BudgetWindow } from './budgetWindow.js';
import { CityPicture } from './cityPicture.js';
import { Config } from './config.js';
import { CongratsWindow } from './congratsWindow.js';
import { DebugWindow } from './debugWindow.js';
import { DisasterWindow } from './disasterWindow.js';
import { EvaluationWindow } from './evaluationWindow.js';
import { GraphsWindow } from './graphsWindow.js';
import { I18n } from './i18n.js';
import { Scenarios } from './scenarios.js';
import { ScenarioWindow } from './scenarioWindow.js';
import { GameCanvas } from './gameCanvas.js';
import { GameMap } from './gameMap.js';
import { InfoBar } from './infoBar.js';
import { InputStatus } from './inputStatus.js';
import { IsoView } from './isoView.js';
import { LocalController } from './localController.js';
import * as Messages from './messages.ts';
import { MonsterTV } from './monsterTV.js';
import { NeighboursWindow } from './neighboursWindow.js';
import { Notification } from './notification.js';
import { QueryWindow } from './queryWindow.js';
import { Random } from './random.ts';
import { RCI } from './rci.js';
import { SaveWindow } from './saveWindow.js';
import { ScreenshotWindow } from './screenshotWindow.js';
import { SettingsWindow } from './settingsWindow.js';
import { Simulation } from './simulation.js';
import { Storage } from './storage.js';
import { Text } from './text.js';
import { Ticker } from './ticker.js';
import { TickerNews } from './tickerNews.js';
import { AmbientLife } from './ambientLife.js';
import { Minimap } from './minimap.js';
import { ToolIcons } from './toolIcons.js';
import { Toolbar } from './toolbar.js';

var disasterTimeout = 20 * 1000;

// How often sprites move, in milliseconds
var SPRITE_STEP = 1000 / 60;


// options: {controller}, for a shared city: a RemoteController, which holds the copy of the city the game shows (the
// gameMap given is then that copy's map) and sends the player's commands to the server that simulates it. Without it,
// the game carries them out on its own city (see LocalController).
function Game(gameMap, tileSet, snowTileSet, spriteSheet, difficulty, name, options) {
  difficulty = difficulty || 0;
  options = options || {};
  var savedGame;

  var controller = options.controller || null;
  var remote = controller !== null && controller.remote === true;
  this.remote = remote;

  if (remote) {
    this.gameMap = controller.city.map;
    savedGame = null;
  } else if (!gameMap.isSavedGame) {
    this.gameMap = gameMap;
    savedGame = null;
  } else {
    this.gameMap = new GameMap(120, 100);
    savedGame = gameMap;
  }

  this.tileSet = tileSet;
  this.snowTileSet = snowTileSet;
  this.defaultSpeed = Simulation.SPEED_MED;
  this.simulation = remote ? controller.city.simulation :
                    new Simulation(this.gameMap, difficulty, this.defaultSpeed, savedGame);

  // What the player's commands do (a shared city's game still uses the local one for the query tool)
  this._local = new LocalController(this);
  this.controller = remote ? controller : this._local;

  this.name = name || 'MyTown';

  // Track when various milestones are first reached
  this._reachedTown = this._reachedCity = this._reachedCapital = this._reachedMetropolis = this._reachedMegalopolis = false;

  if (savedGame)
    this.load(savedGame);

  // A game saved while paused should not resume paused: the controls always start in the running state. A shared
  // city runs at the server's speed.
  if (remote)
    this.defaultSpeed = controller.city.speed;
  else if (this.simulation.isPaused())
    this.simulation.setSpeed(this.defaultSpeed);
  else
    this.defaultSpeed = this.simulation._speed;

  this.rci = new RCI('RCIContainer', this.simulation);

  // Note: must init canvas before inputStatus. A shared city's map only changes as the server says: its explosions
  // keep their last picture until the server turns them into rubble.
  this.gameCanvas = new GameCanvas('canvasContainer');
  if (remote)
    this.gameCanvas.init(this.gameMap, this.tileSet, spriteSheet, null, {noWrite: true});
  else
    this.gameCanvas.init(this.gameMap, this.tileSet, spriteSheet);
  this.gameCanvas.setIsometric(IsoView.isPreferred());

  // Modern screens are large: start zoomed in when there is room (the isometric view's tiles are already twice as
  // wide)
  if (this.gameCanvas.cssWidth >= 1000 && this.gameCanvas.cssHeight >= 600 && !this.gameCanvas.isIsometric())
    this.gameCanvas.setZoom(2);
  this.gameCanvas.centreOn(Math.floor(this.gameMap.width / 2), Math.floor(this.gameMap.height / 2));

  // The tool bar: categories, and their palettes of tools
  Toolbar.build();
  ToolIcons.decorateToolButtons();
  this.inputStatus = new InputStatus(this.gameMap, this.gameCanvas);
  Toolbar.bind(this.inputStatus.selectTool.bind(this.inputStatus));
  this.inputStatus.setToolCycles(Toolbar.cycles());
  Toolbar.refresh(null);
  this.inputStatus.addEventListener(Messages.TOOL_CHANGED, function(toolName) {
    Toolbar.refresh(toolName);
  });
  this._showToolLabel();

  this.dialogOpen = false;
  this._openWindow = null;
  // What the budget or settings window showed when it last opened
  this._windowShown = null;
  // The congratulations waiting for the window open to close
  this._congrats = [];
  this.overlay = null;
  this._preview = null;
  this.simNeededBudget = false;
  this.isPaused = remote ? controller.city.paused : false;
  this.lastBadMessageTime = null;

  // Map input is ignored while a dialog is open
  this.inputStatus.isBlocked = function() {
    return this.dialogOpen;
  }.bind(this);

  // Initialise monsterTV
  if (remote)
    this.monsterTV = new MonsterTV(this.gameMap, tileSet, spriteSheet, null, {noWrite: true});
  else
    this.monsterTV = new MonsterTV(this.gameMap, tileSet, spriteSheet, null);
  this.monsterTV.canvas.setIsometric(this.gameCanvas.isIsometric());

  var opacityLayerID = 'opaque';

  this.genericDialogClosure = genericDialogClosure.bind(this);

  // Hook up listeners to open/close evaluation window
  this.handleEvalRequest = makeWindowOpenHandler('eval', function() {
    return [this.simulation.evaluation];
  }.bind(this));

  this.evalWindow = new EvaluationWindow(opacityLayerID, 'evalWindow');
  this.evalWindow.addEventListener(Messages.EVAL_WINDOW_CLOSED, this.genericDialogClosure);
  this.inputStatus.addEventListener(Messages.EVAL_REQUESTED, this.handleEvalRequest.bind(this));

  // ... the graphs window
  this.handleGraphsRequest = makeWindowOpenHandler('graphs', function() {
    return [{census: this.simulation.getCensus(), historyTime: this.simulation.getHistoryTime(),
             startingYear: this.simulation.getStartingYear()}];
  }.bind(this));

  this.graphsWindow = new GraphsWindow(opacityLayerID, 'graphsWindow');
  this.graphsWindow.addEventListener(Messages.GRAPHS_WINDOW_CLOSED, this.genericDialogClosure);
  this.inputStatus.addEventListener(Messages.GRAPHS_REQUESTED, this.handleGraphsRequest.bind(this));

  // ... and similarly for the budget window
  this.handleBudgetRequest = makeWindowOpenHandler('budget', function() {
    var budgetData = {
      roadMaintenanceBudget: this.simulation.budget.roadMaintenanceBudget,
      roadRate: BudgetWindow.rateOf(this.simulation.budget.roadPercent),
      fireMaintenanceBudget: this.simulation.budget.fireMaintenanceBudget,
      fireRate: BudgetWindow.rateOf(this.simulation.budget.firePercent),
      policeMaintenanceBudget: this.simulation.budget.policeMaintenanceBudget,
      policeRate: BudgetWindow.rateOf(this.simulation.budget.policePercent),
      taxRate: this.simulation.budget.cityTax,
      totalFunds: this.simulation.budget.totalFunds,
      taxesCollected: this.simulation.budget.taxFund,
      dealsFund: this.simulation.budget.dealsFund,
      upkeepFund: this.simulation.budget.upkeepFund
    };

    this._windowShown = budgetData;
    return [budgetData];
  }.bind(this));

  this.budgetWindow = new BudgetWindow(opacityLayerID, 'budget');
  this.budgetWindow.addEventListener(Messages.BUDGET_WINDOW_CLOSED, this.handleBudgetWindowClosure.bind(this));
  this.inputStatus.addEventListener(Messages.BUDGET_REQUESTED, this.handleBudgetRequest.bind(this));

  // ... and also the disaster window
  this.disasterWindow = new DisasterWindow(opacityLayerID, 'disasterWindow');
  this.disasterWindow.addEventListener(Messages.DISASTER_WINDOW_CLOSED, this.handleDisasterWindowClosure.bind(this));
  this.inputStatus.addEventListener(Messages.DISASTER_REQUESTED, this.handleDisasterRequest.bind(this));

  // ... the deals with the neighbouring cities
  this.handleNeighboursRequest = makeWindowOpenHandler('neighbours', function() {
    return [this.simulation.neighbours.describe()];
  }.bind(this));
  this.neighboursWindow = new NeighboursWindow(opacityLayerID, 'neighboursWindow');
  this.neighboursWindow.addEventListener(Messages.NEIGHBOURS_WINDOW_CLOSED,
                                         this.handleNeighboursWindowClosure.bind(this));
  this.inputStatus.addEventListener(Messages.NEIGHBOURS_REQUESTED, this.handleNeighboursRequest.bind(this));

  // ... the debug window
  this.debugWindow = new DebugWindow(opacityLayerID, 'debugWindow');
  this.debugWindow.addEventListener(Messages.DEBUG_WINDOW_CLOSED, this.handleDebugWindowClosure.bind(this));
  this.inputStatus.addEventListener(Messages.DEBUG_WINDOW_REQUESTED, this.handleDebugRequest.bind(this));

  // ... the settings window
  this.handleSettingsRequest = makeWindowOpenHandler('settings', function() {
    this._windowShown = {autoBudget: this.simulation.budget.autoBudget, autoBulldoze: BaseTool.getAutoBulldoze(),
                         speed: this.defaultSpeed, disasters: this.simulation.disasterManager.disastersEnabled,
                         dayNight: this.ambientLife.dayNight, level: this.simulation.getLevel(),
                         language: I18n.getLanguage(), isometric: this.gameCanvas.isIsometric()};
    return [this._windowShown];
  }.bind(this));
  this.settingsWindow = new SettingsWindow(opacityLayerID, 'settingsWindow');
  this.settingsWindow.addEventListener(Messages.SETTINGS_WINDOW_CLOSED, this.handleSettingsWindowClosure.bind(this));
  this.inputStatus.addEventListener(Messages.SETTINGS_WINDOW_REQUESTED, this.handleSettingsRequest.bind(this));

  // ... the window to share a picture of the city
  this.handleScreenshotRequest = makeWindowOpenHandler('screenshot', function() {
    this.tickerNews.record('picture');
    return [this.getPictureData()];
  }.bind(this));
  this.screenshotWindow = new ScreenshotWindow(opacityLayerID, 'screenshotWindow');
  this.screenshotWindow.addEventListener(Messages.SCREENSHOT_WINDOW_CLOSED, this.genericDialogClosure);
  this.inputStatus.addEventListener(Messages.SCREENSHOT_WINDOW_REQUESTED, this.handleScreenshotRequest.bind(this));

  // ... the save confirmation window
  this.saveWindow = new SaveWindow(opacityLayerID, 'saveWindow');
  this.saveWindow.addEventListener(Messages.SAVE_WINDOW_CLOSED, this.genericDialogClosure);

  // ... the scenario window: the briefing, and the outcome
  this.scenarioWindow = new ScenarioWindow(opacityLayerID, 'scenarioWindow');
  this.scenarioWindow.addEventListener(Messages.SCENARIO_WINDOW_CLOSED, this.handleScenarioWindowClosure.bind(this));
  this.simulation.addEventListener(Messages.SCENARIO_ENDED, this.handleScenarioEnded.bind(this));

  // ... and finally the query window
  this.queryWindow = new QueryWindow();
  // A game before this one may have left it open
  this.queryWindow.close();
  this.inputStatus.addEventListener(Messages.QUERY_WINDOW_NEEDED, this.handleQueryRequest.bind(this));

  // Listen for clicks on the save button
  this.inputStatus.addEventListener(Messages.SAVE_REQUESTED, this.handleSave.bind(this));

  // Listen for front end messages
  this.simulation.addEventListener(Messages.FRONT_END_MESSAGE, this.processFrontEndMessage.bind(this));

  // Listen for budget messages
  this.simulation.addEventListener(Messages.BUDGET_NEEDED, this.handleMandatoryBudget.bind(this));

  // Listen for tools being applied
  this.inputStatus.addEventListener(Messages.TOOL_APPLY, this.handleTool.bind(this));
  this.inputStatus.addEventListener(Messages.TOOL_CHANGED, function() { this._preview = null; }.bind(this));

  // And pauses
  this.inputStatus.addEventListener(Messages.SPEED_CHANGE, this.handlePause.bind(this));

  // Escape closes dialogs, or deselects the current tool
  this.inputStatus.addEventListener(Messages.ESCAPE_PRESSED, this.handleEscape.bind(this));

  // And date changes
  // XXX Not yet activated
  //this.simulation.addEventListener(Messages.DATE_UPDATED, this.onDateChange.bind(this));

  this.infoBar = InfoBar('cclass', 'population', 'score', 'funds', 'date', 'name');
  var initialValues;
  if (remote) {
    // The copy's evaluation holds the figures of the last yearly evaluation, not those of the heads-up display
    initialValues = controller.city.infoBarValues();
    initialValues.name = this.name;
  } else {
    initialValues = {
      classification: this.simulation.evaluation.cityClass,
      population: this.simulation.evaluation.cityPop,
      score: this.simulation.evaluation.cityScore,
      funds: this.simulation.budget.totalFunds,
      date: this.simulation.getDate(),
      name: this.name
    };
  }
  this._showInfoBar = this.infoBar(this.simulation, initialValues);

  this._notificationBar = new Notification('#notifications', this.gameCanvas, I18n.t(Text.messageText[Messages.WELCOME]));

  // The news ticker: how the city is doing, and jokes about what the mayor does
  this.tickerNews = new TickerNews(this.name);
  this.ticker = new Ticker('#ticker', function() {
    return this.tickerNews.next(this.simulation.getCityStatus());
  }.bind(this), function(x, y) {
    this.gameCanvas.centreOn(x, y);
  }.bind(this));

  this.congratsWindow = new CongratsWindow(opacityLayerID, 'congratsWindow');
  this.congratsWindow.addEventListener(Messages.CONGRATS_WINDOW_CLOSED, function() {
    this.genericDialogClosure();

    // Celebrate each milestone with fireworks
    this.ambientLife.celebrate(this.gameCanvas.getVisibleWorldRect());
  }.bind(this));

  // Unhide controls
  this.revealControls();

  // The minimap needs its container to be on screen
  this.minimap = new Minimap('minimapContainer', this.gameMap, this.simulation, this.gameCanvas, tileSet);

  // Decorative cars, people, boats, birds, smoke, clouds, and the cycle of day and night
  this.ambientLife = new AmbientLife(this.gameMap, this.simulation);
  this.ambientLife.setIsometric(this.gameCanvas.isIsometric());
  if (savedGame) {
    if (typeof(savedGame.disastersEnabled) === 'boolean')
      this.simulation.disasterManager.disastersEnabled = savedGame.disastersEnabled;
    if (typeof(savedGame.dayNight) === 'boolean')
      this.ambientLife.setDayNight(savedGame.dayNight);
    this.ambientLife.setTimeOfDay(savedGame.timeOfDay);
  } else if (remote) {
    if (controller.dayNight !== null)
      this.ambientLife.setDayNight(controller.dayNight);
    this.ambientLife.setTimeOfDay(controller.timeOfDay);
  }
  this._clockText = '';

  // Speed controls in the heads-up display
  var self = this;
  $('.speedButton').click(function(e) {
    e.preventDefault();
    self.setSpeed($(this).attr('data-speed') - 0);
  });
  this._updateSpeedButtons();

  // Keep the demand indicator crisp when the window changes size
  $(window).on('resize', function() { self.rci.update(); });

  // Everything shown changes language with the settings
  I18n.onChange(this.translate.bind(this));

  // Run the sim (a shared city runs on the server)
  this.tick = tick.bind(this);
  if (!remote)
    this.tick();

  // Paint the map
  var debug = Config.debug || Config.gameDebug;
  if (debug) {
    $('#debug').toggle();
    this.frameCount = 0;
    this.animStart = new Date();
    this.lastElapsed = -1;
  }

  this.commonAnimate = commonAnimate.bind(this);
  this.animate = (debug ? debugAnimate : this.commonAnimate).bind(this);
  this._lastFrameTime = null;
  nextFrame(this.animate);

  // Expose the game in debug mode, to help diagnose problems from the browser console
  if (Config.debug)
    window.kawaCity = this;

  if (remote)
    this._startRemote();

  // A scenario starts with its briefing. A shared city's shows each player, once, what they have not seen yet: the
  // briefing while the scenario runs, how it ended once it has.
  this._scenarioPanelText = null;
  var scenario = this.simulation.getScenario();
  var mode = null;
  if (scenario && Scenarios.get(scenario.id)) {
    if (remote)
      mode = this._unseenScenarioWindow(scenario);
    else if (savedGame && savedGame.scenarioBriefing)
      mode = ScenarioWindow.INTRO;
  }
  if (mode !== null) {
    this.dialogOpen = true;
    this._openWindow = 'scenarioWindow';
    this.scenarioWindow.open(mode, Scenarios.get(scenario.id), remote, remote ? scenario.scoreWait : undefined);
  }
}


// The window of a shared city's scenario this player has not seen yet in this browser (null if none), now seen
Game.prototype._unseenScenarioWindow = function(scenario) {
  var mode = !scenario.ended ? ScenarioWindow.INTRO : (scenario.won ? ScenarioWindow.WON : ScenarioWindow.LOST);
  var seen = scenario.id + (scenario.ended ? ':ended' : ':briefing');
  var key = 'kawacity.scenario.' + this.controller.cityInfo.id;
  try {
    if (window.localStorage.getItem(key) === seen)
      return null;
    window.localStorage.setItem(key, seen);
  } catch (err) {
    // Without storage, the window comes each time
  }
  return mode;
};


// The time is up for the scenario: the city has won, or the mayor is impeached
Game.prototype.handleScenarioEnded = function(data) {
  var scenario = Scenarios.get(data.id);
  if (!scenario)
    return;

  if (this.dialogOpen && this._openWindow && this[this._openWindow])
    this[this._openWindow].close();

  if (this.remote)
    this._unseenScenarioWindow({id: data.id, ended: true, won: data.won});

  this.dialogOpen = true;
  this._openWindow = 'scenarioWindow';
  this.scenarioWindow.open(data.won ? ScenarioWindow.WON : ScenarioWindow.LOST, scenario, this.remote);

  if (data.won)
    this.ambientLife.celebrate(this.gameCanvas.getVisibleWorldRect());
};


Game.prototype.handleScenarioWindowClosure = function(data) {
  this.genericDialogClosure();

  switch (data.action) {
    case ScenarioWindow.CONTINUE:
      // Free play from now on (a shared city's scenario ended on the server, for every player)
      if (!this.remote)
        this.simulation.endScenario();
      break;

    case ScenarioWindow.RETRY:
      // Start again from the title screen, which launches the scenario
      window.location.hash = 'scenario=' + data.scenario.id;
      window.location.reload();
      break;

    case ScenarioWindow.TITLE:
      window.location.hash = '';
      window.location.reload();
      break;
  }
};


// Keeps the scenario panel up to date: the goal, how the city is doing, and the time left
Game.prototype.updateScenarioPanel = function() {
  var scenarioState = this.simulation.getScenario();
  var scenario = scenarioState ? Scenarios.get(scenarioState.id) : null;
  if (!scenario || scenarioState.ended) {
    if (this._scenarioPanelText !== '') {
      this._scenarioPanelText = '';
      $('#scenarioPanel').addClass('hidden');
    }
    return;
  }

  var progress = this.simulation.getScenarioProgress();
  var wait = scenarioState.scoreWait;
  var years = Math.floor(wait / 48);
  var months = Math.floor((wait % 48) / 4);
  var timeLeft = I18n.t(years > 0 ? '{years}y {months}m left' : '{months}m left', {years: years, months: months});

  var label, fraction;
  switch (scenarioState.goal) {
    case Scenarios.GOAL_METROPOLIS:
      label = I18n.t('Population {n}', {n: I18n.formatNumber(progress.value)});
      fraction = progress.value / progress.target;
      break;

    case Scenarios.GOAL_TRAFFIC:
      label = I18n.t('Traffic {n}', {n: Math.round(progress.value)});
      fraction = progress.met ? 1 : progress.target / Math.max(progress.value, 1);
      break;

    case Scenarios.GOAL_CRIME:
      label = I18n.t('Crime {n}', {n: Math.round(progress.value)});
      fraction = progress.met ? 1 : progress.target / Math.max(progress.value, 1);
      break;

    default:
      label = I18n.t('Score {n}', {n: progress.value});
      fraction = progress.value / progress.target;
  }

  var text = [scenario.name, label, timeLeft, progress.met].join('|');
  if (text === this._scenarioPanelText)
    return;

  this._scenarioPanelText = text;
  $('#scenarioPanel').removeClass('hidden').toggleClass('met', progress.met);
  $('#scenarioPanelName').text(scenario.name);
  $('#scenarioPanelGoal').text(I18n.t(Scenarios.GOAL_TEXT[scenarioState.goal]));
  $('#scenarioPanelValue').text(label);
  $('#scenarioPanelTime').text(timeLeft);
  $('#scenarioPanelBar').css('width', Math.round(Math.min(1, Math.max(0, fraction)) * 100) + '%');
};


var milestones = ['_reachedTown', '_reachedCity', '_reachedCapital', '_reachedMetropolis', '_reachedMegalopolis'];


// Everything needed to restore the game
Game.prototype.getSaveData = function() {
  var saveData = {name: this.name};
  for (var i = 0; i < milestones.length; i++)
    saveData[milestones[i]] = this[milestones[i]];

  saveData.dayNight = this.ambientLife.dayNight;
  saveData.disastersEnabled = this.simulation.disasterManager.disastersEnabled;
  saveData.timeOfDay = this.ambientLife.getTimeOfDay();

  BaseTool.save(saveData);
  this.simulation.save(saveData);

  return saveData;
};


// Saves the game in the browser. Returns whether it worked
Game.prototype.save = function() {
  return Storage.saveGame(this.getSaveData());
};


// Note: the simulation loads its own state when it is constructed with the saved game
Game.prototype.load = function(saveData) {
  this.name = saveData.name || this.name;
  for (var i = 0; i < milestones.length; i++)
    this[milestones[i]] = !!saveData[milestones[i]];

  BaseTool.load(saveData);
};


var nextFrame =
  window.requestAnimationFrame ||
  window.mozRequestAnimationFrame ||
  window.webkitRequestAnimationFrame;


Game.prototype.revealControls = function() {
 $('.initialHidden').each(function(e) {
   $(this).removeClass('initialHidden');
 });

 this._notificationBar.news({subject: Messages.WELCOME});
 this.rci.update({residential: 750, commercial: 750, industrial: 750});
};


var genericDialogClosure = function() {
  this.dialogOpen = false;
  this._openWindow = null;
};


Game.prototype.onDateChange = function(date) {
  if (date.month === 10 && Random.getChance(10))
    this.gameCanvas.changeTileSet(this.snowTileSet);
  else if (date.month === 1)
    this.gameCanvas.changeTileSet(this.tileSet);
};


Game.prototype.handleDisasterWindowClosure = function(request) {
  this.dialogOpen = false;
  this.controller.applyDisaster(request);
};


// The window's choices, and what it showed when it opened (in a shared city, others may have changed the settings
// meanwhile: what the player left as it was is not sent back, see RemoteController)
Game.prototype.handleSettingsWindowClosure = function(actions) {
  this.dialogOpen = false;
  this.controller.applySettings(actions, this._windowShown);
};


// Switches between the isometric view and the view from above, at the same scale, and remembers the choice
Game.prototype.setIsometric = function(isometric) {
  IsoView.setPreferred(isometric);
  if (isometric === this.gameCanvas.isIsometric())
    return;

  // Switching back without zooming in between gives back the zoom the view had, which the scale can't when it
  // reached the most or least zoom
  var zoom = this.gameCanvas.getZoom();
  var last = this._viewSwitch;
  var target = isometric ? zoom / 2 : zoom * 2;
  if (last && last.isometric !== isometric && last.zoom === zoom)
    target = last.previous;

  this.gameCanvas.setIsometric(isometric);
  this.gameCanvas.setZoom(target);
  this._viewSwitch = {isometric: isometric, zoom: this.gameCanvas.getZoom(), previous: zoom};
  this.monsterTV.canvas.setIsometric(isometric);
  this.ambientLife.setIsometric(isometric);
};


// Signs or ends the deals chosen in the window of the neighbouring cities: [{side, kind, signed}]
Game.prototype.handleNeighboursWindowClosure = function(changes) {
  this.genericDialogClosure();
  this.controller.applyDeals(changes);
};


Game.prototype.handleDebugWindowClosure = function(actions) {
  this.dialogOpen = false;
  this.controller.applyDebug(actions);
};


// What the picture window needs (see ScreenshotWindow): how to take the picture, and the city's name and figures
Game.prototype.getPictureData = function() {
  var date = this.simulation.getDate();
  var population = this.simulation.getPopulation() || this.simulation.evaluation.cityPop;
  var details = [I18n.t(Text.cityClass[this.simulation.evaluation.classify(population)]),
                 I18n.t(Text.months[date.month]) + ' ' + date.year,
                 I18n.t('Population {n}', {n: I18n.formatNumber(population)})];

  return {
    take: function(area) {
      return this.gameCanvas.takePicture(area === 'visible');
    }.bind(this),
    caption: {name: this.name, details: details.join(' \u00b7 ')},
    fileName: CityPicture.fileName(this.name, date.year),
    shareText: I18n.t('My city, {city}, in KawaCity.', {city: this.name})
  };
};


Game.prototype.handleBudgetWindowClosure = function(data) {
  this.dialogOpen = false;
  this.controller.applyBudget(data, this._windowShown);
};


// Tells the ticker how the mayor changed the budget (data: the budget window's new values, in percent)
Game.prototype.recordBudgetChanges = function(data) {
  var budget = this.simulation.budget;
  var tax = data.taxPercent - 0;
  if (tax > budget.cityTax)
    this.tickerNews.record('taxUp');
  else if (tax < budget.cityTax)
    this.tickerNews.record('taxDown');

  var services = [['policeCut', data.policePercent, budget.policePercent],
                  ['fireCut', data.firePercent, budget.firePercent],
                  ['roadCut', data.roadPercent, budget.roadPercent]];
  services.forEach(function(service) {
    if (service[1] / 100 < service[2] && service[1] < 100)
      this.tickerNews.record(service[0]);
  }, this);
};


var makeWindowOpenHandler = function(winName, customFn) {
  customFn = customFn || null;

  return function() {
    if (this.dialogOpen) {
      console.warn('Request made to open ' + winName + ' window. There is a dialog open!');
      return;
    }

    this.dialogOpen = true;
    this._openWindow = winName + 'Window';
    var win = winName + 'Window';
    var data = [];

    try {
      if (customFn)
        data = customFn();

      this[win].open.apply(this[win], data);

      // A shared city's windows show only what the player's role may change
      if (this.remote)
        this._lockWindow(winName);
    } catch (e) {
      // A window that failed to open must not leave the game paused, as if it were open
      this.dialogOpen = false;
      this._openWindow = null;
      throw e;
    }
  };
};


Game.prototype.handleDebugRequest = makeWindowOpenHandler('debug');
Game.prototype.handleDisasterRequest = makeWindowOpenHandler('disaster');
// The query tool's panel doesn't stop the city: it is not a dialog
Game.prototype.handleQueryRequest = function() {
  this.queryWindow.open();
};


Game.prototype.handleMandatoryBudget = function() {
  this.simNeededBudget = true;
  this.handleBudgetRequest();
};


// The warning for a tool that can't act until the land is bulldozed: hint at the setting when it is off
var needsDozeText = LocalController.needsDozeText;


// Applies the current tool at each of the given placements in turn, stopping if we run out of money (or, in a shared
// city, asks the server to)
Game.prototype.handleTool = function(data) {
  this.controller.applyTool(data);
};


// Shows a text under the tools (a tool's result), or the current tool's name (text null)
Game.prototype.showToolOutput = function(text) {
  if (text === null)
    this._showToolLabel();
  else
    $('#toolOutput').text(text);
};


Game.prototype._showToolLabel = function() {
  $('#toolOutput').text(I18n.t($('.toolButton.selected').attr('data-label') || 'Tools'));
};


// Works out what applying the current tool at the given placements would do, without changing the map
Game.prototype._simulateTool = function(tool, placements) {
  var effects = tool._worldEffects;
  var blockMaps = this.simulation.blockMaps;
  var results = [];

  tool.clear();
  if (tool.startBatch)
    tool.startBatch(placements.length);

  for (var i = 0, l = placements.length; i < l; i++) {
    var p = placements[i];

    // Snapshot the pending effects, so that a failed placement leaves no trace (as it would when applied)
    var snapshot = Object.assign({}, effects._data);
    var cost = tool._applicationCost;

    tool.doTool(p.x, p.y, blockMaps);
    results.push(tool.result);

    if (tool.result !== tool.TOOLRESULT_OK) {
      effects._data = snapshot;
      tool._applicationCost = cost;
    }
  }

  var totalCost = tool._applicationCost;
  var demolished = tool.getDemolished ? tool.getDemolished() : [];
  tool.clear();
  if (tool.endBatch)
    tool.endBatch();

  return {results: results, cost: totalCost, demolished: demolished};
};


// Computes the overlay showing where the current tool will act, its validity and cost
Game.prototype.computeOverlay = function() {
  var pending = this.inputStatus.getPendingPlacements();
  if (pending === null)
    return null;

  var toolName = this.inputStatus.toolName;
  var tool = this.inputStatus.currentTool;
  var placements = pending.placements;
  var size = this.inputStatus.toolWidth;
  var colour = this.inputStatus.toolColour;
  var category = InputStatus.getToolCategory(toolName);

  // Simulating is relatively costly: only recompute when something changes, or periodically as the map evolves
  var key = toolName + ':' + placements.map(function(p) { return p.x + ',' + p.y; }).join(';');
  var now = Date.now();
  var preview = this._preview;
  if (preview === null || preview.key !== key || now - preview.time > 250) {
    var simulated = category === InputStatus.TOOL_SINGLE ? {results: [tool.TOOLRESULT_OK], cost: 0, demolished: []} :
                    this._simulateTool(tool, placements);
    preview = this._preview = {key: key, time: now, results: simulated.results, cost: simulated.cost,
                               demolished: simulated.demolished};
  }

  var rects = [];
  var anySucceeded = false;
  var needsBulldoze = false;
  var offset = size > 2 ? 1 : 0;

  for (var i = 0, l = placements.length; i < l; i++) {
    var ok = preview.results[i] === tool.TOOLRESULT_OK;
    anySucceeded = anySucceeded || ok;
    needsBulldoze = needsBulldoze || preview.results[i] === tool.TOOLRESULT_NEEDS_BULLDOZE;

    // When bulldozing or planting an area, tiles where there is nothing to do are simply left unmarked
    if (!ok && category === InputStatus.TOOL_AREA && (pending.dragging || pending.brush > 1))
      continue;

    rects.push({x: placements[i].x - offset, y: placements[i].y - offset, width: size, height: size,
                colour: colour, valid: ok});
  }

  // The whole of the buildings that the bulldozer would demolish
  var marked = new Set(rects.map(function(r) { return r.x + ',' + r.y; }));
  preview.demolished.forEach(function(tile) {
    if (!marked.has(tile.x + ',' + tile.y))
      rects.push({x: tile.x, y: tile.y, width: 1, height: 1, colour: colour, valid: true});
  });

  // The outline of a brush wider than a tile, under the pointer
  if (pending.brush > 1) {
    var reach = Math.floor((pending.brush - 1) / 2);
    rects.push({x: pending.centre.x - reach, y: pending.centre.y - reach, width: pending.brush, height: pending.brush,
                colour: colour, outline: true});
  }

  var last = placements[placements.length - 1];
  var label = null;
  var funds = this.simulation.budget.totalFunds;

  if (category !== InputStatus.TOOL_SINGLE && last !== undefined) {
    if (!anySucceeded && needsBulldoze)
      label = {text: needsDozeText(), valid: false};
    else if (preview.cost > funds)
      label = {text: I18n.t('{cost} (not enough funds)', {cost: I18n.money(preview.cost)}), valid: false};
    else if (anySucceeded && preview.cost > 0)
      label = {text: I18n.money(preview.cost), valid: true};

    if (label !== null) {
      label.x = last.x - offset + size - 1;
      label.y = last.y - offset;
    }
  }

  return {rects: rects, label: label};
};


Game.prototype.handleSave = function() {
  this.controller.save();
};


Game.prototype.handlePause = function() {
  if (this.dialogOpen)
    return;

  this.controller.togglePause();
};


// Sets the running speed (resuming the game if it was paused)
Game.prototype.setSpeed = function(speed) {
  this.controller.setSpeed(speed);
};


Game.prototype._updateSpeedButtons = function() {
  $('#pauseRequest').text(I18n.t(this.isPaused ? 'Play' : 'Pause')).toggleClass('paused', this.isPaused);

  var current = this.isPaused ? -1 : this.defaultSpeed;
  $('.speedButton').each(function() {
    var active = ($(this).attr('data-speed') - 0) === current;
    $(this).toggleClass('active', active).attr('aria-pressed', active ? 'true' : 'false');
  });
};


// Shows everything again in the new language (the page's own texts are translated by I18n)
Game.prototype.translate = function() {
  this._showInfoBar();
  ToolIcons.labelToolButtons();
  Toolbar.refresh(this.inputStatus.toolName);
  this._showToolLabel();
  this._updateSpeedButtons();
  this.minimap.translate();
  this.rci.update();
  this._scenarioPanelText = null;
  this._preview = null;
  this.ticker.reset();

  if (this.remote) {
    this._labelSaveButton();
    this.controller.translate();
  }
};


Game.prototype.handleEscape = function() {
  // Close the menus first, if one is open
  if (InputStatus.toggleMoreMenu(false) || Toolbar.closeFlyout())
    return;

  // A lost scenario can't be escaped (but in a shared city, which carries on)
  if (this._openWindow === 'scenarioWindow' && this.scenarioWindow.mode === ScenarioWindow.LOST && !this.remote)
    return;

  // InputStatus doesn't know what dialogs are showing, so we must handle escape here
  if (this.dialogOpen) {
    var win = this[this._openWindow];
    this.dialogOpen = false;
    this._openWindow = null;
    win.close();
  } else if (this.queryWindow.isOpen()) {
    this.queryWindow.close();
  } else {
    this.inputStatus.clearTool();
  }
};


Game.prototype.processFrontEndMessage = function(message) {
  var subject = message.subject;
  var d = new Date();

  this.tickerNews.report(subject, message.data);

  if (Text.goodMessages[subject] !== undefined) {
    var cMessage = null;

    switch (subject) {
      case Messages.REACHED_CAPITAL:
        if (!this._reachedCapital) {
          this._reachedCapital = true;
          cMessage = '{city} is now a capital!';
        }
        break;

      case Messages.REACHED_CITY:
        if (!this._reachedCity) {
          this._reachedCity = true;
          cMessage = '{city} is now a city!';
        }
        break;

      case Messages.REACHED_MEGALOPOLIS:
        if (!this._reachedMegalopolis) {
          this._reachedMegalopolis = true;
          cMessage = '{city} is now a megalopolis!';
        }
        break;

      case Messages.REACHED_METROPOLIS:
        if (!this._reachedMetropolis) {
          this._reachedMetropolis = true;
          cMessage = '{city} is now a metropolis!';
        }
        break;

      case Messages.REACHED_TOWN:
        if (!this._reachedTown) {
          this._reachedTown = true;
          cMessage = '{city} is now a town!';
        }
        break;
    }

    if (this.lastBadMessageTime === null || d - this.lastBadMessageTime > disasterTimeout) {
      this.lastBadMessageTime = null;
      this._notificationBar.goodNews(message);
    }

    if (cMessage !== null) {
      this._congrats.push(I18n.t(cMessage, {city: this.name}));
      this.showCongrats();
    }

    return;
  }

  // The ground shakes for longer in a stronger earthquake
  if (subject === Messages.EARTHQUAKE)
    this.gameCanvas.shoogle(4, 1500 + (message.data && message.data.strength ? message.data.strength * 3 : 1500));

  // Show disaster if applicable
  if (message.data) {
    if (message.data.showable)
    this.monsterTV.show(message.data.x, message.data.y);
    else if (message.data.trackable)
    this.monsterTV.track(message.data.x, message.data.y, message.data.sprite);
  }

  if (Text.badMessages[subject] !== undefined) {
    this._notificationBar.badNews(message);
    if (Messages.DISASTER_MESSAGES.indexOf(message.subject) !== -1)
      this.lastBadMessageTime = d;
    return;
  }

  if (Text.neutralMessages[subject] !== undefined) {
    if (this.lastBadMessageTime === null || d - this.lastBadMessageTime > disasterTimeout) {
      this.lastBadMessageTime = null;
      this._notificationBar.news(message);
    }
    return;
  }

  console.warn('Unexpected message: ', subject);
};


// Shows the time of day in the heads-up display (a day starts at 6 in the morning)
Game.prototype.updateClock = function() {
  var text = '';
  if (this.ambientLife.dayNight) {
    var minutes = Math.floor((6 * 60 + this.ambientLife.getTimeOfDay() * 24 * 60) % (24 * 60));
    // Only show whole quarters of an hour, so the clock does not flicker
    minutes -= minutes % 15;
    var hours = Math.floor(minutes / 60);
    text = (hours < 10 ? '0' : '') + hours + ':' + (minutes % 60 < 10 ? '0' : '') + (minutes % 60);
  }

  if (text !== this._clockText) {
    this._clockText = text;
    $('#clock').text(text);
    $('#clockStat').toggleClass('hidden', text === '');
  }
};


// --- A shared city (see RemoteController) ---

// The controls follow the player's role, the save button downloads a copy of the city, the power overlay is read
// from the tiles, and the players panel appears
Game.prototype._startRemote = function() {
  var self = this;
  var city = this.controller.city;

  this.inputStatus.clampToMap = true;
  this.inputStatus.isToolAllowed = function(toolName) {
    return toolName === 'query' || self.controller.can('build');
  };
  this.minimap.setPowerSource(city.poweredTiles.bind(city));

  $('#scenarioPanel').addClass('hidden');
  $('#saveRequest').prop('disabled', false);
  this._labelSaveButton();

  this.controller.attach(this);
  this.applyRole();
};


Game.prototype._labelSaveButton = function() {
  var label = I18n.t('Download a copy');
  $('#saveRequest').attr('title', label).children('[data-i18n]').text(label);
};


// Disables the controls the player's role does not allow (see RemoteController.can), and puts down a tool it does
// not allow
Game.prototype.applyRole = function() {
  var controller = this.controller;
  var build = controller.can('build');

  $('.toolButton').each(function() {
    $(this).prop('disabled', !build && $(this).attr('data-tool') !== 'query');
  });
  $('.categoryButton').prop('disabled', !build);
  if (!build) {
    Toolbar.closeFlyout();
    if (this.inputStatus.toolName !== null && this.inputStatus.toolName !== 'query')
      this.inputStatus.clearTool();
  }

  $('#pauseRequest, .speedButton').prop('disabled', !controller.can('speed'));
  $('#disasterRequest').prop('disabled', !controller.can('disasters'));
  $('#debugRequest').prop('disabled', true);
};


// A window of a shared city that opened: what the role may not change is read only
Game.prototype._lockWindow = function(winName) {
  var controller = this.controller;

  switch (winName) {
    case 'budget':
      $('#roadRate, #fireRate, #policeRate, #taxRate, #budgetReset').prop('disabled', !controller.can('budget'));
      break;

    case 'settings':
      $('#autoBudgetSelect, #autoBulldozeSelect, #levelSelect').prop('disabled', !controller.can('settings'));
      $('#speedSelect').prop('disabled', !controller.can('speed'));
      $('#disastersSelect').prop('disabled', !controller.can('disasters'));
      break;

    case 'neighbours':
      $('#neighboursList .dealToggle').prop('disabled', !controller.can('deals'));
      break;
  }
};


// The city's speed and pause, as the server last said
Game.prototype.refreshSpeed = function() {
  this.defaultSpeed = this.controller.city.speed;
  this.isPaused = this.controller.city.paused;
  this._updateSpeedButtons();
};


// The city has a new name
Game.prototype.setCityName = function(name) {
  this.name = name;
  this._showInfoBar.set('name', name);
  this.tickerNews.setCityName(name);
};


// Shows a text in the notification bar (kind: 'good', 'bad' or 'neutral')
Game.prototype.notify = function(text, kind) {
  this._notificationBar.showText(text, kind);
};


// The same, doing something when clicked
Game.prototype.notifyAction = function(text, kind, action) {
  this._notificationBar.showAction(text, kind, action);
};


Game.prototype.calculateSpritesForPaint = function(canvas) {
  var rect = canvas.getVisibleWorldRect();
  var tileSize = GameCanvas.TILE_SIZE;

  // Include a margin, so that sprites partially in view are painted
  var startX = Math.floor(rect.x / tileSize) - 3;
  var startY = Math.floor(rect.y / tileSize) - 3;
  var width = rect.width + 7 * tileSize;
  var height = rect.height + 7 * tileSize;
  var spriteList = this.simulation.spriteManager.getSpritesInView(startX, startY, width, height);

  if (spriteList.length === 0)
    return null;

  return spriteList;
};


// Opens the congratulations that wait, one at a time, once no other window is open. A shared city's messages come
// whatever the player is doing (the server's city does not stop for a window): opened over another window, they would
// mix up which one shows (see ModalWindow), so they wait for it to close (see commonAnimate).
Game.prototype.showCongrats = function() {
  if (this.dialogOpen || this._congrats.length === 0)
    return;

  this.dialogOpen = true;
  this._openWindow = 'congratsWindow';
  this.congratsWindow.open(this._congrats.shift());
};


// Runs the simulation. This is independent of painting, so that the simulation speed does not depend on the
// display's frame rate.
var tick = function() {
  var delay = 50;

  if (!this.dialogOpen && !this.simulation.isPaused() && !$('#tooSmall').is(':visible')) {
    this.simulation.simTick();
    delay = Math.max(1, this.simulation.timeUntilNextStep());
  }

  window.setTimeout(this.tick, delay);
};


var commonAnimate = function(timestamp) {
  var elapsed = this._lastFrameTime === null ? 0 : timestamp - this._lastFrameTime;
  this._lastFrameTime = timestamp;

  this.inputStatus.update(elapsed);
  this.showCongrats();

  // Trains, ships, planes, monsters and tornadoes move 60 times a second, whatever the display's refresh rate. A
  // shared city's move on the server: they are drawn between the last positions it sent.
  if (this.remote) {
    this.controller.animate(performance.now());
  } else if (!this.isPaused && !this.dialogOpen) {
    this._spriteTime = Math.min((this._spriteTime || 0) + elapsed, SPRITE_STEP * 4);
    while (this._spriteTime >= SPRITE_STEP) {
      this.simulation.spriteManager.moveObjects(this.simulation._constructSimData());
      this._spriteTime -= SPRITE_STEP;
    }
  }

  // Run this even when paused: you can still build when paused. A shared city also shows the other players' pointers.
  this.overlay = this.computeOverlay();
  if (this.remote)
    this.overlay = this.controller.decorateOverlay(this.overlay, performance.now());

  this.minimap.paint();
  this.ambientLife.update(elapsed, this.gameCanvas.getVisibleWorldRect(),
                         !this.isPaused && (this.remote || !this.dialogOpen));
  this.updateClock();
  this.updateScenarioPanel();
  this.ticker.update(elapsed);

  var sprites = this.calculateSpritesForPaint(this.gameCanvas);
  this.gameCanvas.paint(this.overlay, sprites, this.isPaused, this.minimap.getOverlayCanvas(), this.ambientLife);

  if (this.monsterTV.isOpen) {
    sprites = this.calculateSpritesForPaint(this.monsterTV.canvas);
    this.monsterTV.paint(sprites, this.isPaused);
  }

  nextFrame(this.animate);
};


var debugAnimate = function(timestamp) {
  var date = new Date();
  var elapsed = Math.floor((date - this.animStart) / 1000);

  if (elapsed > 0 && elapsed > this.lastElapsed && this.frameCount > 0) {
    $('#fpsValue').text(Math.floor(this.frameCount/elapsed));
    this.lastElapsed = elapsed;
  }

  this.frameCount++;
  this.commonAnimate(timestamp);
};


export { Game };
