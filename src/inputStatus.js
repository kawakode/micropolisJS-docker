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
 * KawaCity: rewritten in 2026. Input is now handled with pointer events (mouse, pen and touch), tools are
 * applied by dragging with a preview, and the map can be panned and zoomed with the mouse, a touchpad, touch
 * gestures or the keyboard.
 *
 */

import $ from "jquery";

import { EventEmitter } from './eventEmitter.js';
import { GameCanvas } from './gameCanvas.js';
import { GameTools } from './gameTools.js';
import * as Messages from './messages.ts';
import { MiscUtils } from './miscUtils.js';

// How the tools behave when dragged
var TOOL_LINE = 'line';         // Lays an L-shaped path of tiles from the start of the drag (roads, rails, wires)
var TOOL_AREA = 'area';         // Fills the dragged rectangle (bulldozer, parks)
var TOOL_BUILDING = 'building'; // Places a grid of buildings over the dragged rectangle
var TOOL_SINGLE = 'single';     // Acts on a single tile on click (query)

var toolCategories = {
  road: TOOL_LINE,
  rail: TOOL_LINE,
  wire: TOOL_LINE,
  bulldozer: TOOL_AREA,
  park: TOOL_AREA,
  query: TOOL_SINGLE
};

// Keyboard shortcuts for selecting tools
var toolShortcuts = {
  '1': 'residential',
  '2': 'commercial',
  '3': 'industrial',
  '4': 'road',
  '5': 'rail',
  '6': 'wire',
  '7': 'park',
  '8': 'police',
  '9': 'fire',
  'b': 'bulldozer',
  'q': 'query'
};

// Limit how much can be done in a single drag
var MAX_AREA_SIDE = 64;
var MAX_BUILDINGS = 100;

// Keyboard panning speed, in CSS pixels per second
var KEY_PAN_SPEED = 900;

// A drag shorter than this (in CSS pixels) is regarded as a click
var CLICK_SLOP = 5;

var toolOutputID = '#toolOutput';


var InputStatus = EventEmitter(function(map, gameCanvas) {
  this.gameTools = new GameTools(map);
  this.gameTools.addEventListener(Messages.QUERY_WINDOW_NEEDED, MiscUtils.reflectEvent.bind(this, Messages.QUERY_WINDOW_NEEDED));

  this._map = map;
  this._gameCanvas = gameCanvas;
  this.canvasID = MiscUtils.normaliseDOMid(GameCanvas.DEFAULT_ID);
  this._canvasElement = document.querySelector(this.canvasID);

  // Should be replaced by the owner: when it returns true (e.g. a dialog is open), the map does not respond to input
  this.isBlocked = function() { return false; };

  // Keyboard movement
  this._keysHeld = {up: false, down: false, left: false, right: false};

  // The last known position of the mouse over the canvas, in CSS pixels relative to the canvas (or null)
  this._hover = null;

  // Active pointers, by id: used to detect two-finger gestures
  this._pointers = new Map();

  // Current gesture: null, or an object describing a pan, pinch or tool drag in progress
  this._gesture = null;

  // Tool state
  this.toolName = null;
  this.currentTool = null;
  this.toolWidth = 0;
  this.toolColour = '';

  // Add the listeners
  this._onKeyDown = keyDownHandler.bind(this);
  this._onKeyUp = keyUpHandler.bind(this);
  window.addEventListener('keydown', this._onKeyDown);
  window.addEventListener('keyup', this._onKeyUp);
  window.addEventListener('blur', this.reset.bind(this));

  var canvas = this._canvasElement;
  canvas.addEventListener('pointerdown', pointerDownHandler.bind(this));
  canvas.addEventListener('pointermove', pointerMoveHandler.bind(this));
  canvas.addEventListener('pointerup', pointerUpHandler.bind(this));
  canvas.addEventListener('pointercancel', pointerCancelHandler.bind(this));
  canvas.addEventListener('pointerleave', pointerLeaveHandler.bind(this));
  canvas.addEventListener('wheel', wheelHandler.bind(this), {passive: false});
  canvas.addEventListener('contextmenu', function(e) { e.preventDefault(); });
  this._updateCursor();

  var self = this;
  $('.toolButton').click(function(e) {
    e.preventDefault();
    self.selectTool($(this).attr('data-tool'));
  });

  // The menu of less used buttons, on smaller screens
  $('#moreRequest').click(function(e) {
    e.preventDefault();
    e.stopPropagation();
    InputStatus.toggleMoreMenu();
  });
  $('#hudMore').on('click', '.hudButton', function() {
    InputStatus.toggleMoreMenu(false);
  });
  $(document).on('click', function(e) {
    if (!$(e.target).closest('#hudMore').length)
      InputStatus.toggleMoreMenu(false);
  });

  $('#budgetRequest').click(budgetHandler.bind(this));
  $('#evalRequest').click(evalHandler.bind(this));
  $('#graphsRequest').click(graphsHandler.bind(this));
  $('#disasterRequest').click(disasterHandler.bind(this));
  $('#pauseRequest').click(this.speedChangeHandler.bind(this));
  $('#screenshotRequest').click(screenshotHandler.bind(this));
  $('#settingsRequest').click(settingsHandler.bind(this));
  $('#saveRequest').click(saveHandler.bind(this));
  $('#debugRequest').click(debugHandler.bind(this));
  $('#zoomInRequest').click(function(e) { e.preventDefault(); self._gameCanvas.zoomIn(); });
  $('#zoomOutRequest').click(function(e) { e.preventDefault(); self._gameCanvas.zoomOut(); });
});


InputStatus.TOOL_LINE = TOOL_LINE;
InputStatus.TOOL_AREA = TOOL_AREA;
InputStatus.TOOL_BUILDING = TOOL_BUILDING;
InputStatus.TOOL_SINGLE = TOOL_SINGLE;


InputStatus.getToolCategory = function(toolName) {
  return toolCategories[toolName] || TOOL_BUILDING;
};


var isEditable = function(element) {
  if (!element || element === document.body)
    return false;

  var tag = element.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || element.isContentEditable;
};


var directionForKey = function(key) {
  switch (key) {
    case 'ArrowUp':
    case 'w':
    case 'W':
      return 'up';

    case 'ArrowDown':
    case 's':
    case 'S':
      return 'down';

    case 'ArrowLeft':
    case 'a':
    case 'A':
      return 'left';

    case 'ArrowRight':
    case 'd':
    case 'D':
      return 'right';
  }

  return null;
};


var keyDownHandler = function(e) {
  if (e.key === 'Escape') {
    if (this._gesture !== null && this._gesture.type === 'tool') {
      this._cancelGesture();
    } else {
      this._emitEvent(Messages.ESCAPE_PRESSED);
    }

    e.preventDefault();
    return;
  }

  if (isEditable(e.target) || e.ctrlKey || e.metaKey || e.altKey)
    return;

  // Dialogs handle their own keys
  if (this.isBlocked())
    return;

  var direction = directionForKey(e.key);
  if (direction !== null) {
    this._keysHeld[direction] = true;
    e.preventDefault();
    return;
  }

  switch (e.key) {
    case ' ':
      if (!e.repeat)
        this.speedChangeHandler();
      e.preventDefault();
      return;

    case '+':
    case '=':
      this._gameCanvas.zoomIn();
      e.preventDefault();
      return;

    case '-':
    case '_':
      this._gameCanvas.zoomOut();
      e.preventDefault();
      return;
  }

  var tool = toolShortcuts[e.key.toLowerCase()];
  if (tool !== undefined && !e.repeat) {
    this.selectTool(tool);
    e.preventDefault();
  }
};


var keyUpHandler = function(e) {
  var direction = directionForKey(e.key);
  if (direction !== null)
    this._keysHeld[direction] = false;
};


var getRelativeCoordinates = function(e) {
  var cRect = this._canvasElement.getBoundingClientRect();
  return {x: e.clientX - cRect.left, y: e.clientY - cRect.top};
};


InputStatus.prototype._tileAt = function(coords) {
  return this._gameCanvas.canvasCoordinateToTileCoordinate(coords.x, coords.y);
};


var pointerDownHandler = function(e) {
  if (this.isBlocked())
    return;

  var coords = getRelativeCoordinates.call(this, e);
  this._pointers.set(e.pointerId, coords);
  this._hover = e.pointerType === 'mouse' ? coords : null;

  try {
    this._canvasElement.setPointerCapture(e.pointerId);
  } catch (err) {
    // Not fatal: we just won't track the pointer outside the canvas
  }

  // A second finger turns whatever was happening into a pinch/pan gesture
  if (this._pointers.size === 2) {
    this._startPinch();
    e.preventDefault();
    return;
  }

  if (this._pointers.size > 2 || this._gesture !== null)
    return;

  var panButton = e.button === 1 || e.button === 2;
  if (panButton || this.currentTool === null) {
    this._gesture = {type: 'pan', pointerId: e.pointerId, button: e.button, start: coords, last: coords, moved: false};
  } else if (e.button === 0) {
    var tile = this._tileAt(coords);
    if (tile !== null) {
      this._gesture = {type: 'tool', pointerId: e.pointerId, start: coords, anchor: tile, current: tile,
                       toolName: this.toolName};
    }
  }

  this._updateCursor();
  e.preventDefault();
};


var pointerMoveHandler = function(e) {
  var coords = getRelativeCoordinates.call(this, e);

  if (e.pointerType === 'mouse')
    this._hover = coords;

  if (!this._pointers.has(e.pointerId))
    return;

  this._pointers.set(e.pointerId, coords);
  var gesture = this._gesture;
  if (gesture === null)
    return;

  switch (gesture.type) {
    case 'pan':
      if (e.pointerId !== gesture.pointerId)
        return;

      this._gameCanvas.panBy(gesture.last.x - coords.x, gesture.last.y - coords.y);
      gesture.last = coords;
      if (Math.abs(coords.x - gesture.start.x) > CLICK_SLOP || Math.abs(coords.y - gesture.start.y) > CLICK_SLOP)
        gesture.moved = true;
      break;

    case 'pinch':
      this._updatePinch();
      break;

    case 'tool':
      if (e.pointerId !== gesture.pointerId)
        return;

      var tile = this._tileAt(coords);
      if (tile !== null)
        gesture.current = tile;
      break;
  }

  e.preventDefault();
};


var pointerUpHandler = function(e) {
  if (!this._pointers.has(e.pointerId))
    return;

  var coords = getRelativeCoordinates.call(this, e);
  this._pointers.delete(e.pointerId);

  try {
    this._canvasElement.releasePointerCapture(e.pointerId);
  } catch (err) {
    // Ignore
  }

  var gesture = this._gesture;
  if (gesture === null)
    return;

  if (gesture.type === 'pinch') {
    // Wait until all fingers have been lifted before allowing anything else
    if (this._pointers.size === 0)
      this._gesture = null;
    this._updateCursor();
    return;
  }

  if (e.pointerId !== gesture.pointerId)
    return;

  this._gesture = null;

  if (gesture.type === 'pan') {
    // A right click (without dragging) deselects the current tool
    if (gesture.button === 2 && !gesture.moved)
      this.clearTool();
  } else if (gesture.type === 'tool' && gesture.toolName === this.toolName) {
    var tile = this._tileAt(coords);
    if (tile !== null)
      gesture.current = tile;

    var placements = this._computePlacements(gesture.anchor, gesture.current);
    if (placements.length > 0)
      this._emitEvent(Messages.TOOL_APPLY, {toolName: gesture.toolName, placements: placements});
  }

  this._updateCursor();
  e.preventDefault();
};


var pointerCancelHandler = function(e) {
  this._pointers.delete(e.pointerId);
  if (this._pointers.size === 0)
    this._cancelGesture();
};


var pointerLeaveHandler = function(e) {
  if (e.pointerType === 'mouse' && !this._pointers.has(e.pointerId))
    this._hover = null;
};


// Distinguishing a mouse wheel from a touchpad is not possible in general. A mouse wheel typically produces
// purely vertical, large, whole-number deltas, whereas touchpads produce small and/or fractional deltas,
// frequently on both axes. Touchpad pinches are reported as wheel events with the control key held.
var looksLikeMouseWheel = function(e) {
  if (e.deltaMode !== 0)
    return true;

  return e.deltaX === 0 && Math.abs(e.deltaY) >= 50 && Number.isInteger(e.deltaY);
};


var wheelHandler = function(e) {
  e.preventDefault();

  if (this.isBlocked())
    return;

  var coords = getRelativeCoordinates.call(this, e);

  if (e.ctrlKey || e.metaKey) {
    // Pinch to zoom on a touchpad (or ctrl + wheel)
    var factor = Math.exp(-e.deltaY * 0.01);
    this._gameCanvas.setZoom(this._gameCanvas.getZoom() * factor, coords.x, coords.y);
    return;
  }

  if (looksLikeMouseWheel(e) && !e.shiftKey) {
    if (e.deltaY < 0)
      this._gameCanvas.zoomIn(coords.x, coords.y);
    else if (e.deltaY > 0)
      this._gameCanvas.zoomOut(coords.x, coords.y);
    return;
  }

  // Two-finger scrolling on a touchpad (or shift + wheel) pans
  var dx = e.deltaX;
  var dy = e.deltaY;
  if (e.shiftKey && dx === 0) {
    dx = dy;
    dy = 0;
  }

  if (e.deltaMode === 1) {
    // Line mode
    dx *= 16;
    dy *= 16;
  }

  this._gameCanvas.panBy(dx, dy);
};


InputStatus.prototype._pinchState = function() {
  var points = Array.from(this._pointers.values()).slice(0, 2);
  var centre = {x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2};
  var distance = Math.max(1, Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y));
  return {centre: centre, distance: distance};
};


InputStatus.prototype._startPinch = function() {
  var state = this._pinchState();
  this._gesture = {type: 'pinch', centre: state.centre, distance: state.distance};
  this._updateCursor();
};


InputStatus.prototype._updatePinch = function() {
  if (this._pointers.size < 2)
    return;

  var gesture = this._gesture;
  var state = this._pinchState();

  this._gameCanvas.panBy(gesture.centre.x - state.centre.x, gesture.centre.y - state.centre.y);
  this._gameCanvas.setZoom(this._gameCanvas.getZoom() * state.distance / gesture.distance, state.centre.x, state.centre.y);

  gesture.centre = state.centre;
  gesture.distance = state.distance;
};


InputStatus.prototype._cancelGesture = function() {
  this._gesture = null;
  this._updateCursor();
};


// Forget all transient input state: called when the window loses focus
InputStatus.prototype.reset = function() {
  this._keysHeld.up = this._keysHeld.down = this._keysHeld.left = this._keysHeld.right = false;
  this._pointers.clear();
  this._cancelGesture();
};


// Called once per frame with the elapsed time in milliseconds
InputStatus.prototype.update = function(elapsed) {
  if (this.isBlocked())
    return;

  var keys = this._keysHeld;
  var dx = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
  var dy = (keys.down ? 1 : 0) - (keys.up ? 1 : 0);

  if (dx === 0 && dy === 0)
    return;

  // Avoid huge jumps after the tab has been in the background
  elapsed = Math.min(elapsed, 100);
  var distance = KEY_PAN_SPEED * elapsed / 1000;
  if (dx !== 0 && dy !== 0)
    distance /= Math.SQRT2;

  this._gameCanvas.panBy(dx * distance, dy * distance);
};


// Computes the coordinates at which the tool should be applied for a drag from anchor to current (in order).
// For buildings, the coordinates are those of the building's "centre" tile, as expected by the tools.
InputStatus.prototype._computePlacements = function(anchor, current) {
  var placements = [];
  var x, y;
  var category = InputStatus.getToolCategory(this.toolName);

  switch (category) {
    case TOOL_SINGLE:
      placements.push({x: current.x, y: current.y});
      break;

    case TOOL_LINE:
      // An L-shaped path: first along the axis with the greatest distance, then along the other
      var dx = current.x - anchor.x;
      var dy = current.y - anchor.y;
      var stepX = dx < 0 ? -1 : 1;
      var stepY = dy < 0 ? -1 : 1;

      if (Math.abs(dx) >= Math.abs(dy)) {
        for (x = anchor.x; x !== current.x + stepX; x += stepX)
          placements.push({x: x, y: anchor.y});
        for (y = anchor.y + stepY; y !== current.y + stepY; y += stepY)
          placements.push({x: current.x, y: y});
      } else {
        for (y = anchor.y; y !== current.y + stepY; y += stepY)
          placements.push({x: anchor.x, y: y});
        for (x = anchor.x + stepX; x !== current.x + stepX; x += stepX)
          placements.push({x: x, y: current.y});
      }
      break;

    case TOOL_AREA:
      var minX = Math.min(anchor.x, current.x);
      var minY = Math.min(anchor.y, current.y);
      var maxX = Math.min(Math.max(anchor.x, current.x), minX + MAX_AREA_SIDE - 1);
      var maxY = Math.min(Math.max(anchor.y, current.y), minY + MAX_AREA_SIDE - 1);

      for (y = minY; y <= maxY; y++) {
        for (x = minX; x <= maxX; x++)
          placements.push({x: x, y: y});
      }
      break;

    case TOOL_BUILDING:
      // A grid of buildings, aligned on the first one
      var size = this.toolWidth - 0;
      var countX = Math.floor(Math.abs(current.x - anchor.x) / size) + 1;
      var countY = Math.floor(Math.abs(current.y - anchor.y) / size) + 1;
      var dirX = current.x < anchor.x ? -1 : 1;
      var dirY = current.y < anchor.y ? -1 : 1;

      for (var j = 0; j < countY; j++) {
        for (var i = 0; i < countX; i++) {
          if (placements.length >= MAX_BUILDINGS)
            break;
          placements.push({x: anchor.x + i * size * dirX, y: anchor.y + j * size * dirY});
        }
      }
      break;
  }

  // Discard anything off the map
  var map = this._map;
  return placements.filter(function(p) {
    return map.testBounds(p.x, p.y);
  });
};


// Returns where the current tool would act, given the current drag or mouse position, or null if there is
// nothing to show
InputStatus.prototype.getPendingPlacements = function() {
  if (this.currentTool === null || this.isBlocked())
    return null;

  var gesture = this._gesture;
  if (gesture !== null) {
    if (gesture.type !== 'tool' || gesture.toolName !== this.toolName)
      return null;

    return {placements: this._computePlacements(gesture.anchor, gesture.current), dragging: true};
  }

  if (this._hover === null)
    return null;

  var tile = this._tileAt(this._hover);
  if (tile === null || !this._map.testBounds(tile.x, tile.y))
    return null;

  return {placements: [{x: tile.x, y: tile.y}], dragging: false};
};


InputStatus.prototype._updateCursor = function() {
  var canvas = $(this._canvasElement);
  var gesture = this._gesture;

  canvas.removeClass('cursorTool cursorQuery cursorGrab cursorGrabbing');

  if (gesture !== null && (gesture.type === 'pan' || gesture.type === 'pinch'))
    canvas.addClass('cursorGrabbing');
  else if (this.currentTool === null)
    canvas.addClass('cursorGrab');
  else if (this.toolName === 'query')
    canvas.addClass('cursorQuery');
  else
    canvas.addClass('cursorTool');
};


InputStatus.prototype.selectTool = function(toolName) {
  // Selecting the current tool again deselects it
  if (toolName === this.toolName) {
    this.clearTool();
    return;
  }

  var button = $('.toolButton[data-tool="' + toolName + '"]');
  if (button.length === 0 || this.gameTools[toolName] === undefined)
    return;

  $('.toolButton.selected').removeClass('selected').addClass('unselected').attr('aria-pressed', 'false');
  button.removeClass('unselected').addClass('selected').attr('aria-pressed', 'true');

  this.toolName = toolName;
  this.toolWidth = button.attr('data-size') - 0;
  this.currentTool = this.gameTools[toolName];
  this.toolColour = button.attr('data-colour');
  this._cancelGesture();
  $(toolOutputID).text(button.attr('data-label') || 'Tools');

  this._emitEvent(Messages.TOOL_CHANGED, toolName);
};


InputStatus.prototype.clearTool = function() {
  this.toolName = null;
  this.currentTool = null;
  this.toolWidth = 0;
  this.toolColour = '';
  this._cancelGesture();
  $('.toolButton.selected').removeClass('selected').addClass('unselected').attr('aria-pressed', 'false');
  $(toolOutputID).text('Tools');

  this._emitEvent(Messages.TOOL_CHANGED, null);
};


InputStatus.prototype.speedChangeHandler = function(e) {
  if (e)
    e.preventDefault();

  this._emitEvent(Messages.SPEED_CHANGE);
};


var makeHandler = function(message) {
  var m = Messages[message];

  return function(e) {
    if (e)
      e.preventDefault();
    this._emitEvent(m);
  };
};


var budgetHandler = makeHandler('BUDGET_REQUESTED');
var debugHandler = makeHandler('DEBUG_WINDOW_REQUESTED');
var disasterHandler = makeHandler('DISASTER_REQUESTED');
var evalHandler = makeHandler('EVAL_REQUESTED');
var graphsHandler = makeHandler('GRAPHS_REQUESTED');
var screenshotHandler = makeHandler('SCREENSHOT_WINDOW_REQUESTED');
var settingsHandler = makeHandler('SETTINGS_WINDOW_REQUESTED');
var saveHandler = makeHandler('SAVE_REQUESTED');


// Opens or closes the menu of less used buttons (open is optional: it toggles by default). Returns whether the menu
// was open.
InputStatus.toggleMoreMenu = function(open) {
  var menu = $('#hudMore');
  var button = $('#moreRequest');
  var wasOpen = menu.hasClass('open');
  if (open === undefined)
    open = !wasOpen;

  if (open && button.length) {
    var rect = button[0].getBoundingClientRect();
    menu.css({top: Math.round(rect.bottom + 8) + 'px', right: Math.max(8, Math.round(window.innerWidth - rect.right)) + 'px'});
  }

  menu.toggleClass('open', open);
  button.attr('aria-expanded', open ? 'true' : 'false');
  return wasOpen;
};


export { InputStatus };
