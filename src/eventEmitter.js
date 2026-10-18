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

import { Config } from './config.js';

// KawaCity: each object keeps its own listeners, even when its whole class is decorated (several cities can then live
// side by side, on a server). They are kept in a property of the object that is created the first time a listener is
// added, and is not enumerable: it is never saved, copied or listed with the object's own properties.
var LISTENERS = '_events';


// The object's table of listeners, by event: created if asked to, else null when there is none yet. A table found on a
// prototype belongs to the prototype, not to this object.
var listenersOf = function(obj, create) {
  if (Object.prototype.hasOwnProperty.call(obj, LISTENERS))
    return obj[LISTENERS];

  if (!create)
    return null;

  var events = Object.create(null);
  Object.defineProperty(obj, LISTENERS, {value: events, enumerable: false, writable: false, configurable: true});
  return events;
};


var addListener = function(event, listener) {
  var events = listenersOf(this, true);
  if (!(event in events))
    events[event] = [];

  var listeners = events[event];
  if (listeners.indexOf(listener) === -1)
    listeners.push(listener);
};


var removeListener = function(event, listener) {
  var events = listenersOf(this, false);
  if (events === null || !(event in events))
    return;

  var listeners = events[event];
  var index = listeners.indexOf(listener);
  if (index !== -1)
    listeners.splice(index, 1);
};


var emitEvent = function(event, value) {
  if (event === undefined) {
    if (!Config.debug)
      console.warn('Sending undefined event!');
    else
      throw new Error('Sending undefined event!');
  }

  var events = listenersOf(this, false);
  if (events === null || !(event in events))
    return;

  // The listeners as they are now: a listener may add or remove listeners
  var listeners = events[event].slice();
  for (var i = 0, l = listeners.length; i < l; i++)
    listeners[i](value);
};


// Decorate the given object, by adding {add|remove}EventListener methods, and an internal '_emitEvent' method. A
// constructor is decorated through its prototype, for all its instances.
var EventEmitter = function(obj) {
  var addProps = function(obj, message) {
    var hasExistingProp = ['addEventListener', 'removeEventListener', '_emitEvent'].some(function(prop) {
      return obj[prop] !== undefined;
    });

    if (hasExistingProp)
      throw new Error('Cannot decorate ' + message + ': existing properties would be overwritten!');

    obj.addEventListener = addListener;
    obj.removeEventListener = removeListener;
    obj._emitEvent = emitEvent;
  };

  if (typeof(obj) === 'object')
    addProps(obj, 'object');
  else
    addProps(obj.prototype, 'constructor');

  return obj;
};


EventEmitter.LISTENERS = LISTENERS;


export { EventEmitter };
