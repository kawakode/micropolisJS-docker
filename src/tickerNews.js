/* KawaCity, a modified version of micropolisJS. Adapted by Graeme McCutcheon from Micropolis.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

import { Evaluation } from './evaluation.js';
import { I18n } from './i18n.js';
import { French } from './lang/fr.js';
import * as Messages from './messages.ts';
import { Text } from './text.js';

// What the news ticker says (see Ticker). At least one item in three tells how the city is doing: disasters as they
// are reported, then the most pressing of the city's troubles with what to do about them, or how well it is going.
// The others are jokes about what the mayor has been up to lately.
//
// Each item is {kind, tag, text}, with the coordinates x and y of the place it is about, if any. Its kind is alert,
// warning, advice or good for the city's news, and joke for the jokes.
//
// The news is written in English, and translated (see I18n); the jokes are written anew in each language, as puns
// don't translate.

var ALERT = 3;
var WARNING = 2;
var ADVICE = 1;
var GOOD = 0;

var KINDS = ['good', 'advice', 'warning', 'alert'];
var TAGS = ['CITY', 'ADVISOR', 'WARNING', 'ALERT'];
var JOKE_TAGS = ['GOSSIP', 'RUMOUR', 'OPINION', 'SATIRE'];

// News that interrupts the ticker as soon as it comes
var BREAKING = {};
BREAKING[Messages.EARTHQUAKE] = 'Major earthquake in {city}! Put out the fires, then rebuild.';
BREAKING[Messages.EXPLOSION_REPORTED] = 'Explosion reported! Fires may break out around it.';
BREAKING[Messages.FIRE_REPORTED] = 'Fire reported! Fire stations nearby put fires out faster.';
BREAKING[Messages.FIREBOMBING] = 'Firebombing reported! Fires are breaking out across {city}.';
BREAKING[Messages.FLOODING_REPORTED] = 'Flooding reported! The water will recede in time.';
BREAKING[Messages.MONSTER_SIGHTED] = 'A monster has been sighted in {city}!';
BREAKING[Messages.NUCLEAR_MELTDOWN] = 'Nuclear meltdown! The area will stay radioactive for a very long time.';
BREAKING[Messages.TORNADO_SIGHTED] = 'Tornado reported! Rebuild what it flattens once it has passed.';
BREAKING[Messages.HELICOPTER_CRASHED] = 'A helicopter has crashed!';
BREAKING[Messages.PLANE_CRASHED] = 'A plane has crashed!';
BREAKING[Messages.SHIP_CRASHED] = 'Shipwreck reported!';
BREAKING[Messages.TRAIN_CRASHED] = 'A train has crashed!';
BREAKING[Messages.NOT_ENOUGH_POWER] = 'Blackouts reported: {city} needs more power plants.';
BREAKING[Messages.BLACKOUTS_REPORTED] = 'Brownouts reported: build another power plant.';
BREAKING[Messages.NO_MONEY] = '{city} has gone broke! Raise taxes, or cut spending in the Budget window.';

var MILESTONES = {};
MILESTONES[Messages.REACHED_TOWN] = '{city} is now a town: the population passes 2,000!';
MILESTONES[Messages.REACHED_CITY] = '{city} is now a city: the population passes 10,000!';
MILESTONES[Messages.REACHED_CAPITAL] = '{city} is now a capital: the population passes 50,000!';
MILESTONES[Messages.REACHED_METROPOLIS] = '{city} is now a metropolis: the population passes 100,000!';
MILESTONES[Messages.REACHED_MEGALOPOLIS] = '{city} is now a megalopolis: the population passes 500,000!';

// How the city's classes are named in a sentence
var CLASSES = {};
CLASSES[Evaluation.CC_VILLAGE] = 'class|village';
CLASSES[Evaluation.CC_TOWN] = 'class|town';
CLASSES[Evaluation.CC_CITY] = 'class|city';
CLASSES[Evaluation.CC_CAPITAL] = 'class|capital';
CLASSES[Evaluation.CC_METROPOLIS] = 'class|metropolis';
CLASSES[Evaluation.CC_MEGALOPOLIS] = 'class|megalopolis';

// The problems citizens complain about in the evaluation, and how to solve them
var PROBLEMS = {};
PROBLEMS[Evaluation.CRIME] = ['crime', 'build police stations where it is worst, and fund them fully'];
PROBLEMS[Evaluation.POLLUTION] = ['pollution', 'keep industry away from homes, plant parks and choose clean power'];
PROBLEMS[Evaluation.HOUSING] = ['housing costs', 'zone more homes, away from the expensive centre'];
PROBLEMS[Evaluation.TAXES] = ['taxes', 'lower the tax rate in the Budget window'];
PROBLEMS[Evaluation.TRAFFIC] = ['traffic', 'add rail, avenues or highways where the roads jam'];
PROBLEMS[Evaluation.UNEMPLOYMENT] = ['unemployment', 'zone more commercial and industrial land'];
PROBLEMS[Evaluation.FIRE] = ['fires', 'build fire stations, and fund them fully'];

// The deals with the neighbouring cities that are not in force (see Neighbours), and what they need. With another
// player's city, {owner} is its mayor and {deal} the deal's name.
var ON_HOLD = {
  trade: 'The trade agreement with {name} is on hold: build a road or a railway to the {side} edge of the map.',
  buyPower: 'The electricity bought from {name} is on hold: build a power line to the {side} edge of the map.',
  sellPower: 'The electricity sold to {name} is on hold: build a power line to the {side} edge of the map.',
  noPower: '{name} gets none of the electricity it buys: link the power line at the {side} edge to the grid, or build ' +
           'another power plant.',
  noPowerBought: 'No electricity comes from {name}: {owner} has none to spare at their edge.',
  proposed: 'Deal proposed to {name} ({deal}): it waits for {owner} to sign it too.',
  offered: '{owner}, mayor of {name}, offers a deal ({deal}): sign it in the Neighbours window to accept.',
  theirLinkTrade: 'The trade agreement with {name} waits for {owner} to build a road or a railway to their edge.',
  theirLinkPower: 'The power deal with {name} waits for {owner} to build a power line to their edge.'
};


// What a deal on hold needs, and its parameters
var onHoldNews = function(deal) {
  var params = {name: deal.name, side: I18n.t(Text.edges[deal.side])};
  if (!deal.player)
    return [ON_HOLD[deal.state === 'noPower' ? 'noPower' : deal.kind], params];

  params.owner = deal.ownerName;
  params.deal = I18n.t(Text.deals[deal.kind]);

  switch (deal.state) {
    case 'proposed':
    case 'offered':
      return [ON_HOLD[deal.state], params];

    case 'theirLink':
      return [deal.kind === 'trade' ? ON_HOLD.theirLinkTrade : ON_HOLD.theirLinkPower, params];

    case 'noPower':
      return [deal.kind === 'buyPower' ? ON_HOLD.noPowerBought : ON_HOLD.noPower, params];
  }

  // Our own link is missing: the city's name says whose it is
  params.name = I18n.t('{name} ({owner})', {name: deal.name, owner: deal.ownerName});
  return [ON_HOLD[deal.kind], params];
};

// The jokes, by topic: something the mayor did (a tool's name, a change of the budget...), idle when the mayor has
// done nothing for a while, and generic jokes for any time. {city}, {n} (how many times the mayor did it), {pop},
// {yes} and {no} (the approval rating), {tax} and {funds} (with its currency) are filled in; a joke is only told when
// they make sense. Each language has jokes on the same topics (see lang/).
var JOKES = {
  road: [
    'Mayor paves the way for re-election, one street at a time.',
    '{n} tiles of road and counting: asphalt suppliers name the Mayor Customer of the Year.',
    'Critics accuse the Mayor of taking the easy road. The Mayor points out it is a street.',
    'New street opens. The Mayor calls it "a step in the right direction, and then another, and another".'
  ],
  dirtroad: [
    'Dirt roads approved: the Mayor calls it down-to-earth infrastructure.',
    'New dirt road opens. Car wash owners thank the Mayor personally.',
    'Mayor defends dirt roads: "They are unpaved, not unloved."'
  ],
  avenue: [
    'New avenue unveiled. The Mayor promises to explore every avenue. Literally.',
    'Mayor widens the streets: "Twice the lanes, twice the fun, twice the upkeep."'
  ],
  highway: [
    'New highway opens. Commuters can now get stuck in traffic twice as fast.',
    'Mayor on the new highway: "Life is a highway. I just zone it."',
    'Highway inaugurated. The Mayor insists it is the highway or the highway.'
  ],
  rail: [
    'Mayor lays more track. Critics say the plan has gone off the rails.',
    'Rail fans thrilled: "This Mayor is finally on the right track."',
    'New railway line opens. Commuters warn of a long training period.'
  ],
  wire: [
    'Mayor strings up more power lines. Residents find it shocking.',
    'Power lines everywhere: the Mayor claims to be "very well connected".',
    'Opposition calls the power grid a tangled mess. The Mayor calls it current affairs.'
  ],
  coal: [
    'New coal plant opens. The Mayor promises a bright, if slightly smoky, future.',
    'Mayor defends the coal plant: "It is not smog. It is atmosphere."',
    'Coal power approved. Laundry hung out to dry now comes back grey.'
  ],
  nuclear: [
    'Nuclear plant approved. The Mayor says the project is glowing with promise.',
    'Asked about safety at the new reactor, the Mayor gave a half-life answer.',
    'Mayor tours the nuclear plant and describes the visit as radiant.'
  ],
  gas: [
    'Gas power plant opens. The Mayor says the decision was a gas.',
    'Mayor on the new gas plant: "Now we are cooking."'
  ],
  solar: [
    'Solar farm opens: the Mayor\'s ideas finally see the light of day.',
    'Mayor praises solar power: "A bright idea. On sunny days."'
  ],
  wind: [
    'Wind turbine unveiled. The opposition notes the Mayor\'s speeches already provide plenty of hot air.',
    'Mayor on wind power: "It is a turn for the better."',
    'New wind farm. The Mayor calls running the city "a breeze".'
  ],
  residential: [
    'Mayor zones more homes: "There is no place like home, so let\'s have lots of them."',
    'New homes zoned. Estate agents say the Mayor has a lot on their plate.',
    '{n} residential zones so far. The Mayor is running out of street names.',
    'Mayor\'s housing plan: "Build it and they will come. Then they will complain about parking."'
  ],
  commercial: [
    'Mayor zones more shops. Economists say big things are in store for {city}.',
    'New commercial district opens. The Mayor calls it retail therapy for the whole city.',
    'Mayor\'s commercial zones described as "a real bargain". Prices may vary.'
  ],
  industrial: [
    'New factories zoned. The Mayor promises jobs, smoke, and more jobs.',
    'Industrial zone approved. Workers say the Mayor really knows how to make things happen.',
    'Mayor visits the new industrial zone and leaves covered in soot and enthusiasm.'
  ],
  police: [
    'New police station opens. Crime reportedly arrested in its tracks.',
    'Mayor unveils a police station. Local criminals call it a cop-out.',
    'Police chief thanks the Mayor: "We will keep an eye on things. And on you."'
  ],
  fire: [
    'New fire station unveiled. The Mayor calls public safety a burning issue.',
    'Mayor slides down the pole at the new fire station. Ribbon cutting postponed for first aid.',
    'Firefighters thank the Mayor: "Your support really fired us up."'
  ],
  school: [
    'New school opens. The Mayor finally shows some class.',
    'Mayor visits the new school and fails a pop quiz on zoning.'
  ],
  university: [
    'University founded. The Mayor receives an honorary degree in Clicking Things.',
    'New university opens. Students protest against the Mayor at once. Tradition is respected.'
  ],
  park: [
    'More parks! The Mayor is turning over a new leaf.',
    '{n} parks so far. Squirrels endorse the Mayor for a second term.',
    'Mayor opens another park: "Green is the new grey."'
  ],
  garden: [
    'Another garden! Critics call it a blooming waste of money; supporters say it is growing on them.',
    'New flower beds planted. The Mayor\'s popularity is in full bloom.'
  ],
  plaza: [
    'New plaza opens. The Mayor calls it a fair and square deal.',
    'Mayor unveils a plaza with a fountain. Pigeons hold a celebration.'
  ],
  bigpark: [
    'Big park opens. The Mayor calls it a walk in the park, which it is.',
    'The Mayor\'s new park has a pond. Ducks pledge their votes.'
  ],
  stadium: [
    'New stadium opens. The Mayor kicks off the season and misses the ball.',
    'Stadium inaugurated. Fans chant the Mayor\'s name, mostly correctly.'
  ],
  port: [
    'Seaport opens. The Mayor\'s plans are finally shipshape.',
    'New port opens. Sailors describe the Mayor as peerless. Or pierless.'
  ],
  airport: [
    'Airport opens. The Mayor\'s ambitions take off.',
    'Mayor cuts the ribbon at the new airport. The ribbon\'s luggage is still missing.'
  ],
  trees: [
    'Mayor plants trees: "Leaf it to me."',
    'New forest planted. The Mayor is now officially rooted in the community.',
    'The Mayor has planted {n} trees. Lumberjacks request a meeting.'
  ],
  water: [
    'Mayor digs a new lake. City Hall calls it a deep and meaningful project.',
    'Critics say the Mayor\'s canal plan does not hold water. It does, actually.'
  ],
  landfill: [
    'Landfill approved: the Mayor says it is time to fill in the blanks.',
    'Mayor fills in water to build more. The fish have filed a complaint.'
  ],
  bulldozer: [
    'Mayor bulldozes another block: "Demolition is just construction in reverse."',
    'The Mayor\'s bulldozer spotted again. Sources describe a wrecking-ball personality.',
    '{n} tiles bulldozed. Contractors call the Mayor a smashing success.',
    'Mayor clears land "to make room for the future". The future has not commented.'
  ],
  query: [
    'Mayor seen inspecting buildings again. "Just curious," says City Hall.',
    'The Mayor asks so many questions that the census bureau wants to hire them.',
    'Residents report the Mayor peering through their windows "for statistical purposes".'
  ],
  noMoney: [
    'The Mayor tried to build without the funds. The bank said: "Nice try."',
    'Treasury empty. The Mayor checks under the cushions of the City Hall sofa.',
    'Mayor offers to pay contractors in compliments. Contractors decline.'
  ],
  needsBulldoze: [
    'Mayor tries to build on top of a building. Architects: "That is not how floors work."',
    'The Mayor tried to fit two buildings in one spot. Physics wins again.'
  ],
  taxUp: [
    'Taxes up to {tax}%. The Mayor calls it "a voluntary donation, but mandatory".',
    'Tax rise announced. Citizens are taxed; the Mayor is relaxed.',
    'Mayor raises taxes to {tax}%: "Think of it as a subscription to {city}."'
  ],
  taxDown: [
    'Taxes cut to {tax}%. The Mayor\'s popularity rises; the treasury sinks.',
    'Mayor lowers taxes. Wallets cheer, accountants weep.'
  ],
  policeCut: [
    'Police funding cut. Local criminals send the Mayor a thank-you card.',
    'Police budget trimmed: officers asked to chase suspects at walking pace.'
  ],
  fireCut: [
    'Fire department funding cut. Firefighters asked to blow out fires really hard.',
    'Fire budget trimmed. The Mayor suggests buckets "for the smaller fires".'
  ],
  roadCut: [
    'Road budget cut. The Mayor calls potholes "natural speed bumps".',
    'Road repairs postponed. The Mayor promises the potholes will be "character-building".'
  ],
  'disaster:Monster': [
    'Mayor denies inviting the monster: "We just wanted more tourists."',
    'The monster was a stress test, says City Hall. The city is stressed.'
  ],
  'disaster:Fire': [
    'Firefighters ask the Mayor to please stop "testing" them.',
    'Mayor starts a fire "to check the smoke alarms". They work.'
  ],
  'disaster:Flood': [
    'The Mayor calls the flood a free municipal swimming pool.',
    'Mayor orders a flood. Umbrella sales skyrocket; boat sales too.'
  ],
  'disaster:Crash': [
    'Air traffic control asks the Mayor to stop pressing the big red button.',
    'Plane crash ordered by City Hall. The airline is reconsidering its routes.'
  ],
  'disaster:Meltdown': [
    'The Mayor triggers a meltdown. Residents now glow with civic pride.',
    'Nuclear meltdown on purpose. The Mayor calls it "an energetic decision".'
  ],
  'disaster:Tornado': [
    'Mayor summons a tornado. City Hall calls it "a whirlwind of a term".',
    'Tornado ordered by City Hall: the Mayor wanted to blow away the competition.'
  ],
  'disaster:Earthquake': [
    'Earthquake! The Mayor insists they were just shaking things up.',
    'Mayor orders an earthquake. Seismologists rate the decision 8.5 on the Richter scale.'
  ],
  disastersOff: [
    'Mayor bans disasters by decree. Monsters\' union furious.',
    'Disasters outlawed in {city}. Tornadoes now need a permit.'
  ],
  nightOff: [
    'The Mayor abolishes night. Owls protest outside City Hall.'
  ],
  harder: [
    'Mayor makes life harder on purpose. "Character building," says City Hall.'
  ],
  easier: [
    'Mayor turns the difficulty down. Nobody is judging. Well, a little.'
  ],
  pause: [
    'The Mayor has stopped time again. Clockmakers\' union files a complaint.',
    'Time paused by City Hall. Citizens frozen in mid-sneeze demand answers.'
  ],
  fast: [
    'Mayor sets time to fast-forward. Citizens report ageing rapidly.',
    'Time sped up by order of the Mayor. Birthday cake sales triple.'
  ],
  slow: [
    'Mayor slows time down: "It is a marathon, not a sprint."'
  ],
  save: [
    'Mayor saves the city. Not from a disaster: to disk.',
    'City saved. The Mayor can now make mistakes with confidence.'
  ],
  picture: [
    'The Mayor takes yet another picture of the city. Postcard sales soar.',
    'Mayor\'s latest city photo goes viral. Well, the Mayor\'s family liked it.'
  ],
  deal: [
    'The Mayor signs a deal with a neighbouring city. Both sides claim they got the better end of it.',
    'New partnership with the neighbours: the Mayor\'s handshake reportedly lasted eleven minutes.',
    'Diplomacy at City Hall: the Mayor swaps gifts with a neighbouring mayor. Ours got a mug.',
    '{n} deals with the neighbours so far. The Mayor now asks to be called Minister of Foreign Affairs.'
  ],
  dealEnded: [
    'The Mayor tears up a deal with the neighbours. The neighbours keep the mug.',
    'Partnership ended. The Mayor tells the neighbours: "It is not you, it is us."'
  ],
  idle: [
    'Mayor not seen in a while. City Hall says they are "strategically observing".',
    'Quiet day at City Hall: the Mayor is reportedly watching the traffic, for fun.',
    'The Mayor has been staring at the map for minutes. Experts call it visionary planning.'
  ],
  generic: [
    'Poll: {yes}% of citizens approve of the Mayor. The other {no}% have met the Mayor.',
    'Mayor\'s new slogan: "Zoning in on the future."',
    'City Hall coffee machine broken. The Mayor declares a state of emergency.',
    'Local pigeon runs for city council. The Mayor welcomes the competition.',
    'Mayor promises to end traffic jams. Traffic reportedly laughing.',
    'Leaked: the Mayor\'s to-do list. 1. Build city. 2. ??? 3. Re-election.',
    'Weather forecast for {city}: sunny, with a chance of zoning.',
    'Survey: 9 in 10 residents could not name the Mayor. The tenth was the Mayor.',
    'City Hall announces a plan to plan more plans.',
    'Local cat named honorary deputy mayor. Approval ratings soar.',
    'The Mayor denies rumours of a secret monorail. For now.',
    'The Mayor\'s lunch break enters its third hour. City Hall calls it a working lunch.',
    '{funds} in the bank. The Mayor reportedly wants to spend it all on fountains.',
    'Population {pop}. The Mayor has personally met at least six of them.'
  ]
};

// The bulldozer's sizes are one topic
var TOPICS = {bulldozer3: 'bulldozer', bulldozer5: 'bulldozer', bulldozer7: 'bulldozer'};

// How many jokes are remembered, so as not to tell them again too soon
var JOKE_MEMORY = 40;

// After this long without doing anything, the mayor is idle (in milliseconds)
var IDLE_TIME = 3 * 60 * 1000;

// The mayor's actions are forgotten after this long (in milliseconds)
var ACTION_MEMORY = 10 * 60 * 1000;


var JOKES_BY_LANGUAGE = {en: JOKES, fr: French.jokes};


var jokes = function() {
  return JOKES_BY_LANGUAGE[I18n.getLanguage()] || JOKES;
};


// cityName: shown in the news. random and now can be replaced, for testing.
function TickerNews(cityName, random, now) {
  this._city = cityName;
  this._random = random || Math.random;
  this._now = now || Date.now;

  // News to be shown next: {subject, x, y}
  this._breaking = [];

  // The last places where fires and floods were reported
  this._lastFire = null;
  this._lastFlood = null;

  // How many jokes have been told since the last news of the city: the ticker starts with the news
  this._sinceNews = 2;

  // When each topic of the city's news was last shown, counted in news items
  this._newsCount = 0;
  this._newsShown = {};

  // The mayor's actions: how many times each was done, and the most recent ones
  this._counts = {};
  this._recent = [];
  this._lastAction = this._now();

  this._toldJokes = [];
  this._lastTopic = null;
}


// The city's new name, for the news
TickerNews.prototype.setCityName = function(cityName) {
  this._city = cityName;
};


// A message from the simulation (see Game.processFrontEndMessage): disasters and milestones are news at once
TickerNews.prototype.report = function(subject, data) {
  var at = data && typeof(data.x) === 'number' && typeof(data.y) === 'number' ? {x: data.x, y: data.y} : null;

  if (subject === Messages.FIRE_REPORTED || subject === Messages.FIREBOMBING || subject === Messages.EARTHQUAKE)
    this._lastFire = at || this._lastFire;
  else if (subject === Messages.FLOODING_REPORTED)
    this._lastFlood = at || this._lastFlood;

  if (BREAKING[subject] === undefined && MILESTONES[subject] === undefined)
    return;

  // The same news again before it was shown replaces it
  this._breaking = this._breaking.filter(function(item) { return item.subject !== subject; });

  var item = {subject: subject};
  if (at !== null) {
    item.x = at.x;
    item.y = at.y;
  }

  this._breaking.push(item);
  if (this._breaking.length > 3)
    this._breaking.shift();
};


// Remembers something the mayor did (topic: one of those of JOKES), count times
TickerNews.prototype.record = function(topic, count) {
  topic = TOPICS[topic] || topic;
  if (JOKES[topic] === undefined)
    return;

  var now = this._now();
  this._counts[topic] = (this._counts[topic] || 0) + (count || 1);
  this._recent.push({topic: topic, time: now});
  if (this._recent.length > 30)
    this._recent.shift();
  this._lastAction = now;
};


// The next item of the ticker, given the city's status (see Simulation.getCityStatus)
TickerNews.prototype.next = function(status) {
  var item;

  if (this._breaking.length > 0) {
    item = this._breakingNews(this._breaking.shift());
  } else {
    var report = this.cityReport(status);
    var emergency = report.length > 0 && report[0].severity === ALERT;

    // At least one item in three is about the city, and every other one in an emergency
    if (this._sinceNews >= 2 || (emergency && this._sinceNews >= 1))
      item = this._pickNews(report);
    else
      item = this._joke(status);
  }

  this._sinceNews = item.kind === 'joke' ? this._sinceNews + 1 : 0;
  return item;
};


TickerNews.prototype._breakingNews = function(news) {
  var alert = BREAKING[news.subject] !== undefined;
  var item = {kind: KINDS[alert ? ALERT : GOOD], tag: I18n.t(alert ? 'BREAKING' : 'GOOD NEWS'),
              text: I18n.t(alert ? BREAKING[news.subject] : MILESTONES[news.subject], {city: this._city})};
  if (typeof(news.x) === 'number') {
    item.x = news.x;
    item.y = news.y;
  }

  return item;
};


// What is worth saying about the city, the most pressing first: [{severity, key, text, x, y}]. Each text is filled in
// with the context of the jokes (see _context), and the item's own params.
TickerNews.prototype.cityReport = function(status) {
  var report = [];
  var census = status.census;

  var add = function(severity, key, text, params, at) {
    var item = {severity: severity, key: key, text: text, params: params || {}};
    if (at) {
      item.x = at.x;
      item.y = at.y;
    }
    report.push(item);
  };

  // Disasters
  if (status.monster)
    add(ALERT, 'monster', 'A monster is rampaging through {city}! It will leave in time: rebuild behind it.', null, status.monster);

  if (status.tornado)
    add(ALERT, 'tornado', 'A tornado is tearing across {city}! Rebuild once it has blown over.', null, status.tornado);

  if (status.flooding)
    add(ALERT, 'flood', 'Flood water covers part of {city}. It will recede on its own.', null, this._lastFlood);

  if (census.firePop > 0) {
    add(ALERT, 'fire', census.firePop === 1 ? 'A fire is burning! Fire stations nearby put it out faster.' :
                       'Fire is spreading over {n} tiles! Fire stations nearby put it out faster.',
        {n: census.firePop}, this._lastFire);
  }

  // Money
  if (status.funds < 100)
    add(ALERT, 'broke', '{city} is broke ({funds})! Raise taxes or cut services in the Budget window.');
  else if (status.funds < 1000)
    add(WARNING, 'funds', 'Only {funds} left in the treasury: spend wisely, or raise taxes.');

  if (status.cashFlow < 0) {
    add(WARNING, 'deficit', 'Upkeep costs {deficit} a year more than taxes bring in: raise taxes or trim services.',
        {deficit: I18n.money(-status.cashFlow)});
  }

  // Power
  var zones = census.poweredZoneCount + census.unpoweredZoneCount;
  var plants = census.coalPowerPop + census.nuclearPowerPop + census.gasPowerPop + census.solarPowerPop + census.windPowerPop;
  var homesAndJobs = census.resZonePop + census.comZonePop + census.indZonePop;

  if (homesAndJobs === 0)
    add(ADVICE, 'start', 'Welcome to {city}! Build a power plant, zone homes, shops and factories, and link them with roads and power lines.');

  if (homesAndJobs > 0 && plants === 0 && !status.powerBought) {
    add(WARNING, 'noPower', 'No power plant in {city}: zones won\'t grow without electricity.');
  } else if (census.unpoweredZoneCount > 0) {
    add(census.unpoweredZoneCount > zones * 0.3 ? WARNING : ADVICE, 'unpowered',
        census.unpoweredZoneCount === 1 ? 'A zone has no power: build another plant, or connect it with power lines.' :
        '{n} zones without power: build another plant, or connect them with power lines.', {n: census.unpoweredZoneCount});
  }

  // Buildings the city needs to grow
  if (status.resCap)
    add(WARNING, 'stadium', 'Residents demand a stadium: homes won\'t grow any further without one.');

  if (status.comCap)
    add(WARNING, 'airport', 'Commerce needs an airport to grow any further.');

  if (status.indCap)
    add(WARNING, 'seaport', 'Industry needs a seaport to grow any further.');

  // Deals with the neighbouring cities that wait for their link, or for power to sell: the first is shown, where its link
  // should go
  var onHold = status.dealsOnHold || [];
  if (onHold.length > 0) {
    var deal = onHold[0];
    var news = onHoldNews(deal);
    add(ADVICE, 'dealOnHold', news[0], news[1], deal);
  }

  if (census.totalPop > 60 && census.policeStationPop === 0)
    add(WARNING, 'noPolice', 'Citizens demand a police station: crime grows unchecked without one.');

  if (census.totalPop > 60 && census.fireStationPop === 0)
    add(WARNING, 'noFire', 'Citizens demand a fire station: nothing would stop a fire today.');

  // The budget
  var funding = [['policeFunding', 'Police stations are funded at {percent}%: crime will rise.', status.policePercent,
                  status.policeMaintenance],
                 ['fireFunding', 'Fire stations are funded at {percent}%: fires will spread further.', status.firePercent,
                  status.fireMaintenance],
                 ['roadFunding', 'Roads are funded at {percent}%: they are falling apart.', status.roadPercent,
                  status.roadMaintenance]];
  funding.forEach(function(f) {
    if (f[3] > 0 && f[2] < 0.9)
      add(WARNING, f[0], f[1], {percent: Math.round(f[2] * 100)});
  });

  if (status.tax > 12)
    add(WARNING, 'taxHigh', 'Taxes at {tax}% are driving people away from {city}.');

  // Living conditions
  if (census.pollutionAverage > 60)
    add(WARNING, 'pollution', 'Pollution is very high: keep industry away from homes, plant parks and choose clean power.',
        null, status.pollutionMax);

  if (census.crimeAverage > 100)
    add(WARNING, 'crime', 'Crime is very high: build police stations where it is worst.');

  if (census.trafficAverage > 60)
    add(WARNING, 'traffic', 'Traffic jams all over {city}: add rail, avenues or highways.');

  if (status.population > 0 && status.approval < 30 && status.cityTime > 48)
    add(WARNING, 'approval', 'Only {yes}% of citizens approve of the Mayor: time to listen to their worries.');

  if (status.populationDelta < 0) {
    add(WARNING, 'shrinking', status.populationDelta === -1 ? '{city} lost a resident last year.' :
                              '{city} lost {n} residents last year.', {n: -status.populationDelta});
  }

  // Demand
  if (status.resValve > 1000)
    add(ADVICE, 'demandRes', 'People are queueing to move to {city}: zone more homes.');
  else if (status.resValve < -1000)
    add(ADVICE, 'surplusRes', 'Too many empty homes: hold off on residential zones.');

  if (status.comValve > 750)
    add(ADVICE, 'demandCom', 'Shops are in demand: zone more commercial land.');
  else if (status.comValve < -750)
    add(ADVICE, 'surplusCom', 'Too many empty shops: hold off on commercial zones.');

  if (status.indValve > 750)
    add(ADVICE, 'demandInd', 'Industry wants to settle here: zone more industrial land.');
  else if (status.indValve < -750)
    add(ADVICE, 'surplusInd', 'Too many empty factories: hold off on industrial zones.');

  // What citizens complain about (an empty city is evaluated too)
  status.problems.slice(0, status.population > 0 ? 2 : 0).forEach(function(p, i) {
    var problem = PROBLEMS[p.problem];
    if (problem && p.votes >= 10) {
      add(ADVICE, 'problem' + p.problem,
          i === 0 ? 'Citizens\' biggest worry: {problem} ({votes}% of voters). To fix it, {advice}.' :
                    'Also worrying citizens: {problem} ({votes}% of voters). To fix it, {advice}.',
          {problem: I18n.t(problem[0]), votes: p.votes, advice: I18n.t(problem[1])});
    }
  });

  // And how well it is going
  if (status.population > 0) {
    add(GOOD, 'summary', '{city}, {class}: population {pop}, approval {yes}%, score {score}.',
        {class: I18n.t(CLASSES[status.cityClass] || 'class|village'), score: status.score});
  }

  if (status.populationDelta > 0) {
    add(GOOD, 'growing', status.populationDelta === 1 ? '{city} welcomed a new resident last year.' :
                         '{city} welcomed {n} new residents last year.', {n: status.populationDelta});
  }

  if (status.funds >= 1000)
    add(GOOD, 'treasury', 'Treasury: {funds}, with taxes at {tax}%.');

  if (!report.some(function(item) { return item.severity >= WARNING; }))
    add(GOOD, 'quiet', 'All quiet in {city}: no disaster, no crisis. Enjoy it while it lasts.');

  var context = this._context(status);
  report.forEach(function(item) {
    item.text = this._fill(I18n.t(item.text), Object.assign({}, context, item.params));
    delete item.params;
  }, this);

  report.sort(function(a, b) { return b.severity - a.severity; });
  return report;
};


// The most pressing news that was not shown lately
TickerNews.prototype._pickNews = function(report) {
  var best = null;
  var bestScore = -Infinity;

  for (var i = 0; i < report.length; i++) {
    var shown = this._newsShown[report[i].key];
    var age = shown === undefined ? 6 : Math.min(6, this._newsCount - shown);
    var score = report[i].severity * 10 + age * 3;
    if (score > bestScore) {
      best = report[i];
      bestScore = score;
    }
  }

  this._newsCount++;
  this._newsShown[best.key] = this._newsCount;

  var item = {kind: KINDS[best.severity], tag: I18n.t(TAGS[best.severity]), text: best.text};
  if (typeof(best.x) === 'number') {
    item.x = best.x;
    item.y = best.y;
  }

  return item;
};


// A joke, preferably about what the mayor did lately
TickerNews.prototype._joke = function(status) {
  var context = this._context(status);
  var topic = this._pickTopic();
  var text = topic === 'generic' ? null : this._pickJoke(topic, context);

  if (text === null) {
    topic = 'generic';
    text = this._pickJoke(topic, context);
  }

  // Every generic joke has been told lately: start again
  if (text === null) {
    this._toldJokes = [];
    text = this._pickJoke(topic, context);
  }

  this._lastTopic = topic;
  return {kind: 'joke', tag: I18n.t(JOKE_TAGS[Math.floor(this._random() * JOKE_TAGS.length)]), text: text};
};


// Chooses what to joke about: the mayor's recent actions are the likeliest, the most recent above all
TickerNews.prototype._pickTopic = function() {
  var now = this._now();
  var weights = {generic: 0.6};

  this._recent = this._recent.filter(function(action) { return now - action.time < ACTION_MEMORY; });
  this._recent.forEach(function(action) {
    weights[action.topic] = (weights[action.topic] || 0) + 1 / (1 + (now - action.time) / 30000);
  });

  if (now - this._lastAction > IDLE_TIME)
    weights.idle = 1.5;

  // Not twice in a row on the same subject, if possible
  if (this._lastTopic !== null && weights[this._lastTopic] !== undefined)
    weights[this._lastTopic] *= 0.3;

  var topics = Object.keys(weights);
  var total = topics.reduce(function(sum, topic) { return sum + weights[topic]; }, 0);
  var r = this._random() * total;
  for (var i = 0; i < topics.length; i++) {
    r -= weights[topics[i]];
    if (r < 0)
      return topics[i];
  }

  return 'generic';
};


// A joke on the topic, in the current language, that was not told lately and makes sense now, filled in; null if
// there is none
TickerNews.prototype._pickJoke = function(topic, context) {
  var count = this._counts[topic] || 0;
  var told = this._toldJokes;

  var choices = (jokes()[topic] || []).filter(function(joke) {
    if (told.indexOf(joke) !== -1)
      return false;

    if (joke.indexOf('{n}') !== -1 && count < 3)
      return false;

    return context.pop > 0 || (joke.indexOf('{pop}') === -1 && joke.indexOf('{yes}') === -1);
  });

  if (choices.length === 0)
    return null;

  var joke = choices[Math.floor(this._random() * choices.length)];
  told.push(joke);
  if (told.length > JOKE_MEMORY)
    told.shift();

  return this._fill(I18n.typeset(joke), Object.assign({n: count}, context));
};


TickerNews.prototype._context = function(status) {
  return {pop: status.population, yes: status.approval, no: 100 - status.approval, tax: status.tax,
          funds: I18n.money(status.funds)};
};


// Fills in {city} and the values of context (numbers are written the way the language does)
TickerNews.prototype._fill = function(text, context) {
  var city = this._city;

  return text.replace(/\{(\w+)\}/g, function(match, key) {
    if (key === 'city')
      return city;

    var value = context[key];
    if (value === undefined)
      return match;

    return typeof(value) === 'number' ? I18n.formatNumber(value) : value;
  });
};


TickerNews.JOKES = JOKES_BY_LANGUAGE;


export { TickerNews };
