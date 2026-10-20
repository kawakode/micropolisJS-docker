/* KawaCity: the city's goals, outside the scenarios: built one after another, they give the game a thread to follow.
 *
 * Each goal has a bit of its own in the city's save (Simulation.achievements, a mask): the bits never change, so a
 * goal may be added at the end but never taken out or moved. The list is in the order a city usually meets them: the
 * next goal shown is the first one not yet met.
 *
 * A goal is checked on the city's facts (see Simulation._achievementFacts): {census, population, funds, tax, score,
 * deals}.
 */

var ACHIEVEMENTS = [
  {id: 'school', bit: 0, name: 'First school', goal: 'Build a school.',
   met: function(f) { return f.census.schoolPop > 0; }},
  {id: 'park', bit: 1, name: 'Green spaces', goal: 'Build a big park.',
   met: function(f) { return f.census.parkPop > 0; }},
  {id: 'safety', bit: 2, name: 'Safe and sound', goal: 'Have a police station and a fire station.',
   met: function(f) { return f.census.policeStationPop > 0 && f.census.fireStationPop > 0; }},
  {id: 'stadium', bit: 3, name: 'Home team', goal: 'Build a stadium.',
   met: function(f) { return f.census.stadiumPop > 0; }},
  {id: 'deal', bit: 4, name: 'Good neighbours', goal: 'Make a deal with a neighbouring city.',
   met: function(f) { return f.deals > 0; }},
  {id: 'university', bit: 5, name: 'Higher learning', goal: 'Build a university.',
   met: function(f) { return f.census.universityPop > 0; }},
  {id: 'seaport', bit: 6, name: 'Open to the sea', goal: 'Build a seaport.',
   met: function(f) { return f.census.seaportPop > 0; }},
  {id: 'airport', bit: 7, name: 'Taking off', goal: 'Build an airport.',
   met: function(f) { return f.census.airportPop > 0; }},
  {id: 'cleanPower', bit: 8, name: 'Clean energy', goal: 'Power a city of 2,000 people with the sun and the wind only.',
   met: function(f) {
     var census = f.census;
     return f.population >= 2000 && census.solarPowerPop + census.windPowerPop > 0 &&
            census.coalPowerPop + census.gasPowerPop + census.nuclearPowerPop === 0;
   }},
  {id: 'quietStreets', bit: 9, name: 'Quiet streets', goal: 'Reach 10,000 people with little crime.',
   met: function(f) { return f.population >= 10000 && f.census.crimeAverage < 30; }},
  {id: 'greenCity', bit: 10, name: 'Green city',
   goal: 'Reach 10,000 people with no coal or gas plant, and little pollution.',
   met: function(f) {
     return f.population >= 10000 && f.census.coalPowerPop + f.census.gasPowerPop === 0 &&
            f.census.pollutionAverage < 50;
   }},
  {id: 'hub', bit: 11, name: 'Regional hub', goal: 'Have three deals with neighbouring cities at once.',
   met: function(f) { return f.deals >= 3; }},
  {id: 'coffers', bit: 12, name: 'Full coffers', goal: 'Have $100,000 in the bank.',
   met: function(f) { return f.funds >= 100000; }},
  {id: 'taxHaven', bit: 13, name: 'Tax haven', goal: 'Reach 20,000 people with taxes at 5% or less.',
   met: function(f) { return f.population >= 20000 && f.tax <= 5; }},
  {id: 'modelCity', bit: 14, name: 'Model city', goal: 'Reach a score of 800.',
   met: function(f) { return f.score >= 800; }}
];

// The bits of all the goals: any other bit of a save is dropped
var ALL = ACHIEVEMENTS.reduce(function(mask, a) { return mask | (1 << a.bit); }, 0);


var isMet = function(mask, achievement) {
  return (mask & (1 << achievement.bit)) !== 0;
};


// A mask as a save gives it: only the bits of known goals
var clean = function(mask) {
  return Number.isInteger(mask) ? mask & ALL : 0;
};


// The goals met with these facts that the mask does not have yet
var newlyMet = function(mask, facts) {
  return ACHIEVEMENTS.filter(function(a) {
    return !isMet(mask, a) && a.met(facts);
  });
};


// The next goal to meet, or null when all are met
var next = function(mask) {
  for (var i = 0; i < ACHIEVEMENTS.length; i++) {
    if (!isMet(mask, ACHIEVEMENTS[i]))
      return ACHIEVEMENTS[i];
  }

  return null;
};


var count = function(mask) {
  return ACHIEVEMENTS.filter(function(a) { return isMet(mask, a); }).length;
};


var byId = function(id) {
  for (var i = 0; i < ACHIEVEMENTS.length; i++) {
    if (ACHIEVEMENTS[i].id === id)
      return ACHIEVEMENTS[i];
  }

  return null;
};


var Achievements = {
  LIST: ACHIEVEMENTS,
  byId: byId,
  clean: clean,
  count: count,
  isMet: isMet,
  newlyMet: newlyMet,
  next: next
};


export { Achievements };
