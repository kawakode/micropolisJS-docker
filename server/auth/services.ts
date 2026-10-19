/* KawaCity, a modified version of micropolisJS.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

import type { Clock } from '../clock';
import type { Config } from '../config';
import type { Database } from '../db/database';
import type { Logger } from '../log';
import type { Mailer } from '../mail/mailer';
import { EmailTemplate, MailParams, renderMail } from '../mail/render';
import { Captcha, loadCaptchaKey } from '../security/captcha';
import { PasswordHasher } from '../security/passwords';
import { LoginGuard } from './loginGuard';
import { LinkKind, linkTo } from './mailTokens';
import { Sessions } from './sessions';
import { Users } from './users';

// What the account routes use, shared with the rest of the server through AppContext.auth. Stage B uses:
//   auth.sessions.resolve(upgrade.cookies)   the user of a WebSocket upgrade (null: 401)
//   auth.sessions.resolveHash(tokenHash)     the same session again, at each ping (null: kick with 'session')
//   auth.sessions.onRevoked(listener)        sessions ended early (logout, password change, deletion): close their
//                                            sockets at once (see revokes() in sessions.ts)
//   auth.onAccountDeleting(hook)             called with the user id inside the transaction that deletes an account,
//                                            before its rows go: evict the rooms of the cities it takes along
//   auth.addExportSection(name, section)     adds the user's cities, regions and memberships to their export

// Run, synchronously, in the transaction that deletes an account, before its rows are deleted
export type AccountDeletionHook = (userId: number) => void;

// A part of an account's export, computed for that user
export type ExportSection = (userId: number) => unknown;

// The emails that tell an account's owner about a change, rather than carry a link someone asked for: they have
// limits of their own (see Mailer)
export const NOTICE_TEMPLATES: ReadonlySet<EmailTemplate> =
  new Set<EmailTemplate>(['passwordChanged', 'emailChangeNotice', 'emailChanged', 'accountLocked']);

// The account emails: rendered in the recipient's language, with the server's address, through the mailer's limits
export class AccountMail {
  constructor(private readonly mailer: Mailer | null, private readonly publicOrigin: string) {}

  get enabled(): boolean {
    return this.mailer !== null;
  }

  link(kind: LinkKind, token: string): string {
    return linkTo(this.publicOrigin, kind, token);
  }

  // Queues the mail; false when it was dropped (over a limit) or there is no mail. The parameters may be given as a
  // function, called only if the mail is sent (it makes the link's token).
  send(template: EmailTemplate, to: {email: string; emailKey: string}, lang: string,
       params: MailParams | (() => MailParams) = {}): boolean {
    if (!this.mailer)
      return false;

    return this.mailer.send({template, to: to.email, toKey: to.emailKey, notice: NOTICE_TEMPLATES.has(template)}, () =>
      renderMail(template, lang, {site: this.publicOrigin, ...(typeof params === 'function' ? params() : params)}));
  }
}

export interface AuthServices {
  readonly users: Users;
  readonly sessions: Sessions;
  readonly passwords: PasswordHasher;
  readonly loginGuard: LoginGuard;
  readonly captcha: Captcha;
  readonly mail: AccountMail;
  readonly deletionHooks: readonly AccountDeletionHook[];
  readonly exportSections: ReadonlyMap<string, ExportSection>;
  onAccountDeleting(hook: AccountDeletionHook): void;
  addExportSection(name: string, section: ExportSection): void;
}

export interface AuthDeps {
  config: Config;
  clock: Clock;
  db: Database;
  log: Logger;
  mailer: Mailer | null;
}

export function createAuthServices({config, clock, db, log, mailer}: AuthDeps): AuthServices {
  const deletionHooks: AccountDeletionHook[] = [];
  const exportSections = new Map<string, ExportSection>();

  return {
    users: new Users(db),
    sessions: new Sessions(db, clock, log, {secure: config.https, idleDays: config.sessionIdleDays,
                                            maxDays: config.sessionMaxDays}),
    passwords: new PasswordHasher({cost: config.passwordHashCost}),
    loginGuard: new LoginGuard({db, clock}),
    captcha: new Captcha({db, clock, key: loadCaptchaKey(db, config.captchaSecret),
                          maxNumber: config.captchaMaxNumber}),
    mail: new AccountMail(mailer, config.publicOrigin),
    deletionHooks,
    exportSections,
    onAccountDeleting: hook => { deletionHooks.push(hook); },
    addExportSection: (name, section) => {
      if (exportSections.has(name) ||
          ['exportedAt', 'account', 'sessions', 'pendingEmailChange', 'loginProtection'].includes(name))
        throw new Error(`export section registered twice: ${name}`);
      exportSections.set(name, section);
    },
  };
}
