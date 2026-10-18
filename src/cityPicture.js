/* KawaCity, a modified version of micropolisJS. Adapted by Graeme McCutcheon from Micropolis.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

// A picture of the city, to share: the picture of the map (see GameCanvas.takePicture), with a banner below it in the
// style of the game's windows, naming the city with its figures, and the game.

var TITLE_FONT = '"Press Start 2P", monospace';
var TEXT_FONT = 'DotGothic16, monospace';

// The banner's measures at its smallest, in pixels: they are multiplied for larger pictures, so that the pixel fonts
// stay sharp
var BANNER_HEIGHT = 60;
var PADDING = 14;
var PICTURE_WIDTH_PER_SCALE = 900;


// The fonts must be loaded before they are drawn on a canvas
var loadFonts = function() {
  if (typeof(document) === 'undefined' || !document.fonts || !document.fonts.load)
    return Promise.resolve();

  return Promise.all([document.fonts.load('16px ' + TITLE_FONT), document.fonts.load('16px ' + TEXT_FONT)])
    .catch(function() {});
};


// How much the banner is enlarged for a picture this wide
var scaleFor = function(width) {
  return Math.max(1, Math.round(width / PICTURE_WIDTH_PER_SCALE));
};


// The text, shortened with an ellipsis to fit in width
var fit = function(ctx, text, width) {
  if (ctx.measureText(text).width <= width)
    return text;

  var shortened = text;
  while (shortened.length > 1 && ctx.measureText(shortened + '…').width > width)
    shortened = shortened.slice(0, -1);

  return shortened.replace(/\s+$/, '') + '…';
};


// The picture with its banner, as a new canvas. caption: {name, details}, two lines of text.
var compose = function(picture, caption) {
  var s = scaleFor(picture.width);
  var bannerHeight = BANNER_HEIGHT * s;
  var width = picture.width;

  var canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = picture.height + bannerHeight;

  var ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(picture, 0, 0);

  // The banner, edged like the game's windows
  var top = picture.height;
  var gradient = ctx.createLinearGradient(0, top, 0, top + bannerHeight);
  gradient.addColorStop(0, '#2d419c');
  gradient.addColorStop(1, '#182260');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, top, width, bannerHeight);
  ctx.fillStyle = '#070a1f';
  ctx.fillRect(0, top, width, 2 * s);
  ctx.fillStyle = '#e8ecff';
  ctx.fillRect(0, top + 2 * s, width, 2 * s);

  var padding = PADDING * s;
  ctx.textBaseline = 'top';

  // The game, on the right
  ctx.font = (8 * s) + 'px ' + TITLE_FONT;
  var brand = 'KawaCity';
  var brandWidth = ctx.measureText(brand).width;
  ctx.fillStyle = '#b4bdee';
  ctx.fillText(brand, width - padding - brandWidth, top + 4 * s + Math.round((bannerHeight - 4 * s - 8 * s) / 2));

  var textWidth = width - 3 * padding - brandWidth;

  // The city's name, with a hard shadow
  ctx.font = (16 * s) + 'px ' + TITLE_FONT;
  var name = fit(ctx, caption.name, textWidth);
  ctx.fillStyle = '#070a1f';
  ctx.fillText(name, padding + 2 * s, top + 14 * s + 2 * s);
  ctx.fillStyle = '#f8c838';
  ctx.fillText(name, padding, top + 14 * s);

  // Its figures
  ctx.font = (16 * s) + 'px ' + TEXT_FONT;
  ctx.fillStyle = '#f4f5ff';
  ctx.fillText(fit(ctx, caption.details, textWidth), padding, top + 37 * s);

  return canvas;
};


// The name of the picture's file: the city's name and the year
var fileName = function(cityName, year) {
  return (cityName || 'city').replace(/[^A-Za-z0-9_-]+/g, '_') + '-' + year + '.png';
};


var CityPicture = {
  compose: compose,
  fileName: fileName,
  loadFonts: loadFonts
};


export { CityPicture };
