/* KawaCity, a modified version of micropolisJS.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

import { ADMIN_RESET_HOURS, createResetToken, linkTo, RESET_HOURS } from '../auth/mailTokens';
import { checkEmail, checkUsername, isLocale, LOCALES, UserRow, Users, usernameKey } from '../auth/users';
import { releaseAccount } from '../game/accounts';
import { CityStore } from '../game/cityStore';
import { RegionLink } from '../game/regionLink';
import { RegionStore } from '../game/regionStore';
import { MailTransport, NO_SENDER, smtpTransport } from '../mail/mailer';
import { UNUSABLE_PASSWORD_HASH } from '../security/passwords';
import type { AdminCommand, AdminContext } from './commands';
import { BAD_USAGE, FAILED, OK } from './exitCodes';

// Accounts made and repaired by hand, for a server without mail, or a player who lost access to theirs:
//   user add <username> <email> [locale]  an account with no password yet, and a link (24 h) to choose one
//   user reset <username|email>           a link (1 h) to choose a new password
//   user delete <username>                deletes the account, its sessions and what it owns
//   user list                             every account
//   mail-test <address>                   sends a mail, to check the mail settings
// The links are printed, not mailed: give them to their owner yourself.

const shownTime = (time: number | null) => time === null ? '-' : new Date(time).toISOString().slice(0, 16) + 'Z';

const usage = (context: AdminContext, text: string) => {
  context.err(`Usage: ${text}`);
  return BAD_USAGE;
};

// The account named by a username or an email address
const findUser = (users: Users, name: string): UserRow | null => {
  if (name.includes('@')) {
    const email = checkEmail(name);
    return email.ok ? users.byEmailKey(email.key) : null;
  }
  return users.byUsernameKey(usernameKey(name));
};

const resetLink = (context: AdminContext, user: UserRow, hours: number) => {
  const token = createResetToken(context.openDatabase(), user.id, context.clock.now(), hours);
  return linkTo(context.config.publicOrigin, 'reset', token);
};

const addUser: AdminCommand = {
  name: 'user add',
  usage: '<username> <email> [locale]',
  description: `makes an account, and prints a link (valid ${ADMIN_RESET_HOURS} h) for its owner to choose a ` +
               `password; locale: ${LOCALES.join(' or ')} (the language of its emails, en by default)`,
  run(args, context) {
    if (args.length < 2 || args.length > 3)
      return usage(context, 'user add <username> <email> [locale]');

    const username = checkUsername(args[0]);
    if (!username.ok) {
      context.err(`The username ${JSON.stringify(args[0])} cannot be used (${username.reason}): 3 to 20 letters, ` +
                  'digits, _ . or -, starting and ending with a letter or a digit');
      return FAILED;
    }
    const email = checkEmail(args[1]);
    if (!email.ok) {
      context.err(`${JSON.stringify(args[1])} is not an email address that can be used (${email.reason})`);
      return FAILED;
    }
    const locale = args[2] ?? 'en';
    if (!isLocale(locale)) {
      context.err(`The locale must be ${LOCALES.join(' or ')}`);
      return FAILED;
    }

    const db = context.openDatabase();
    const users = new Users(db);
    const created = db.transaction(() => {
      const holder = users.usernameHolder(username);
      if (holder)
        return {taken: holder.username};
      if (users.byEmailKey(email.key))
        return 'email';
      // Verified at once (the admin vouches for the address); no password until its owner chooses one
      return users.create({username: username.username, usernameKey: username.key, email: email.email,
                           emailKey: email.key, passwordHash: UNUSABLE_PASSWORD_HASH, locale,
                           now: context.clock.now(), loggedIn: false});
    });
    if (created === 'email') {
      context.err(`The address ${email.email} already has an account`);
      return FAILED;
    }
    if ('taken' in created) {
      context.err(usernameKey(created.taken) === username.key ? `The username ${username.username} is taken` :
        `The username ${username.username} is taken: it looks too much like ${created.taken}`);
      return FAILED;
    }

    context.out(`Made the account ${created.username} <${created.email}>. To choose its password, its owner opens ` +
                `within ${ADMIN_RESET_HOURS} h:`);
    context.out(resetLink(context, created, ADMIN_RESET_HOURS));
    return OK;
  },
};

const resetUser: AdminCommand = {
  name: 'user reset',
  usage: '<username|email>',
  description: `prints a link (valid ${RESET_HOURS} h) to choose a new password for the account`,
  run(args, context) {
    if (args.length !== 1)
      return usage(context, 'user reset <username|email>');

    const user = findUser(new Users(context.openDatabase()), args[0]);
    if (!user) {
      context.err(`There is no account ${JSON.stringify(args[0])}`);
      return FAILED;
    }

    context.out(`To choose a new password for ${user.username} <${user.email}>, open within ${RESET_HOURS} h:`);
    context.out(resetLink(context, user, RESET_HOURS));
    return OK;
  },
};

const deleteUser: AdminCommand = {
  name: 'user delete',
  usage: '<username>',
  description: 'deletes the account, its sessions and everything it owns',
  run(args, context) {
    if (args.length !== 1)
      return usage(context, 'user delete <username>');

    const db = context.openDatabase();
    const users = new Users(db);
    const user = users.byUsernameKey(usernameKey(args[0]));
    if (!user) {
      context.err(`There is no account with the username ${JSON.stringify(args[0])}`);
      return FAILED;
    }

    // As the server does it (see game/accounts.ts), but this process has no room open: the cities beside the
    // account's cities, and those in its regions, are changed in their stored saves (a running server's open rooms
    // read them again before they save, see RoomManager.recheck)
    const cities = new CityStore(db);
    const link = new RegionLink(db, cities, context.clock, {get: () => undefined});
    db.transaction(() => {
      releaseAccount({cities, regions: new RegionStore(db), link, clock: context.clock}, user.id, () => {});
      users.delete(user.id);
      db.run('DELETE FROM signup_tokens WHERE email_key = ?', user.email_key);
    });
    // Nothing of the account left in the write-ahead log either
    db.checkpoint();
    context.out(`Deleted the account ${user.username} <${user.email}>`);
    return OK;
  },
};

const listUsers: AdminCommand = {
  name: 'user list',
  usage: '',
  description: 'lists the accounts',
  run(args, context) {
    if (args.length !== 0)
      return usage(context, 'user list');

    const now = context.clock.now();
    const rows = new Users(context.openDatabase()).list().map(user => [
      user.username,
      user.email,
      user.locale,
      shownTime(user.created_at),
      shownTime(user.last_login_at),
      user.password_hash === UNUSABLE_PASSWORD_HASH ? 'no password yet' :
        user.locked_until !== null && user.locked_until > now ? `locked until ${shownTime(user.locked_until)}` : '',
    ]);
    if (rows.length === 0) {
      context.out('No accounts');
      return OK;
    }

    const table = [['USERNAME', 'EMAIL', 'LOCALE', 'CREATED', 'LAST LOGIN', 'NOTE'], ...rows];
    const widths = table[0].map((_, column) => Math.max(...table.map(row => row[column].length)));
    table.forEach(row => context.out(row.map((cell, column) => cell.padEnd(widths[column])).join('  ').trimEnd()));
    context.out(`${rows.length} account${rows.length === 1 ? '' : 's'}`);
    return OK;
  },
};

// The transport mail-test sends with: the server's own, except that the log transport prints to the terminal
const testTransport = (context: AdminContext): MailTransport | null => {
  const {config} = context;
  if (config.mailTransport === 'smtp' && config.smtp)
    return smtpTransport(config.smtp);
  if (config.mailTransport === 'log') {
    return {
      kind: 'log',
      async deliver(mail) {
        context.out(`MAIL_TRANSPORT=log: the mail is printed instead of sent. To: ${mail.to}`);
        context.out(`Subject: ${mail.subject}`);
        context.out(mail.text);
      },
    };
  }
  return null;
};

const mailTest: AdminCommand = {
  name: 'mail-test',
  usage: '<address>',
  description: 'sends a test mail to the address, with the mail settings of the server',
  async run(args, context) {
    if (args.length !== 1)
      return usage(context, 'mail-test <address>');

    const email = checkEmail(args[0]);
    if (!email.ok) {
      context.err(`${JSON.stringify(args[0])} is not an email address that can be used (${email.reason})`);
      return FAILED;
    }

    const transport = testTransport(context);
    if (!transport) {
      context.err('No mail can be sent: set SMTP_HOST and MAIL_FROM (or MAIL_TRANSPORT=log for development)');
      return FAILED;
    }

    const site = context.config.publicOrigin;
    try {
      await transport.deliver({
        template: 'mailTest',
        to: email.email,
        toKey: email.key,
        subject: 'KawaCity mail test',
        text: `This is a test mail from the KawaCity server at ${site}.\n\nIf you can read it, the server can send ` +
              'the emails players need to create their accounts and reset their passwords.',
      }, context.config.mailFrom ?? NO_SENDER);
    } catch (error) {
      context.err(`The mail could not be sent: ${error instanceof Error ? error.message : String(error)}`);
      return FAILED;
    } finally {
      transport.close?.();
    }

    context.out(`Sent a test mail to ${email.email}`);
    return OK;
  },
};

export const USER_COMMANDS: readonly AdminCommand[] = [addUser, resetUser, deleteUser, listUsers, mailTest];
