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
import { Config } from './config.js';
import { CongratsWindow } from './congratsWindow.js';
import { DebugWindow } from './debugWindow.js';
import { DisasterWindow } from './disasterWindow.js';
import { EvaluationWindow } from './evaluationWindow.js';
import { GraphsWindow } from './graphsWindow.js';
import { Scenarios } from './scenarios.js';
import { ScenarioWindow } from './scenarioWindow.js';
import { GameCanvas } from './gameCanvas.js';
import { GameMap } from './gameMap.js';
import { InfoBar } from './infoBar.js';
import { InputStatus } from './inputStatus.js';
import * as Messages from './messages.ts';
import { MonsterTV } from './monsterTV.js';
import { NagWindow } from './nagWindow.js';
import { Notification } from './notification.js';
import { QueryWindow } from './queryWindow.js';
import { Random } from './random.ts';
import { RCI } from './rci.js';
import { SaveWindow } from './saveWindow.js';
import { ScreenshotLinkWindow } from './screenshotLinkWindow.js';
import { ScreenshotWindow } from './screenshotWindow.js';
import { SettingsWindow } from './settingsWindow.js';
import { Simulation } from './simulation.js';
import { Storage } from './storage.js';
import { Text } from './text.js';
import { AmbientLife } from './ambientLife.js';
import { Minimap } from './minimap.js';
import { ToolIcons } from './toolIcons.js';
import { Toolbar } from './toolbar.js';

var disasterTimeout = 20 * 1000;

// How often sprites move, in milliseconds
var SPRITE_STEP = 1000 / 60;


function Game(gameMap, tileSet, snowTileSet, spriteSheet, difficulty, name) {
  difficulty = difficulty || 0;
  var savedGame;

  if (!gameMap.isSavedGame) {
    this.gameMap = gameMap;
    savedGame = null;
  } else {
    this.gameMap = new GameMap(120, 100);
    savedGame = gameMap;
  }

  this.tileSet = tileSet;
  this.snowTileSet = snowTileSet;
  this.defaultSpeed = Simulation.SPEED_MED;
  this.simulation = new Simulation(this.gameMap, difficulty, this.defaultSpeed, savedGame);

  this.name = name || 'MyTown';
  this.everClicked = false;

  // Track when various milestones are first reached
  this._reachedTown = this._reachedCity = this._reachedCapital = this._reachedMetropolis = this._reachedMegalopolis = false;

  if (savedGame)
    this.load(savedGame);

  // A game saved while paused should not resume paused: the controls always start in the running state
  if (this.simulation.isPaused())
    this.simulation.setSpeed(this.defaultSpeed);
  else
    this.defaultSpeed = this.simulation._speed;

  this.rci = new RCI('RCIContainer', this.simulation);

  // Note: must init canvas before inputStatus
  this.gameCanvas = new GameCanvas('canvasContainer');
  this.gameCanvas.init(this.gameMap, this.tileSet, spriteSheet);

  // Modern screens are large: start zoomed in when there is room
  if (this.gameCanvas.cssWidth >= 1000 && this.gameCanvas.cssHeight >= 600)
    this.gameCanvas.setZoom(2);
  this.gameCanvas.centreOn(Math.floor(this.gameMap.width / 2), Math.floor(this.gameMap.height / 2));

  // The tool bar: categories, and their palettes of tools
  Toolbar.build();
  ToolIcons.decorateToolButtons(tileSet);
  this.inputStatus = new InputStatus(this.gameMap, this.gameCanvas);
  Toolbar.bind(this.inputStatus.selectTool.bind(this.inputStatus));
  Toolbar.refresh(null);
  this.inputStatus.addEventListener(Messages.TOOL_CHANGED, function(toolName) {
    Toolbar.refresh(toolName);
  });

  this.dialogOpen = false;
  this._openWindow = null;
  this.overlay = null;
  this._preview = null;
  this.simNeededBudget = false;
  this.isPaused = false;
  this.lastBadMessageTime = null;

  // Map input is ignored while a dialog is open
  this.inputStatus.isBlocked = function() {
    return this.dialogOpen;
  }.bind(this);

  var self = this;
  if (!this.everClicked) {
    this.nagger = window.setTimeout(function() {
      self.dialogOpen = true;
      self._openWindow = 'nagWindow';
      self.nagWindow.open();
    }, 30 * 60 * 1000);

    $('.nag').each(function() {
      $(this).click(function(e) {
        if (self.nagger !== null) {
          window.clearTimeout(self.nagger);
        self.nagger = null;
        self.everClicked = true;
      }

      return true;
      });
    });
  }

  // Initialise monsterTV
  this.monsterTV = new MonsterTV(this.gameMap, tileSet, spriteSheet, null);

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
    return [{census: this.simulation.getCensus(), cityTime: this.simulation.getCityTime(),
             startingYear: this.simulation.getStartingYear()}];
  }.bind(this));

  this.graphsWindow = new GraphsWindow(opacityLayerID, 'graphsWindow');
  this.graphsWindow.addEventListener(Messages.GRAPHS_WINDOW_CLOSED, this.genericDialogClosure);
  this.inputStatus.addEventListener(Messages.GRAPHS_REQUESTED, this.handleGraphsRequest.bind(this));

  // ... and similarly for the budget window
  this.handleBudgetRequest = makeWindowOpenHandler('budget', function() {
    var budgetData = {
      roadMaintenanceBudget: this.simulation.budget.roadMaintenanceBudget,
      roadRate: Math.floor(this.simulation.budget.roadPercent * 100),
      fireMaintenanceBudget: this.simulation.budget.fireMaintenanceBudget,
      fireRate: Math.floor(this.simulation.budget.firePercent * 100),
      policeMaintenanceBudget: this.simulation.budget.policeMaintenanceBudget,
      policeRate: Math.floor(this.simulation.budget.policePercent * 100),
      taxRate: this.simulation.budget.cityTax,
      totalFunds: this.simulation.budget.totalFunds,
      taxesCollected: this.simulation.budget.taxFund
    };

    return [budgetData];
  }.bind(this));

  this.budgetWindow = new BudgetWindow(opacityLayerID, 'budget');
  this.budgetWindow.addEventListener(Messages.BUDGET_WINDOW_CLOSED, this.handleBudgetWindowClosure.bind(this));
  this.inputStatus.addEventListener(Messages.BUDGET_REQUESTED, this.handleBudgetRequest.bind(this));

  // ... and also the disaster window
  this.disasterWindow = new DisasterWindow(opacityLayerID, 'disasterWindow');
  this.disasterWindow.addEventListener(Messages.DISASTER_WINDOW_CLOSED, this.handleDisasterWindowClosure.bind(this));
  this.inputStatus.addEventListener(Messages.DISASTER_REQUESTED, this.handleDisasterRequest.bind(this));

  // ... the debug window
  this.debugWindow = new DebugWindow(opacityLayerID, 'debugWindow');
  this.debugWindow.addEventListener(Messages.DEBUG_WINDOW_CLOSED, this.handleDebugWindowClosure.bind(this));
  this.inputStatus.addEventListener(Messages.DEBUG_WINDOW_REQUESTED, this.handleDebugRequest.bind(this));

  // ... the settings window
  this.handleSettingsRequest = makeWindowOpenHandler('settings', function() {
    return [{autoBudget: this.simulation.budget.autoBudget, autoBulldoze: BaseTool.getAutoBulldoze(),
             speed: this.defaultSpeed, disasters: this.simulation.disasterManager.disastersEnabled,
             dayNight: this.ambientLife.dayNight, level: this.simulation.getLevel()}];
  }.bind(this));
  this.settingsWindow = new SettingsWindow(opacityLayerID, 'settingsWindow');
  this.settingsWindow.addEventListener(Messages.SETTINGS_WINDOW_CLOSED, this.handleSettingsWindowClosure.bind(this));
  this.inputStatus.addEventListener(Messages.SETTINGS_WINDOW_REQUESTED, this.handleSettingsRequest.bind(this));

  // ... the screenshot window
  this.screenshotWindow = new ScreenshotWindow(opacityLayerID, 'screenshotWindow');
  this.screenshotWindow.addEventListener(Messages.SCREENSHOT_WINDOW_CLOSED, this.handleScreenshotWindowClosure.bind(this));
  this.inputStatus.addEventListener(Messages.SCREENSHOT_WINDOW_REQUESTED, this.handleScreenshotRequest.bind(this));

  // ... the screenshot link window
  this.screenshotLinkWindow = new ScreenshotLinkWindow(opacityLayerID, 'screenshotLinkWindow');
  this.screenshotLinkWindow.addEventListener(Messages.SCREENSHOT_LINK_CLOSED, this.genericDialogClosure);

  // ... the save confirmation window
  this.saveWindow = new SaveWindow(opacityLayerID, 'saveWindow');
  this.saveWindow.addEventListener(Messages.SAVE_WINDOW_CLOSED, this.genericDialogClosure);

  // ... the nag confirmation window
  this.nagWindow = new NagWindow(opacityLayerID, 'nagWindow');
  this.nagWindow.addEventListener(Messages.NAG_WINDOW_CLOSED, this.genericDialogClosure);

  // ... the scenario window: the briefing, and the outcome
  this.scenarioWindow = new ScenarioWindow(opacityLayerID, 'scenarioWindow');
  this.scenarioWindow.addEventListener(Messages.SCENARIO_WINDOW_CLOSED, this.handleScenarioWindowClosure.bind(this));
  this.simulation.addEventListener(Messages.SCENARIO_ENDED, this.handleScenarioEnded.bind(this));

  // ... and finally the query window
  this.queryWindow = new QueryWindow(opacityLayerID, 'queryWindow');
  this.queryWindow.addEventListener(Messages.QUERY_WINDOW_CLOSED, this.genericDialogClosure);
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
  var initialValues = {
    classification: this.simulation.evaluation.cityClass,
    population: this.simulation.evaluation.cityPop,
    score: this.simulation.evaluation.cityScore,
    funds: this.simulation.budget.totalFunds,
    date: this.simulation.getDate(),
    name: this.name
  };
  this.infoBar(this.simulation, initialValues);

  this._notificationBar = new Notification('#notifications', this.gameCanvas, Text.messageText[Messages.WELCOME]);

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
  if (savedGame) {
    if (typeof(savedGame.disastersEnabled) === 'boolean')
      this.simulation.disasterManager.disastersEnabled = savedGame.disastersEnabled;
    if (typeof(savedGame.dayNight) === 'boolean')
      this.ambientLife.setDayNight(savedGame.dayNight);
    this.ambientLife.setTimeOfDay(savedGame.timeOfDay);
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

  // Run the sim
  this.tick = tick.bind(this);
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

  // A scenario starts with its briefing
  this._scenarioPanelText = null;
  var scenario = this.simulation.getScenario();
  if (scenario && savedGame && savedGame.scenarioBriefing && Scenarios.get(scenario.id)) {
    this.dialogOpen = true;
    this._openWindow = 'scenarioWindow';
    this.scenarioWindow.open(ScenarioWindow.INTRO, Scenarios.get(scenario.id));
  }
}


// The time is up for the scenario: the city has won, or the mayor is impeached
Game.prototype.handleScenarioEnded = function(data) {
  var scenario = Scenarios.get(data.id);
  if (!scenario)
    return;

  if (this.dialogOpen && this._openWindow && this[this._openWindow])
    this[this._openWindow].close();

  this.dialogOpen = true;
  this._openWindow = 'scenarioWindow';
  this.scenarioWindow.open(data.won ? ScenarioWindow.WON : ScenarioWindow.LOST, scenario);

  if (data.won)
    this.ambientLife.celebrate(this.gameCanvas.getVisibleWorldRect());
};


Game.prototype.handleScenarioWindowClosure = function(data) {
  this.genericDialogClosure();

  switch (data.action) {
    case ScenarioWindow.CONTINUE:
      // Free play from now on
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
  var timeLeft = (years > 0 ? years + 'y ' : '') + months + 'm left';

  var label, fraction;
  switch (scenarioState.goal) {
    case Scenarios.GOAL_METROPOLIS:
      label = 'Population ' + progress.value.toLocaleString('en-US');
      fraction = progress.value / progress.target;
      break;

    case Scenarios.GOAL_TRAFFIC:
      label = 'Traffic ' + Math.round(progress.value);
      fraction = progress.met ? 1 : progress.target / Math.max(progress.value, 1);
      break;

    case Scenarios.GOAL_CRIME:
      label = 'Crime ' + Math.round(progress.value);
      fraction = progress.met ? 1 : progress.target / Math.max(progress.value, 1);
      break;

    default:
      label = 'Score ' + progress.value;
      fraction = progress.value / progress.target;
  }

  var text = [scenario.name, label, timeLeft, progress.met].join('|');
  if (text === this._scenarioPanelText)
    return;

  this._scenarioPanelText = text;
  $('#scenarioPanel').removeClass('hidden').toggleClass('met', progress.met);
  $('#scenarioPanelName').text(scenario.name);
  $('#scenarioPanelGoal').text(Scenarios.GOAL_TEXT[scenarioState.goal]);
  $('#scenarioPanelValue').text(label);
  $('#scenarioPanelTime').text(timeLeft);
  $('#scenarioPanelBar').css('width', Math.round(Math.min(1, Math.max(0, fraction)) * 100) + '%');
};


var milestones = ['_reachedTown', '_reachedCity', '_reachedCapital', '_reachedMetropolis', '_reachedMegalopolis'];


// Everything needed to restore the game
Game.prototype.getSaveData = function() {
  var saveData = {name: this.name, everClicked: this.everClicked};
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
  this.everClicked = !!saveData.everClicked;
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

  if (request === DisasterWindow.DISASTER_NONE)
    return;

  switch (request) {
    case DisasterWindow.DISASTER_MONSTER:
      this.simulation.spriteManager.makeMonster();
      break;

    case DisasterWindow.DISASTER_FIRE:
      this.simulation.disasterManager.makeFire();
      break;

    case DisasterWindow.DISASTER_FLOOD:
      this.simulation.disasterManager.makeFlood();
      break;

    case DisasterWindow.DISASTER_CRASH:
      this.simulation.disasterManager.makeCrash();
      break;

    case DisasterWindow.DISASTER_MELTDOWN:
      this.simulation.disasterManager.makeMeltdown();
      break;

    case DisasterWindow.DISASTER_TORNADO:
      this.simulation.spriteManager.makeTornado();
      break;

    case DisasterWindow.DISASTER_EARTHQUAKE:
      this.simulation.disasterManager.makeEarthquake();
      break;
  }
};


Game.prototype.handleSettingsWindowClosure = function(actions) {
  this.dialogOpen = false;

  for (var i = 0, l = actions.length; i < l; i++) {
    var a = actions[i];

    switch (a.action) {
      case SettingsWindow.AUTOBUDGET:
        this.simulation.budget.setAutoBudget(a.data);
        break;

      case SettingsWindow.AUTOBULLDOZE:
        BaseTool.setAutoBulldoze(a.data);
        break;

      case SettingsWindow.SPEED:
        this.setSpeed(a.data - 0);
        break;

      case SettingsWindow.DISASTERS_CHANGED:
        this.simulation.disasterManager.disastersEnabled = a.data;
        break;

      case SettingsWindow.DAY_NIGHT:
        this.ambientLife.setDayNight(a.data);
        break;

      case SettingsWindow.LEVEL:
        this.simulation.changeLevel(a.data);
        break;

      default:
        console.warn('Unexpected action', a);
    }
  }
};


Game.prototype.handleDebugWindowClosure = function(actions) {
  this.dialogOpen = false;

  for (var i = 0, l = actions.length; i < l; i++) {
    var a = actions[i];

    switch (a.action) {
      case DebugWindow.ADD_FUNDS:
        this.simulation.budget.spend(-20000);
        break;

      default:
        console.warn('Unexpected action', a);
    }
  }
};


Game.prototype.handleScreenshotWindowClosure = function(action) {
  this.dialogOpen = false;

  if (action === null)
    return;

  var dataURI;
  if (action === ScreenshotWindow.SCREENSHOT_VISIBLE)
    dataURI = this.gameCanvas.screenshotVisible();
  else if (action === ScreenshotWindow.SCREENSHOT_ALL)
    dataURI = this.gameCanvas.screenshotMap();

  this.dialogOpen = true;
  this._openWindow = 'screenshotLinkWindow';
  this.screenshotLinkWindow.open(dataURI);
};


Game.prototype.handleBudgetWindowClosure = function(data) {
  this.dialogOpen = false;

  if (!data.cancelled) {
    this.simulation.budget.roadPercent = data.roadPercent / 100;
    this.simulation.budget.firePercent = data.firePercent / 100;
    this.simulation.budget.policePercent = data.policePercent / 100;
    this.simulation.budget.setTax(data.taxPercent - 0);
  }

  // The simulation waits for the yearly budget to be confirmed: it must be completed even if the player cancels
  // the window, keeping the existing values, or the simulation would stay frozen
  if (this.simNeededBudget) {
    this.simulation.budget.doBudgetWindow();
    this.simNeededBudget = false;
  } else if (!data.cancelled) {
    this.simulation.budget.updateFundEffects();
  }
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

    if (customFn)
      data = customFn();

    this[win].open.apply(this[win], data);
  };
};


Game.prototype.handleDebugRequest = makeWindowOpenHandler('debug');
Game.prototype.handleDisasterRequest = makeWindowOpenHandler('disaster');
Game.prototype.handleQueryRequest = makeWindowOpenHandler('query');
Game.prototype.handleScreenshotRequest = makeWindowOpenHandler('screenshot');


Game.prototype.handleMandatoryBudget = function() {
  this.simNeededBudget = true;
  this.handleBudgetRequest();
};


// The warning for a tool that can't act until the land is bulldozed: hint at the setting when it is off
var needsDozeText = function() {
  return BaseTool.getAutoBulldoze() ? Text.toolMessages.needsDoze : Text.toolMessages.needsDozeManual;
};


// Applies the current tool at each of the given placements in turn, stopping if we run out of money
Game.prototype.handleTool = function(data) {
  var tool = this.inputStatus.gameTools[data.toolName];
  if (tool === undefined || this.dialogOpen)
    return;

  var budget = this.simulation.budget;
  var blockMaps = this.simulation.blockMaps;
  var placements = data.placements;
  var succeeded = 0;
  var failure = null;

  if (tool.startBatch)
    tool.startBatch();

  for (var i = 0, l = placements.length; i < l; i++) {
    var p = placements[i];
    tool.doTool(p.x, p.y, blockMaps);

    if (tool.modifyIfEnoughFunding(budget)) {
      succeeded++;
      continue;
    }

    if (tool.result === tool.TOOLRESULT_NO_MONEY) {
      failure = tool.result;
      break;
    }

    if (failure === null)
      failure = tool.result;
  }

  if (tool.endBatch)
    tool.endBatch();

  this._preview = null;

  if (failure === tool.TOOLRESULT_NO_MONEY)
    $('#toolOutput').text(Text.toolMessages.noMoney);
  else if (succeeded === 0 && failure === tool.TOOLRESULT_NEEDS_BULLDOZE)
    $('#toolOutput').text(needsDozeText());
  else
    $('#toolOutput').text($('.toolButton.selected').attr('data-label') || 'Tools');
};


// Works out what applying the current tool at the given placements would do, without changing the map
Game.prototype._simulateTool = function(tool, placements) {
  var effects = tool._worldEffects;
  var blockMaps = this.simulation.blockMaps;
  var results = [];

  tool.clear();
  if (tool.startBatch)
    tool.startBatch();

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


var formatMoney = function(amount) {
  return '$' + Math.round(amount).toLocaleString('en-US');
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
      label = {text: formatMoney(preview.cost) + ' (not enough funds)', valid: false};
    else if (anySucceeded && preview.cost > 0)
      label = {text: formatMoney(preview.cost), valid: true};

    if (label !== null) {
      label.x = last.x - offset + size - 1;
      label.y = last.y - offset;
    }
  }

  return {rects: rects, label: label};
};


Game.prototype.handleSave = function() {
  var saveData = this.getSaveData();
  var succeeded = Storage.saveGame(saveData);

  // The game can also be kept as a file, to be opened from the title screen
  var fileName = (this.name || 'city').replace(/[^A-Za-z0-9_-]+/g, '_') + '.kawacity';
  var file = new Blob([Storage.exportGame(saveData)], {type: 'application/json'});

  this.dialogOpen = true;
  this._openWindow = 'saveWindow';
  this.saveWindow.open(succeeded, URL.createObjectURL(file), fileName);
};


Game.prototype.handlePause = function() {
  if (this.dialogOpen)
    return;

  this.isPaused = !this.isPaused;

  if (this.isPaused)
    this.simulation.setSpeed(Simulation.SPEED_PAUSED);
  else
    this.simulation.setSpeed(this.defaultSpeed);

  this._updateSpeedButtons();
};


// Sets the running speed (resuming the game if it was paused)
Game.prototype.setSpeed = function(speed) {
  if (speed !== Simulation.SPEED_SLOW && speed !== Simulation.SPEED_MED && speed !== Simulation.SPEED_FAST)
    return;

  this.defaultSpeed = speed;
  this.isPaused = false;
  this.simulation.setSpeed(speed);
  this._updateSpeedButtons();
};


Game.prototype._updateSpeedButtons = function() {
  $('#pauseRequest').text(this.isPaused ? 'Play' : 'Pause').toggleClass('paused', this.isPaused);

  var current = this.isPaused ? -1 : this.defaultSpeed;
  $('.speedButton').each(function() {
    var active = ($(this).attr('data-speed') - 0) === current;
    $(this).toggleClass('active', active).attr('aria-pressed', active ? 'true' : 'false');
  });
};


Game.prototype.handleEscape = function() {
  // Close the menus first, if one is open
  if (InputStatus.toggleMoreMenu(false) || Toolbar.closeFlyout())
    return;

  // A lost scenario can't be escaped
  if (this._openWindow === 'scenarioWindow' && this.scenarioWindow.mode === ScenarioWindow.LOST)
    return;

  // InputStatus doesn't know what dialogs are showing, so we must handle escape here
  if (this.dialogOpen) {
    var win = this[this._openWindow];
    this.dialogOpen = false;
    this._openWindow = null;
    win.close();
  } else {
    this.inputStatus.clearTool();
  }
};


Game.prototype.processFrontEndMessage = function(message) {
  var subject = message.subject;
  var d = new Date();

  if (Text.goodMessages[subject] !== undefined) {
    var cMessage = this.name + ' is now a ';

    switch (subject) {
      case Messages.REACHED_CAPITAL:
        if (!this._reachedCapital) {
          this._reachedCapital = true;
          cMessage += 'capital!';
        }
        break;

      case Messages.REACHED_CITY:
        if (!this._reachedCity) {
          this._reachedCity = true;
          cMessage += 'city!';
        }
        break;

      case Messages.REACHED_MEGALOPOLIS:
        if (!this._reachedMegalopolis) {
          this._reachedMegalopolis = true;
          cMessage += 'megalopolis!';
        }
        break;

      case Messages.REACHED_METROPOLIS:
        if (!this._reachedMetropolis) {
          this._reachedMetropolis = true;
          cMessage += 'metropolis!';
        }
        break;

      case Messages.REACHED_TOWN:
        if (!this._reachedTown) {
          this._reachedTown = true;
          cMessage += 'town!';
        }
        break;
    }

    if (this.lastBadMessageTime === null || d - this.lastBadMessageTime > disasterTimeout) {
      this.lastBadMessageTime = null;
      this._notificationBar.goodNews(message);
    }

    if (cMessage !== (this.name + ' is now a ')) {
      this.dialogOpen = true;
      this._openWindow = 'congratsWindow';
      this.congratsWindow.open(cMessage);
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

  // Trains, ships, planes, monsters and tornadoes move 60 times a second, whatever the display's refresh rate
  if (!this.isPaused && !this.dialogOpen) {
    this._spriteTime = Math.min((this._spriteTime || 0) + elapsed, SPRITE_STEP * 4);
    while (this._spriteTime >= SPRITE_STEP) {
      this.simulation.spriteManager.moveObjects(this.simulation._constructSimData());
      this._spriteTime -= SPRITE_STEP;
    }
  }

  // Run this even when paused: you can still build when paused
  this.overlay = this.computeOverlay();

  this.minimap.paint();
  this.ambientLife.update(elapsed, this.gameCanvas.getVisibleWorldRect(), !this.isPaused && !this.dialogOpen);
  this.updateClock();
  this.updateScenarioPanel();

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
