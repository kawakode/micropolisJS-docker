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
import { Config } from './config.js';
import { I18n } from './i18n.js';
import { Lobby } from './lobby.js';
import { Multiplayer } from './multiplayer.js';
import { PixelIcons } from './pixelIcons.js';
import { SplashScreen } from './splashScreen.js';
import { TileSet } from './tileSet.js';
import { TileSetURI } from './tileSetURI.ts';
import { TileSetSnowURI } from './tileSetSnowURI.ts';

/*
 *
 * Our task in main is to load the tile image, create a TileSet from it, and then tell the SplashScreen to display
 * itself. We will never return here.
 *
 */


var fallbackImage, tileSet, snowTileSet;


var onTilesLoaded = function() {
  var snowTiles = $('#snowtiles')[0];
  snowTileSet = new TileSet(snowTiles, onAllTilesLoaded, onFallbackTilesLoaded);
};


var onAllTilesLoaded = function() {
  // Kick things off properly
  var sprites = $('#sprites')[0];
  var water = $('#watertiles')[0];
  var lights = $('#lighttiles')[0];
  var roads = $('#roadtiles')[0];
  if (sprites.complete && water.complete && lights.complete && roads.complete) {
    // The water animation and night lights are optional: only use them if they loaded
    if (water.naturalWidth > 0)
      tileSet.waterImage = water;
    if (lights.naturalWidth > 0) {
      tileSet.lightsImage = lights;
      snowTileSet.lightsImage = lights;
    }
    // The looks of dirt roads, avenues and highways
    if (roads.naturalWidth > 0) {
      tileSet.roadsImage = roads;
      snowTileSet.roadsImage = roads;
    }
    $('#loadingBanner').css('display', 'none');

    // A shared city, played from the lobby, is shown with the same pictures
    Multiplayer.setAssets(tileSet, snowTileSet, sprites);
    var s = new SplashScreen(tileSet, snowTileSet, sprites);
  } else {
     window.setTimeout(onAllTilesLoaded, 0);
  }
};


// XXX Replace with an error dialog
var onFallbackError = function() {
  fallbackImage.onload = fallbackImage.onerror = null;
  alert(I18n.t('Failed to load tileset!'));
};


var onFallbackSnowLoad = function() {
  fallbackImage.onload = fallbackImage.onerror = null;
  snowTileSet = new TileSet(fallbackImage, onAllTilesLoaded, onFallbackError);
};


var onFallbackTilesLoaded = function() {
  fallbackImage = new Image();
  fallbackImage.onload = onFallbackSnowLoad;
  fallbackImage.onerror = onFallbackError;
  fallbackImage.src = TileSetSnowURI;
};


var onFallbackLoad = function() {
  fallbackImage.onload = fallbackImage.onerror = null;
  tileSet = new TileSet(fallbackImage, onFallbackTilesLoaded, onFallbackError);
};


var tileSetError = function() {
  // We might be running locally in Chrome, which handles the security context of file URIs differently, which makes
  // things go awry when we try to create an image from a "tainted" canvas (one we've painted on). Let's try creating
  // the tileset by URI instead
  fallbackImage = new Image();
  fallbackImage.onload = onFallbackLoad;
  fallbackImage.onerror = onFallbackError;
  fallbackImage.src = TileSetURI;
};


// Check for debug parameter in URL
Config.debug = window.location.search.slice(1).split('&').some(function(param) {
  return param.trim().toLowerCase() === 'debug=1';
});

// The translations too: I18n.missing lists the texts that have none; and the shared cities (kawaMultiplayer.play(id)
// joins one, kawaMultiplayer.playing() is the game being played)
if (Config.debug) {
  window.kawaI18n = I18n;
  window.kawaMultiplayer = Multiplayer;
}


// The page, in the player's language, with its icons
document.documentElement.lang = I18n.getLanguage();
I18n.translateDocument();
PixelIcons.decorate();

// The accounts, if the game's server offers them: asked now, shown with the title screen (which does not wait); and
// the multiplayer lobby, one of their screens
AccountScreens.boot();
Lobby.boot();


var tiles = $('#tiles')[0];
tileSet = new TileSet(tiles, onTilesLoaded, tileSetError);
