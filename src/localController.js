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
 * KawaCity: the game's handling of the player's commands, moved here from Game unchanged, so that a shared city's
 * game can send them to the server instead (see RemoteController).
 *
 */

import $ from "jquery";

import { BaseTool } from './baseTool.js';
import { DebugWindow } from './debugWindow.js';
import { DisasterWindow } from './disasterWindow.js';
import { I18n } from './i18n.js';
import { SettingsWindow } from './settingsWindow.js';
import { Simulation } from './simulation.js';
import { Storage } from './storage.js';
import { Text } from './text.js';

// What the game does with the player's commands in a city played alone: it carries them out on its own city. The game
// of a shared city has a RemoteController instead, with the same methods, which sends them to the server.


// The warning for a tool that can't act until the land is bulldozed: hint at the setting when it is off
var needsDozeText = function() {
  return I18n.t(BaseTool.getAutoBulldoze() ? Text.toolMessages.needsDoze : Text.toolMessages.needsDozeManual);
};


function LocalController(game) {
  this.game = game;
  this.remote = false;
}


// Applies the current tool at each of the given placements in turn, stopping if we run out of money (see
// Game.handleTool)
LocalController.prototype.applyTool = function(data) {
  var game = this.game;
  var tool = game.inputStatus.gameTools[data.toolName];
  if (tool === undefined || game.dialogOpen)
    return;

  var budget = game.simulation.budget;
  var blockMaps = game.simulation.blockMaps;
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

  game._preview = null;

  if (succeeded > 0)
    game.tickerNews.record(data.toolName, succeeded);
  if (failure === tool.TOOLRESULT_NO_MONEY)
    game.tickerNews.record('noMoney');
  else if (succeeded === 0 && failure === tool.TOOLRESULT_NEEDS_BULLDOZE)
    game.tickerNews.record('needsBulldoze');

  if (failure === tool.TOOLRESULT_NO_MONEY)
    $('#toolOutput').text(I18n.t(Text.toolMessages.noMoney));
  else if (succeeded === 0 && failure === tool.TOOLRESULT_NEEDS_BULLDOZE)
    $('#toolOutput').text(needsDozeText());
  else
    game._showToolLabel();
};


// The budget window was closed (see Game.handleBudgetWindowClosure)
LocalController.prototype.applyBudget = function(data) {
  var game = this.game;

  if (!data.cancelled) {
    game.recordBudgetChanges(data);
    game.simulation.budget.roadPercent = data.roadPercent / 100;
    game.simulation.budget.firePercent = data.firePercent / 100;
    game.simulation.budget.policePercent = data.policePercent / 100;
    game.simulation.budget.setTax(data.taxPercent - 0);
  }

  // The simulation waits for the yearly budget to be confirmed: it must be completed even if the player cancels
  // the window, keeping the existing values, or the simulation would stay frozen
  if (game.simNeededBudget) {
    game.simulation.budget.doBudgetWindow();
    game.simNeededBudget = false;
  } else if (!data.cancelled) {
    game.simulation.budget.updateFundEffects();
  }
};


// The settings window was closed (see Game.handleSettingsWindowClosure)
LocalController.prototype.applySettings = function(actions) {
  var game = this.game;

  for (var i = 0, l = actions.length; i < l; i++) {
    var a = actions[i];

    switch (a.action) {
      case SettingsWindow.AUTOBUDGET:
        game.simulation.budget.setAutoBudget(a.data);
        break;

      case SettingsWindow.AUTOBULLDOZE:
        BaseTool.setAutoBulldoze(a.data);
        break;

      case SettingsWindow.SPEED:
        // A paused game stays paused, unless another speed was chosen
        if (!game.isPaused || a.data - 0 !== game.defaultSpeed)
          game.setSpeed(a.data - 0);
        break;

      case SettingsWindow.DISASTERS_CHANGED:
        if (!a.data && game.simulation.disasterManager.disastersEnabled)
          game.tickerNews.record('disastersOff');
        game.simulation.disasterManager.disastersEnabled = a.data;
        break;

      case SettingsWindow.DAY_NIGHT:
        if (!a.data && game.ambientLife.dayNight)
          game.tickerNews.record('nightOff');
        game.ambientLife.setDayNight(a.data);
        break;

      case SettingsWindow.LEVEL:
        if (a.data !== game.simulation.getLevel())
          game.tickerNews.record(a.data > game.simulation.getLevel() ? 'harder' : 'easier');
        game.simulation.changeLevel(a.data);
        break;

      case SettingsWindow.LANGUAGE:
        I18n.setLanguage(a.data);
        break;

      case SettingsWindow.VIEW:
        game.setIsometric(a.data);
        break;

      default:
        console.warn('Unexpected action', a);
    }
  }
};


// The disaster window was closed (see Game.handleDisasterWindowClosure)
LocalController.prototype.applyDisaster = function(request) {
  var game = this.game;

  if (request === DisasterWindow.DISASTER_NONE)
    return;

  game.tickerNews.record('disaster:' + request);

  switch (request) {
    case DisasterWindow.DISASTER_MONSTER:
      game.simulation.spriteManager.makeMonster();
      break;

    case DisasterWindow.DISASTER_FIRE:
      game.simulation.disasterManager.makeFire();
      break;

    case DisasterWindow.DISASTER_FLOOD:
      game.simulation.disasterManager.makeFlood();
      break;

    case DisasterWindow.DISASTER_CRASH:
      game.simulation.disasterManager.makeCrash();
      break;

    case DisasterWindow.DISASTER_MELTDOWN:
      game.simulation.disasterManager.makeMeltdown();
      break;

    case DisasterWindow.DISASTER_TORNADO:
      game.simulation.spriteManager.makeTornado();
      break;

    case DisasterWindow.DISASTER_EARTHQUAKE:
      game.simulation.disasterManager.makeEarthquake();
      break;
  }
};


// Signs or ends the deals chosen in the window of the neighbouring cities: [{side, kind, signed}]
LocalController.prototype.applyDeals = function(changes) {
  var game = this.game;

  changes.forEach(function(change) {
    game.simulation.neighbours.setDeal(change.side, change.kind, change.signed);
    game.tickerNews.record(change.signed ? 'deal' : 'dealEnded');
  });
};


// The debug window's actions (see Game.handleDebugWindowClosure)
LocalController.prototype.applyDebug = function(actions) {
  var game = this.game;

  for (var i = 0, l = actions.length; i < l; i++) {
    var a = actions[i];

    switch (a.action) {
      case DebugWindow.ADD_FUNDS:
        game.simulation.budget.spend(-20000);
        break;

      default:
        console.warn('Unexpected action', a);
    }
  }
};


// Pauses or resumes the game (see Game.handlePause)
LocalController.prototype.togglePause = function() {
  var game = this.game;
  game.isPaused = !game.isPaused;

  if (game.isPaused) {
    game.tickerNews.record('pause');
    game.simulation.setSpeed(Simulation.SPEED_PAUSED);
  } else {
    game.simulation.setSpeed(game.defaultSpeed);
  }

  game._updateSpeedButtons();
};


// Sets the running speed (resuming the game if it was paused)
LocalController.prototype.setSpeed = function(speed) {
  var game = this.game;
  if (speed !== Simulation.SPEED_SLOW && speed !== Simulation.SPEED_MED && speed !== Simulation.SPEED_FAST)
    return;

  if (speed !== game.defaultSpeed && speed !== Simulation.SPEED_MED)
    game.tickerNews.record(speed === Simulation.SPEED_FAST ? 'fast' : 'slow');

  game.defaultSpeed = speed;
  game.isPaused = false;
  game.simulation.setSpeed(speed);
  game._updateSpeedButtons();
};


// Saves the game in the browser, and offers it as a file (see Game.handleSave)
LocalController.prototype.save = function() {
  var game = this.game;
  game.tickerNews.record('save');
  var saveData = game.getSaveData();
  var succeeded = Storage.saveGame(saveData);

  // The game can also be kept as a file, to be opened from the title screen
  var fileName = (game.name || 'city').replace(/[^A-Za-z0-9_-]+/g, '_') + '.kawacity';
  var file = new Blob([Storage.exportGame(saveData)], {type: 'application/json'});

  game.dialogOpen = true;
  game._openWindow = 'saveWindow';
  game.saveWindow.open(succeeded, URL.createObjectURL(file), fileName);
};


LocalController.needsDozeText = needsDozeText;


export { LocalController };
