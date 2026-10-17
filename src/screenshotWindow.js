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
 * KawaCity: the picture is shown at once, and can be shared, copied or downloaded from the same window.
 *
 */

import $ from "jquery";

import { CityPicture } from './cityPicture.js';
import { I18n } from './i18n.js';
import { SCREENSHOT_WINDOW_CLOSED } from './messages.ts';
import { ModalWindow } from './modalWindow.js';

var ScreenshotWindow = ModalWindow(function() {
  this._data = null;

  // The choices, kept from one picture to the next
  this._area = 'visible';
  this._caption = true;

  // The pictures taken, by area; the picture shown, as a file, and its address in the page
  this._pictures = {};
  this._blob = null;
  this._url = null;
  this._renders = 0;

  $(screenshotFormID).on('submit', submit.bind(this));
  $('#pictureShare').on('click', share.bind(this));
  $('#pictureCopy').on('click', copy.bind(this));
  $('#pictureDownload').on('click', download.bind(this));

  var self = this;
  $('.screenshotType').on('change', function() {
    self._area = $('.screenshotType:checked').val();
    self._render();
  });

  $('#pictureCaption').on('change', function() {
    self._caption = $(this).prop('checked');
    self._render();
  });
});


var screenshotFormID = '#screenshotForm';


// Whether the browser can share a picture with other apps, and copy one
var canShareFiles = function() {
  try {
    return !!(navigator.canShare && navigator.canShare({files: [new File([''], 'city.png', {type: 'image/png'})]}));
  } catch (e) {
    return false;
  }
};


var canCopyImages = function() {
  return !!(window.isSecureContext && navigator.clipboard && navigator.clipboard.write && window.ClipboardItem);
};


ScreenshotWindow.prototype.close = function() {
  this._data = null;
  this._pictures = {};
  this._renders++;
  this._toggleDisplay();
  this._emitEvent(SCREENSHOT_WINDOW_CLOSED);
};


var submit = function(e) {
  e.preventDefault();
  this.close();
};


// data: {take(area): a canvas picturing the visible map or the whole map, caption: {name, details}, fileName,
// shareText}
ScreenshotWindow.prototype.open = function(data) {
  this._data = data;
  this._pictures = {};

  $('.screenshotType').each(function(i, element) {
    $(element).prop('checked', $(element).val() === this._area);
  }.bind(this));
  $('#pictureCaption').prop('checked', this._caption);

  var shareable = canShareFiles();
  var copyable = canCopyImages();
  $('#pictureShare').toggleClass('hidden', !shareable);
  $('#pictureCopy').toggleClass('hidden', !copyable);
  $('#pictureDownload').toggleClass('primary', !shareable);
  $('#pictureSecure').toggleClass('hidden', !!window.isSecureContext);
  this._status('');

  this._toggleDisplay();
  this._render();
};


// Draws the picture as chosen, and makes it ready to share
ScreenshotWindow.prototype._render = function() {
  var data = this._data;
  if (data === null)
    return;

  var render = ++this._renders;
  this._setReady(false);
  this._status('');

  var area = this._area;
  var picture = this._pictures[area] || (this._pictures[area] = data.take(area));
  var withCaption = this._caption;

  CityPicture.loadFonts().then(function() {
    if (render !== this._renders)
      return;

    var canvas = withCaption ? CityPicture.compose(picture, data.caption) : picture;
    canvas.toBlob(function(blob) {
      if (render !== this._renders || blob === null)
        return;

      if (this._url !== null)
        URL.revokeObjectURL(this._url);

      this._blob = blob;
      this._url = URL.createObjectURL(blob);
      $('#picturePreview').attr('src', this._url);
      this._setReady(true);
    }.bind(this), 'image/png');
  }.bind(this));
};


ScreenshotWindow.prototype._setReady = function(ready) {
  $('#pictureShare, #pictureCopy, #pictureDownload').prop('disabled', !ready);
  $('#picturePreviewFrame').toggleClass('busy', !ready);
};


ScreenshotWindow.prototype._status = function(text) {
  $('#pictureStatus').text(text);
};


var share = function(e) {
  e.preventDefault();
  if (this._blob === null || this._data === null)
    return;

  var file = new File([this._blob], this._data.fileName, {type: 'image/png'});
  navigator.share({files: [file], title: this._data.caption.name, text: this._data.shareText}).then(function() {
    this._status('');
  }.bind(this), function(error) {
    // Closing the list of apps is not a failure
    if (error && error.name !== 'AbortError')
      this._status(I18n.t('The picture could not be shared: download it instead.'));
  }.bind(this));
};


var copy = function(e) {
  e.preventDefault();
  if (this._blob === null)
    return;

  navigator.clipboard.write([new window.ClipboardItem({'image/png': this._blob})]).then(function() {
    this._status(I18n.t('Picture copied: paste it into a message or a post.'));
  }.bind(this), function() {
    this._status(I18n.t('The picture could not be copied: download it instead.'));
  }.bind(this));
};


var download = function(e) {
  e.preventDefault();
  if (this._url === null || this._data === null)
    return;

  var link = document.createElement('a');
  link.href = this._url;
  link.download = this._data.fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  this._status(I18n.t('Picture saved as {file}.', {file: this._data.fileName}));
};


export { ScreenshotWindow };
