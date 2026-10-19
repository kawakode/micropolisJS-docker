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

import { AccountScreens } from './accountScreens.js';
import { FIELD_TEXTS } from './apiErrors.js';
import { CityFile } from './cityFile.js';
import { Config } from './config.js';
import { Game } from './game.js';
import { I18n } from './i18n.js';
import { MapGenerator } from './mapGenerator.js';
import { Scenarios } from './scenarios.js';
import { Simulation } from './simulation.js';
import { SplashCanvas } from './splashCanvas.js';
import { Storage } from './storage.js';
import { BIT_MASK } from './tileFlags.ts';


/*
 *
 * The SplashScreen is the first screen the player will see on launch. It is responsible for map generation,
 * placing UI on screen to allow the player to select a map or load a game, and finally launching the game.
 * This should not be called until the tiles and sprites have been loaded.
 *
 */

var onresize = null;


// If the window is initially too small, try and relaunch if it gets bigger
var makeResizeListener = function(tileSet, snowTileSet, spriteSheet) {
  return function(e) {
    if ($('#tooSmall').is(':visible'))
      return;

    $(window).off('resize', onresize);
    onresize = null;
    var s = new SplashScreen(tileSet, snowTileSet, spriteSheet);
  };
};


function SplashScreen(tileSet, snowTileSet, spriteSheet) {
  // We don't launch the game if the screen is too small, however, we should retain the right to do so
  // should the situation change...
  if ($('#tooSmall').is(':visible')) {
    if (onresize === null) {
      onresize = makeResizeListener(tileSet, snowTileSet, spriteSheet);
      $(window).on('resize', onresize);
    }
    return;
  }

  this.tileSet = tileSet;
  this.snowTileSet = snowTileSet;
  this.spriteSheet = spriteSheet;
  this.map = MapGenerator(120, 100, mapOptions());

  // Set up listeners on buttons. When play is clicked, we will move on to get the player's desired
  // difficulty level and city name before launching the game properly
  $('#splashGenerate').click(regenerateMap.bind(this));
  $('#mapOptions select').on('change', regenerateMap.bind(this));
  $('#splashPlay').click(acquireNameAndDifficulty.bind(this));
  $('#splashLoad').click(handleLoad.bind(this));
  $('#splashScenarios').click(showScenarios.bind(this));
  $('#splashOpen').click(function(e) {
    e.preventDefault();
    $('#splashFile').val('').click();
  });
  $('#splashFile').on('change', openFile.bind(this));
  $('#pickerBack').click(hideScenarios.bind(this));
  $('#pickerPlay').click(playScenario.bind(this));
  this._scenarioGames = {};
  this._scenarioID = Scenarios.list[0].id;

  // A game can always be saved, as a file when the browser can't keep it; it can be loaded only from the browser
  $('#saveRequest').prop('disabled', false);
  $('#splashLoad').prop('disabled', !(Storage.canStore && Storage.getSavedGame() !== null));

  // Paint the minimap
  this.splashCanvas = new SplashCanvas('splashContainer', tileSet);
  this.splashCanvas.paint(this.map);

  // Let's get some bits on screen!
  $('.awaitGeneration').toggle();
  $('#splashPlay').focus();

  // The accounts, when the game's server offers them
  AccountScreens.start();

  // Playing a scenario again (see Game) comes back here with the scenario in the address
  var match = /^#scenario=([a-z]+)$/.exec(window.location.hash);
  if (match && Scenarios.get(match[1])) {
    if (window.history && window.history.replaceState)
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    this._scenarioID = match[1];
    playScenario.call(this);
  }
}


// The terrain the player asked for (see MapGenerator)
var mapOptions = function() {
  var water = $('#mapWater').val();
  var number = function(id) {
    var value = parseInt($(id).val(), 10);
    return isNaN(value) ? -1 : value;
  };

  return {
    island: number('#mapLand'),
    trees: number('#mapTrees'),
    // No water at all, a river and the odd pond, or a river and many lakes
    curve: water === 'none' ? 0 : -1,
    lakes: water === 'none' ? 0 : (water === 'some' ? 2 : (water === 'lots' ? 24 : -1))
  };
};


// Launches the game with the given saved game (from storage, a file, or a scenario). We won't return from here (but
// for a shared city in the making, which takes the saved game as its start: see share)
var launch = function(savedGame) {
  if (sharing !== null) {
    $('#pickerPlay').prop('disabled', false);
    askSharedName.call(this, {save: savedGame}, savedGame.name, savedGame._gameLevel);
    return;
  }

  AccountScreens.stop();

  // Remove installed event listeners
  $('#splashLoad, #splashGenerate, #splashPlay, #splashScenarios, #splashOpen, #pickerBack, #pickerPlay').off('click');
  $('#splashFile, #mapOptions select').off('change');

  // Hide the title screen
  $('#splash').hide();
  $('#scenarioPicker').hide();

  var g = new Game(savedGame, this.tileSet, this.snowTileSet, this.spriteSheet,
                   savedGame._gameLevel || Simulation.LEVEL_EASY, savedGame.name);
};


var showError = function(message) {
  $('#splashError').text(message || '');
};


// Opens a city file: a game kept with "Save", or a city file of the original game
var openFile = function(e) {
  var file = e.target.files && e.target.files[0];
  if (!file)
    return;

  showError('');
  var name = file.name.replace(/\.[^.]*$/, '').replace(/_/g, ' ').slice(0, 15);
  name = name.charAt(0).toUpperCase() + name.slice(1);
  var reader = new FileReader();

  reader.onload = function() {
    var buffer = reader.result;
    var savedGame = null;

    if (CityFile.isCityFile(buffer)) {
      try {
        savedGame = CityFile.read(buffer, {name: name});
      } catch (err) {
        savedGame = null;
      }
    } else {
      savedGame = Storage.parseSavedGame(new TextDecoder().decode(buffer));
    }

    if (savedGame === null) {
      showError(I18n.t('Sorry, KawaCity can\'t open this file. Choose a city saved from KawaCity, or a city file (.cty) of the original game.'));
      return;
    }

    launch.call(this, savedGame);
  }.bind(this);

  reader.onerror = function() {
    showError(I18n.t('Sorry, the file could not be read.'));
  };

  reader.readAsArrayBuffer(file);
};


// --- Scenarios and sample cities ---

var showScenarios = function(e) {
  if (e)
    e.preventDefault();

  if (!this.scenarioCanvas) {
    this.scenarioCanvas = new SplashCanvas('scenarioPreview', this.tileSet, 'scenarioPreviewCanvas');
    $('.pickerTab').on('change', function() {
      showTab.call(this, $('.pickerTab:checked').val());
    }.bind(this));
  }

  $('#splash').hide();
  $('#scenarioPicker').show();
  showTab.call(this, this._pickerTab || 'scenarios');
  $('#scenarioList .scenarioChoice[aria-selected="true"]').focus();
};


var hideScenarios = function(e) {
  if (e)
    e.preventDefault();

  $('#scenarioPicker').hide();
  $('#splash').show();
  $('#splashScenarios').focus();
};


// Lists the scenarios or the sample cities
var showTab = function(tab) {
  this._pickerTab = tab;
  $('.pickerTab').each(function(i, element) {
    $(element).prop('checked', $(element).val() === tab);
  });

  var items = tab === 'cities' ? Scenarios.cities : Scenarios.list;
  $('#scenarioList').empty();
  items.forEach(function(item) {
    var choice = $('<button type="button" class="scenarioChoice" role="option">')
      .attr('data-id', item.id)
      .append($('<span>').text(item.name))
      .on('click', function() { select.call(this, item.id); }.bind(this))
      .appendTo('#scenarioList');
    if (item.year)
      choice.append($('<span class="year">').text(item.year));
  }, this);

  $('#pickerPlay').text(I18n.t(tab === 'cities' ? 'Play this city' : 'Play this scenario'));
  select.call(this, tab === 'cities' ? (this._cityID || Scenarios.cities[0].id) : this._scenarioID);
};


// The saved game of a scenario or a city, fetched once
var getGame = function(tab, id) {
  var key = tab + ':' + id;
  if (!this._scenarioGames[key]) {
    var version = $('#scenarioPicker').attr('data-version');
    this._scenarioGames[key] = tab === 'cities' ? Scenarios.loadCity(id, version) : Scenarios.load(id, version);
  }

  return this._scenarioGames[key];
};


var select = function(id) {
  var tab = this._pickerTab || 'scenarios';
  var scenario = tab === 'cities' ? null : Scenarios.get(id);

  if (tab === 'cities')
    this._cityID = id;
  else
    this._scenarioID = id;

  $('#scenarioList .scenarioChoice').each(function(i, element) {
    $(element).attr('aria-selected', $(element).attr('data-id') === id ? 'true' : 'false');
  });

  $('#pickerText').empty();
  if (scenario) {
    $('#pickerPlace').text(I18n.t(scenario.place).toUpperCase() + '  ' + scenario.year);
    scenario.text.forEach(function(text) {
      $('<p>').text(I18n.t(text)).appendTo('#pickerText');
    });
    $('#pickerGoal').show().text(I18n.t('Goal: {goal} within {years} years.',
                                        {goal: I18n.t(Scenarios.GOAL_TEXT[scenario.goal]), years: Math.round(scenario.scoreWait / 48)}));
  } else {
    $('#pickerPlace').text(Scenarios.getCity(id).name.toUpperCase());
    $('#pickerGoal').hide();
  }

  getGame.call(this, tab, id).then(function(savedGame) {
    // The player may have moved on to another one meanwhile
    var current = tab === 'cities' ? this._cityID : this._scenarioID;
    if (this._pickerTab !== tab || current !== id)
      return;

    if (!scenario) {
      // A short description of the city
      var city = Scenarios.getCity(id);
      var population = (savedGame.resPop + (savedGame.comPop + savedGame.indPop) * 8) * 20;
      var text = city.empty ? I18n.t('An untouched landscape, waiting for its first settlers.') :
                 I18n.t('In {year}, {population} people live here, and the city has {funds} in the bank.',
                        {year: 1900 + Math.floor(savedGame._cityTime / 48), population: I18n.formatNumber(population),
                         funds: I18n.money(savedGame.totalFunds)});
      $('#pickerText').empty().append($('<p>').text(text));
    }

    var map = savedGame.map;
    this.scenarioCanvas.paint({width: savedGame.width, height: savedGame.height, getTileValue: function(x, y) {
      return map[y * savedGame.width + x].value & BIT_MASK;
    }});
  }.bind(this)).catch(function(err) {
    console.error(err);
  });
};


var playScenario = function(e) {
  if (e)
    e.preventDefault();

  var tab = this._pickerTab || 'scenarios';
  var id = tab === 'cities' ? this._cityID : this._scenarioID;
  $('#pickerPlay').prop('disabled', true);

  getGame.call(this, tab, id).then(function(savedGame) {
    // A fresh copy: the cached one is only for the preview
    var game = JSON.parse(JSON.stringify(savedGame));
    game.isSavedGame = true;
    if (tab !== 'cities')
      game.scenarioBriefing = true;
    launch.call(this, game);
  }.bind(this)).catch(function(err) {
    console.error(err);
    $('#pickerPlay').prop('disabled', false);
    hideScenarios.call(this);
    showError(I18n.t('Sorry, the city could not be loaded.'));
  }.bind(this));
};


// Generate a new map at the user's request, and paint it
var regenerateMap = function(e) {
  e.preventDefault();

  this.map = MapGenerator(120, 100, mapOptions());
  this.splashCanvas.paint(this.map);
};


// Fetches game data from the storage manager, and launches the game. We won't return from here
var handleLoad = function(e) {
  e.preventDefault();

  var savedGame = Storage.getSavedGame();

  if (savedGame === null)
    return;

  launch.call(this, savedGame);
};


// After a map has been selected, call this function to display a form asking the user for
// a city name and difficulty level.
var acquireNameAndDifficulty = function(e) {
  e.preventDefault();

  if (sharing !== null) {
    askSharedName.call(this, {map: this.map}, null, null);
    return;
  }

  // Remove the initial event listeners
  AccountScreens.stop();
  $('#splashLoad, #splashGenerate, #splashPlay, #splashScenarios, #splashOpen, #pickerBack, #pickerPlay').off('click');
  $('#splashFile, #mapOptions select').off('change');

  // Get rid of the initial splash screen
  $('#splash').toggle();

  // As a convenience, the city name is not mandatory in debug mode
  if (Config.debug)
    $('#nameForm').removeAttr('required');

  // When the form is submitted, we'll be ready to launch the game
  $('#playForm').submit(play.bind(this));

  // Display the name and difficulty form
  $('#start').toggle();
  $('#nameForm').focus();
};


// This function should be called after the name/difficulty form has been submitted. The game will now be launched
// with the map selected earlier.
var play = function(e) {
  e.preventDefault();

  // As usual, uninstall event listeners, and hide the UI
  $('#playForm').off('submit');
  $('#start').toggle();

  // What values did the player specify?
  var difficulty = $('.difficulty:checked').val() - 0;
  var name = $('#nameForm').val();

  // Launch a new game
  var g = new Game(this.map, this.tileSet, this.snowTileSet, this.spriteSheet, difficulty, name);
};


// --- A shared city in the making (see Lobby) ---

// While the lobby makes a shared city, the title screen chooses its start, as for a city played alone: a generated map
// (Play this map), a sample city (Scenarios & cities, without the scenarios) or a city file, then the city's name and
// difficulty; the city is then given to the lobby instead of being played here. Otherwise null:
// {create(choice, name, level): a Promise, rejected with the text that says why the city was not made; cancel()}, and
// choice is {map: the GameMap} or {save: the saved game}.
var sharing = null;

// The start chosen, while the name and difficulty are asked
var sharedChoice = null;


var showSharedError = function(text, field) {
  $('#startError').text(text || '');
  $('#nameForm').attr('aria-invalid', field ? 'true' : null).attr('aria-describedby', field ? 'startError' : null);
};


var setSharedBusy = function(busy) {
  $('#playForm').attr('aria-busy', busy ? 'true' : null);
  $('#playit').toggleClass('busy', busy).attr('aria-disabled', busy ? 'true' : null);
};


// Asks the name and difficulty of the shared city made from choice ({map} or {save}): those of a saved game to begin
// with (name and level, or null)
var askSharedName = function(choice, name, level) {
  sharedChoice = choice;
  showSharedError('', false);

  if (typeof(name) === 'string' && name !== '')
    $('#nameForm').val(Array.from(name).slice(0, 15).join(''));
  if (level === Simulation.LEVEL_EASY || level === Simulation.LEVEL_MED || level === Simulation.LEVEL_HARD)
    $('.difficulty').each(function(i, input) { $(input).prop('checked', $(input).val() - 0 === level); });

  $('#splash').hide();
  $('#scenarioPicker').hide();
  $('#start').show();
  $('#nameForm').focus();
};


// From the name and difficulty back to the title screen (and its Play this map)
var backToSharedTitle = function(e) {
  if (e)
    e.preventDefault();
  if ($('#playForm').attr('aria-busy') === 'true')
    return;

  sharedChoice = null;
  showSharedError('', false);
  $('#start').hide();
  $('#scenarioPicker').hide();
  $('#splash').show();
  $('#splashPlay').focus();
};


var submitShared = function(e) {
  e.preventDefault();
  if (sharing === null || sharedChoice === null || $('#playForm').attr('aria-busy') === 'true')
    return;

  var name = String($('#nameForm').val() || '').normalize('NFC').replace(/[\p{Cc}\p{Cf}]/gu, '').trim();
  if (name === '') {
    showSharedError(I18n.t(FIELD_TEXTS.required), true);
    $('#nameForm').focus();
    return;
  }

  showSharedError('', false);
  setSharedBusy(true);
  var done = sharing;
  done.create(sharedChoice, name, $('.difficulty:checked').val() - 0).then(function() {
    setSharedBusy(false);
  }, function(text) {
    setSharedBusy(false);
    if (sharing !== done)
      return;
    showSharedError(typeof(text) === 'string' ? text : I18n.t('Sorry, the city could not be loaded.'), false);
    $('#playit').focus();
  });
};


var onSharedKey = function(e) {
  if (e.key !== 'Escape' || sharing === null)
    return;

  if ($('#start').is(':visible')) {
    e.preventDefault();
    backToSharedTitle();
  } else if ($('#scenarioPicker').is(':visible')) {
    e.preventDefault();
    hideScenarios();
  } else if ($('#splash').is(':visible') && !AccountScreens.isOpen()) {
    e.preventDefault();
    sharing.cancel();
  }
};


// The title screen chooses the start of a shared city (see sharing), until stopSharing
var share = function(handlers) {
  sharing = handlers;
  sharedChoice = null;

  $('#splash').addClass('sharedCity');
  $('#start').addClass('sharedCity');
  $('#start .cardTitle').text(I18n.t('New shared city'));
  $('#playit').val(I18n.t('Create the shared city'));
  $('#startBack').off('click').on('click', backToSharedTitle);
  $('#playForm').off('submit.sharedCity').on('submit.sharedCity', submitShared);
  $(document).off('keydown.sharedCity').on('keydown.sharedCity', onSharedKey);
  showSharedError('', false);
};


// Back to the title screen of a city played alone
var stopSharing = function() {
  if (sharing === null)
    return;

  sharing = null;
  sharedChoice = null;
  setSharedBusy(false);
  showSharedError('', false);
  $(document).off('keydown.sharedCity');
  $('#playForm').off('submit.sharedCity');
  $('#startBack').off('click');
  $('#start .cardTitle').text(I18n.t('New city'));
  $('#playit').val(I18n.t('Found the city'));
  $('#splash, #start').removeClass('sharedCity');
  $('#pickerPlay').prop('disabled', false);

  $('#start').hide();
  $('#scenarioPicker').hide();
  $('#splash').show();
};


SplashScreen.share = share;
SplashScreen.stopSharing = stopSharing;
SplashScreen.isSharing = function() {
  return sharing !== null;
};


export { SplashScreen };
