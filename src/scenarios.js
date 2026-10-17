/* KawaCity, a modified version of micropolisJS. Adapted by Graeme McCutcheon from Micropolis.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

import { CityFile } from './cityFile.js';
import { Simulation } from './simulation.js';

// The eight scenarios of the original game. Each starts from a city file, at a given date and with given funds;
// a disaster may strike at set times (see Simulation); after a given time, the city is judged on its goal.
//
// disasterWait and scoreWait are counted in city time units (4 a month, 48 a year), as in the original.

var GOAL_METROPOLIS = 'metropolis';
var GOAL_TRAFFIC = 'traffic';
var GOAL_CRIME = 'crime';
var GOAL_SCORE = 'score';

var SCENARIOS = [
  {id: 'dullsville', name: 'Dullsville', place: 'Dullsville, USA', year: 1900, funds: 5000, disaster: null,
   disasterWait: 2, scoreWait: 30 * 48, goal: GOAL_METROPOLIS,
   text: ['Things haven\'t changed much around here in the last hundred years or so and the residents are beginning to get bored. They think Dullsville could be the next great city with the right leader.',
          'It is your job to attract new growth and development, turning Dullsville into a Metropolis within 30 years.']},
  {id: 'sanfrancisco', name: 'San Francisco', place: 'San Francisco, CA', year: 1906, funds: 20000, disaster: 'earthquake',
   disasterWait: 10, scoreWait: 5 * 48, goal: GOAL_METROPOLIS,
   text: ['Damage from the earthquake was minor compared to that of the ensuing fires, which took days to control. 1500 people died.',
          'Controlling the fires should be your initial concern. Then clear the rubble and start rebuilding. You have 5 years.']},
  {id: 'hamburg', name: 'Hamburg', place: 'Hamburg, Germany', year: 1944, funds: 20000, disaster: 'firebombs',
   disasterWait: 4 * 10, scoreWait: 5 * 48, goal: GOAL_METROPOLIS,
   text: ['Allied fire-bombing of German cities in WWII caused tremendous damage and loss of life. People living in the inner cities were at greatest risk.',
          'You must control the firestorms during the bombing and then rebuild the city after the war. You have 5 years.']},
  {id: 'bern', name: 'Bern', place: 'Bern, Switzerland', year: 1965, funds: 20000, disaster: null,
   disasterWait: 20, scoreWait: 10 * 48, goal: GOAL_TRAFFIC,
   text: ['The roads here are becoming more congested every day, and the residents are upset. They demand that you do something about it.',
          'Some have suggested a mass transit system as the answer, but this would require major rezoning in the downtown area. You have 10 years.']},
  {id: 'tokyo', name: 'Tokyo', place: 'Tokyo, Japan', year: 1957, funds: 20000, disaster: 'monster',
   disasterWait: 3, scoreWait: 5 * 48, goal: GOAL_SCORE,
   text: ['A large reptilian creature has been spotted heading for Tokyo bay. It seems to be attracted to the heavy levels of industrial pollution there.',
          'Try to control the fires, then rebuild the industrial center. You have 5 years.']},
  {id: 'detroit', name: 'Detroit', place: 'Detroit, MI', year: 1972, funds: 20000, disaster: null,
   disasterWait: 5, scoreWait: 10 * 48, goal: GOAL_CRIME,
   text: ['By 1970, competition from overseas and other economic factors pushed the once "automobile capital of the world" into recession. Plummeting land values and unemployment then increased crime in the inner-city to chronic levels.',
          'You have 10 years to reduce crime and rebuild the industrial base of the city.']},
  {id: 'boston', name: 'Boston', place: 'Boston, MA', year: 2010, funds: 20000, disaster: 'meltdown',
   disasterWait: 5, scoreWait: 5 * 48, goal: GOAL_SCORE,
   text: ['A major meltdown is about to occur at one of the new downtown nuclear reactors. The area in the vicinity of the reactor will be severely contaminated by radiation, forcing you to restructure the city around it.',
          'You have 5 years to get the situation under control.']},
  {id: 'rio', name: 'Rio de Janeiro', place: 'Rio de Janeiro, Brazil', year: 2047, funds: 20000, disaster: 'flood',
   disasterWait: 2 * 48, scoreWait: 10 * 48, goal: GOAL_SCORE,
   text: ['In the mid-21st century, the greenhouse effect raised global temperatures 6 degrees F. Polar icecaps melted and raised sea levels worldwide. Coastal areas were devastated by flood and erosion.',
          'You have 10 years to turn this swamp back into a city again.']}
];

// What each goal asks of the player
var GOAL_TEXT = {};
GOAL_TEXT[GOAL_METROPOLIS] = 'Be a Metropolis (over 100,000 people)';
GOAL_TEXT[GOAL_TRAFFIC] = 'Bring the average traffic below 80';
GOAL_TEXT[GOAL_CRIME] = 'Bring the average crime below 60';
GOAL_TEXT[GOAL_SCORE] = 'Raise the city score above 500';


var get = function(id) {
  for (var i = 0; i < SCENARIOS.length; i++) {
    if (SCENARIOS[i].id === id)
      return SCENARIOS[i];
  }

  return null;
};


// Fetches the scenario's city file, and resolves to a saved game ready to be played
var load = function(id, version) {
  var scenario = get(id);
  if (scenario === null)
    return Promise.reject(new Error('Unknown scenario ' + id));

  return fetchCityFile('cities/scenarios/' + id + '.cty', version).then(function(buffer) {
    var savedGame = CityFile.read(buffer, {name: scenario.name, cityTime: (scenario.year - 1900) * 48 + 2,
                                           funds: scenario.funds, gameLevel: Simulation.LEVEL_EASY});
    // Everything the simulation needs to run the scenario travels with the game, and is saved with it
    savedGame.scenario = {id: scenario.id, disaster: scenario.disaster, goal: scenario.goal,
                          disasterWait: scenario.disasterWait, scoreWait: scenario.scoreWait};
    return savedGame;
  });
};


// The sample cities of the original game, and three untouched landscapes
var CITIES = [
  {id: 'badnews', name: 'Bad News'}, {id: 'bruce', name: 'Bruce'}, {id: 'freds', name: 'Freds'},
  {id: 'haight', name: 'Haight'}, {id: 'happisle', name: 'Happy Isle'}, {id: 'joffburg', name: 'Joffburg'},
  {id: 'kamakura', name: 'Kamakura'}, {id: 'kobe', name: 'Kobe'}, {id: 'kowloon', name: 'Kowloon'},
  {id: 'kyoto', name: 'Kyoto'}, {id: 'linecity', name: 'Line City'}, {id: 'med_isle', name: 'Med Isle'},
  {id: 'ndulls', name: 'New Dullsville'}, {id: 'radial', name: 'Radial'}, {id: 'senri', name: 'Senri'},
  {id: 'southpac', name: 'South Pacific'}, {id: 'wetcity', name: 'Wet City'}, {id: 'yokohama', name: 'Yokohama'},
  {id: 'finnigan', name: 'Finnigan', empty: true}, {id: 'neatmap', name: 'Neat Map', empty: true},
  {id: 'splats', name: 'Splats', empty: true}
];


var getCity = function(id) {
  for (var i = 0; i < CITIES.length; i++) {
    if (CITIES[i].id === id)
      return CITIES[i];
  }

  return null;
};


var fetchCityFile = function(path, version) {
  var url = path + (version ? '?v=' + encodeURIComponent(version) : '');
  return fetch(url).then(function(response) {
    if (!response.ok)
      throw new Error('Could not load ' + url);

    return response.arrayBuffer();
  });
};


// Fetches a sample city, and resolves to a saved game ready to be played
var loadCity = function(id, version) {
  var city = getCity(id);
  if (city === null)
    return Promise.reject(new Error('Unknown city ' + id));

  return fetchCityFile('cities/' + id + '.cty', version).then(function(buffer) {
    // The empty landscapes start a new city, with the usual funds
    return CityFile.read(buffer, city.empty ? {name: city.name, cityTime: 0, funds: 20000} : {name: city.name});
  });
};


var Scenarios = {
  GOAL_METROPOLIS: GOAL_METROPOLIS,
  GOAL_TRAFFIC: GOAL_TRAFFIC,
  GOAL_CRIME: GOAL_CRIME,
  GOAL_SCORE: GOAL_SCORE,
  GOAL_TEXT: GOAL_TEXT,
  list: SCENARIOS,
  get: get,
  load: load,
  cities: CITIES,
  getCity: getCity,
  loadCity: loadCity
};


export { Scenarios };
