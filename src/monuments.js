/* KawaCity: the monuments, a reward for a growing city. Each one may only be built once the city has enough people
 * (a town for a statue, a city for a town hall, a capital for the tower): the tool bar shows them locked until then,
 * and the game (or, in a shared city, the server) refuses to build them.
 *
 * Built, they make the land around them more valuable (see BlockMapUtils): a monument adds its prestige to the
 * landmark map, smoothed over the neighbourhood like the other services.
 */

// The population each monument's tool needs
var UNLOCK = {statue: 2000, townhall: 10000, tower: 50000};


// The population a tool needs (0 for every tool but the monuments')
var requiredPopulation = function(toolName) {
  return Object.prototype.hasOwnProperty.call(UNLOCK, toolName) ? UNLOCK[toolName] : 0;
};


var isLocked = function(toolName, population) {
  return (population || 0) < requiredPopulation(toolName);
};


var Monuments = {
  UNLOCK: UNLOCK,
  isLocked: isLocked,
  requiredPopulation: requiredPopulation
};


export { Monuments };
