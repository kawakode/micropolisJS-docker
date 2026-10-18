/* KawaCity, a modified version of micropolisJS. Adapted by Graeme McCutcheon from Micropolis.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

// The emails the server sends about accounts: for each, its subject and its text, in English. Both are keys of the
// translations (see I18n.translate), and are filled in with:
//   {username}  the account's username
//   {site}      the game's address (the server's public URL, such as https://kawacity.example.org)
//   {link}      the link to open; it is always alone in its own paragraph, so that it can be made a link as it is
//   {hours}     how many hours the link works (written "{hours} h", which reads well for 1 as for 24)
//
// The subjects have no placeholders: they hold nothing about the account. The text's paragraphs are separated by a
// blank line. The placeholders of each email:
//   signup               {site} {link} {hours}            to an address with no account yet: finish creating it
//   alreadyRegistered    {username} {site} {link} {hours} to an account's address, asked again to create an account:
//                                                         the link resets the password
//   reset                {username} {site} {link} {hours} the link resets the password
//   passwordChanged      {username} {site}                after the password was changed or reset
//   emailChangeConfirm   {username} {site} {link} {hours} to the new address: the link confirms it
//   emailChangeNotice    {username} {site}                to the old address, when the change is asked for
//   emailChanged         {username} {site}                to the old address, once the change is confirmed
//   accountLocked        {username} {site} {hours}        after too many failed logins, once

var paragraphs = function(list) {
  return list.join('\n\n');
};


var EMAIL_TEXTS = {
  signup: {
    subject: 'Finish creating your KawaCity account',
    text: paragraphs([
      'Hello,',
      'Someone, probably you, asked to create a KawaCity account on {site} with this email address.',
      'To choose your username and password, open this link within {hours} h:',
      '{link}',
      'If it was not you, just ignore this email: no account will be created.'
    ])
  },

  alreadyRegistered: {
    subject: 'You already have a KawaCity account',
    text: paragraphs([
      'Hello {username},',
      'Someone, probably you, asked to create a KawaCity account on {site} with this email address. You already have ' +
      'one: your username is {username}.',
      'You can log in with it as usual. If you forgot your password, open this link within {hours} h to choose a new ' +
      'one:',
      '{link}',
      'If it was not you, just ignore this email: your account has not changed.'
    ])
  },

  reset: {
    subject: 'Choose a new KawaCity password',
    text: paragraphs([
      'Hello {username},',
      'Someone, probably you, asked to reset the password of your KawaCity account on {site}.',
      'To choose a new password, open this link within {hours} h:',
      '{link}',
      'If it was not you, just ignore this email: your password has not changed.'
    ])
  },

  passwordChanged: {
    subject: 'Your KawaCity password was changed',
    text: paragraphs([
      'Hello {username},',
      'The password of your KawaCity account on {site} has just been changed.',
      'If it was you, all is well: there is nothing else to do.',
      'If it was not you, choose a new password at once with "Forgot password?" on the login screen of {site}.'
    ])
  },

  emailChangeConfirm: {
    subject: 'Confirm your new email address for KawaCity',
    text: paragraphs([
      'Hello {username},',
      'Someone, probably you, asked to use this email address for your KawaCity account on {site}.',
      'To confirm it, open this link within {hours} h:',
      '{link}',
      'If it was not you, just ignore this email: nothing will change.'
    ])
  },

  emailChangeNotice: {
    subject: 'Your KawaCity email address is about to change',
    text: paragraphs([
      'Hello {username},',
      'Someone, probably you, asked to change the email address of your KawaCity account on {site}. The change is ' +
      'made once the new address is confirmed.',
      'If it was you, there is nothing else to do.',
      'If it was not you, someone else knows your password: log in at once and change it, which also cancels the ' +
      'change of address.'
    ])
  },

  emailChanged: {
    subject: 'Your KawaCity email address was changed',
    text: paragraphs([
      'Hello {username},',
      'The email address of your KawaCity account on {site} has just been changed. The account\'s emails now go to ' +
      'the new address, and this one no longer works to log in.',
      'If it was you, there is nothing else to do.',
      'If it was not you, someone else knows your password: log in at once with your username, change your password ' +
      'and set your email address back. If you cannot, contact the people who run {site}.'
    ])
  },

  accountLocked: {
    subject: 'Your KawaCity account is locked for now',
    text: paragraphs([
      'Hello {username},',
      'There were too many failed attempts to log in to your KawaCity account on {site}, so it is locked for ' +
      '{hours} h.',
      'To unlock it now, choose a new password with "Forgot password?" on the login screen.',
      'If these attempts were not yours, someone may be trying to guess your password. A new one, long and used ' +
      'nowhere else, keeps your account safe.'
    ])
  }
};


export { EMAIL_TEXTS };
