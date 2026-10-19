/* KawaCity: the weather, month by month. The sun the solar farms get follows the seasons, the wind turbines follow
 * the wind, and snow in winter covers the solar farms and makes the roads cost more to keep clear.
 *
 * It is part of the simulation (and of the save), so that a shared city has the same weather for every player.
 */

import { Random } from './random.ts';

// How much of their power the solar farms give, month by month (January first)
var SUN = [0.6, 0.7, 0.85, 1, 1.1, 1.2, 1.2, 1.1, 1, 0.85, 0.7, 0.6];
// Under snow, they give this much of it
var SNOW_SUN = 0.5;

var CALM = 0;
var BREEZE = 1;
var WINDY = 2;
// How much of their power the wind turbines give, by wind
var WIND = [0.5, 1, 1.5];

// The months snow may fall (December to February)
var SNOW_MONTHS = [11, 0, 1];

// How much more the roads cost to keep up for each month of snow in the year
var SNOW_ROAD_COST = 0.1;


function Weather() {
  this.snow = false;
  this.wind = BREEZE;
  this.month = 0;
  // The months of snow so far this year
  this.snowMonths = 0;
}


// A new month: the wind changes, snow may fall or melt. Returns whether snow fell.
Weather.prototype.newMonth = function(month) {
  this.month = month;
  this.wind = Random.getRandom(WINDY);

  var fell = false;
  if (SNOW_MONTHS.indexOf(month) !== -1) {
    if (!this.snow && Random.getRandom(2) === 0) {
      this.snow = true;
      fell = true;
    }
  } else {
    // It melts in March
    this.snow = false;
  }

  if (this.snow)
    this.snowMonths++;

  return fell;
};


Weather.prototype.solarFactor = function() {
  return SUN[this.month] * (this.snow ? SNOW_SUN : 1);
};


Weather.prototype.windFactor = function() {
  return WIND[this.wind];
};


// What the snow of the year added to the roads' upkeep (a factor), counted again from the next year
Weather.prototype.closeYear = function() {
  var factor = 1 + this.snowMonths * SNOW_ROAD_COST;
  this.snowMonths = 0;
  return factor;
};


// What the game shows: {snow, wind, solar, windPower}, the last two in percent
Weather.prototype.describe = function() {
  return {snow: this.snow, wind: this.wind, solar: Math.round(this.solarFactor() * 100),
          windPower: Math.round(this.windFactor() * 100)};
};


Weather.prototype.save = function(saveData) {
  saveData.weatherSnow = this.snow;
  saveData.weatherWind = this.wind;
  saveData.snowMonths = this.snowMonths;
};


Weather.prototype.load = function(saveData, month) {
  this.month = month;
  this.snow = saveData.weatherSnow === true;
  this.wind = Number.isInteger(saveData.weatherWind) && saveData.weatherWind >= CALM && saveData.weatherWind <= WINDY ?
              saveData.weatherWind : BREEZE;
  this.snowMonths = Number.isInteger(saveData.snowMonths) && saveData.snowMonths > 0 ? saveData.snowMonths : 0;
};


Weather.CALM = CALM;
Weather.BREEZE = BREEZE;
Weather.WINDY = WINDY;


export { Weather };
