/* KawaCity: the city's ordinances, as in SimCity 2000. Each one costs a little every year, more in a larger city,
 * and changes how the city lives: less crime, less pollution, more demand for some zones.
 *
 * The ordinances in force are a mask in the budget (Budget.ordinances): each ordinance has a bit of its own, which
 * never changes.
 *
 * effects: crime and pollution multiply the crime and the pollution of each neighbourhood (see BlockMapUtils), res,
 * com and ind add to the demand for zones at each update of the valves (see Valves.setValves).
 */

var ORDINANCES = [
  {id: 'streetLights', bit: 0, name: 'Street lighting', description: 'Lit streets: less crime.',
   base: 100, perThousand: 30, effects: {crime: 0.85}},
  {id: 'neighbourhoodWatch', bit: 1, name: 'Neighbourhood watch', description: 'Neighbours look out: a little less crime.',
   base: 50, perThousand: 10, effects: {crime: 0.92}},
  {id: 'recycling', bit: 2, name: 'Recycling', description: 'Less waste: less pollution.',
   base: 150, perThousand: 40, effects: {pollution: 0.85}},
  {id: 'cleanAir', bit: 3, name: 'Clean air rules',
   description: 'Much less pollution, but industry would rather go elsewhere.',
   base: 50, perThousand: 0, effects: {pollution: 0.8, ind: -30}},
  {id: 'tourism', bit: 4, name: 'Tourism campaign', description: 'Visitors come: more demand for shops.',
   base: 200, perThousand: 20, effects: {com: 40}},
  {id: 'housingGrants', bit: 5, name: 'Housing grants', description: 'Help to buy a home: more demand for homes.',
   base: 150, perThousand: 30, effects: {res: 40}}
];

var ALL = ORDINANCES.reduce(function(mask, o) { return mask | (1 << o.bit); }, 0);


var isOn = function(mask, ordinance) {
  return (mask & (1 << ordinance.bit)) !== 0;
};


// A mask as a save or a player gives it: only the bits of known ordinances
var clean = function(mask) {
  return Number.isInteger(mask) ? mask & ALL : 0;
};


// What an ordinance costs a year, in a city of this population
var costOf = function(ordinance, population) {
  return ordinance.base + Math.floor(ordinance.perThousand * Math.max(0, population) / 1000);
};


// What the ordinances in force cost a year
var cost = function(mask, population) {
  return ORDINANCES.reduce(function(total, o) {
    return total + (isOn(mask, o) ? costOf(o, population) : 0);
  }, 0);
};


// The effects of the ordinances in force: {crime, pollution, res, com, ind}
var effects = function(mask) {
  var result = {crime: 1, pollution: 1, res: 0, com: 0, ind: 0};
  ORDINANCES.forEach(function(o) {
    if (!isOn(mask, o))
      return;

    var e = o.effects;
    result.crime *= e.crime || 1;
    result.pollution *= e.pollution || 1;
    result.res += e.res || 0;
    result.com += e.com || 0;
    result.ind += e.ind || 0;
  });

  return result;
};


var Ordinances = {
  ALL: ALL,
  LIST: ORDINANCES,
  clean: clean,
  cost: cost,
  costOf: costOf,
  effects: effects,
  isOn: isOn
};


export { Ordinances };
