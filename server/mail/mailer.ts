/* KawaCity, a modified version of micropolisJS.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

import { createTransport } from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';
import type { Clock } from '../clock';
import type { Config, MailAddress, SmtpConfig } from '../config';
import type { Logger } from '../log';
import { RateLimiter } from '../security/rateLimit';

// Sending mail: the account emails (sign-up and reset links, notices). Mails are queued and sent one after the other,
// after the request that asked for them was answered; a mail that cannot be sent is logged (mail.error, without its
// recipient nor the server's answer, which usually repeats the address), never shown.
//
// Every mail counts against limits, so that nobody can flood an inbox or spoil the sender's reputation through the
// game: per recipient (by email_key) 3 links an hour and 10 a day, MAIL_MAX_PER_HOUR links in all, and a queue of 500.
// Over a limit the mail is dropped without a word to the requester (mail.dropped is logged). The notices about an
// account (its password or address changed, it was locked) have per-recipient limits of their own, and do not count
// against MAIL_MAX_PER_HOUR: anyone can have links mailed to any address (registering, forgetting a password), and
// must not be able to use up a limit to silence the notice that would tell an account's owner about a change. Notices
// go only to the addresses of accounts, after something that needed the account's password, a session or a mailed
// link: their per-recipient limits are enough.
//
// Transports: smtp (SMTP_HOST), log (MAIL_TRANSPORT=log: the mail, links included, is written to the log, for
// development only), memory (tests).

// Who a mail goes to
export interface MailEnvelope {
  // Which email it is (for the log, which never holds a mail's text)
  template: string;
  // A validated address (see auth/users.ts) and its email_key
  to: string;
  toKey: string;
  // A notice about the account (NOTICE_LIMITS), rather than a link someone asked for (RECIPIENT_LIMITS)
  notice?: boolean;
}

export interface MailContent {
  subject: string;
  text: string;
  html?: string;
}

export type Mail = MailEnvelope & MailContent;

export interface MailTransport {
  readonly kind: 'smtp' | 'log' | 'memory';
  deliver(mail: Mail, from: MailAddress): Promise<void>;
  close?(): void;
}

// The SMTP settings: STARTTLS is required, with a valid certificate, unless the connection is TLS from the start
// (SMTP_SECURE=true) or SMTP_REQUIRE_TLS=false (a local test server such as Mailpit)
export function smtpOptions(smtp: SmtpConfig): SMTPTransport.Options {
  const options: SMTPTransport.Options = {
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    connectionTimeout: 10 * 1000,
    greetingTimeout: 10 * 1000,
    socketTimeout: 30 * 1000,
    // Mails never attach files or fetch anything
    disableFileAccess: true,
    disableUrlAccess: true,
  };

  if (smtp.secure) {
    options.tls = {rejectUnauthorized: true};
  } else if (smtp.requireTls) {
    options.requireTLS = true;
    options.tls = {rejectUnauthorized: true};
  }

  if (smtp.user !== null)
    options.auth = {user: smtp.user, pass: smtp.password ?? ''};

  return options;
}

export function smtpTransport(smtp: SmtpConfig): MailTransport {
  const transporter = createTransport(smtpOptions(smtp));
  return {
    kind: 'smtp',
    async deliver(mail, from) {
      await transporter.sendMail({
        from: {name: from.name, address: from.address},
        // Always an object: nodemailer would read a string as a list of addresses, with names
        to: {name: '', address: mail.to},
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
        headers: {'Auto-Submitted': 'auto-generated'},
      });
    },
    close: () => transporter.close(),
  };
}

// Development only: the mail is written to the server's log
export function logTransport(log: Logger): MailTransport {
  return {
    kind: 'log',
    async deliver(mail) {
      log.info('mail.log', {message: 'MAIL_TRANSPORT=log: this mail was not sent', template: mail.template,
                            to: mail.to, subject: mail.subject, text: mail.text});
    },
  };
}

// Tests: the mails are kept in `sent`
export class MemoryTransport implements MailTransport {
  readonly kind = 'memory';
  readonly sent: Mail[] = [];
  // The next deliveries fail with this error (for tests)
  failWith: Error | null = null;

  async deliver(mail: Mail): Promise<void> {
    if (this.failWith)
      throw this.failWith;
    this.sent.push(mail);
  }

  // The mails sent to an address, oldest first
  to(address: string): Mail[] {
    return this.sent.filter(mail => mail.to === address);
  }

  clear(): void {
    this.sent.length = 0;
  }
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export const RECIPIENT_LIMITS: readonly {limit: number; windowMs: number}[] = [
  {limit: 3, windowMs: HOUR},
  {limit: 10, windowMs: DAY},
];

// The notices are only sent after something that needs the account's password, a session or a mailed link (each
// with limits of its own): a few more are allowed, apart from the links
export const NOTICE_LIMITS: readonly {limit: number; windowMs: number}[] = [
  {limit: 5, windowMs: HOUR},
  {limit: 20, windowMs: DAY},
];

export const QUEUE_LIMIT = 500;

// The default sender of the log and memory transports, which send nothing
export const NO_SENDER: MailAddress = {name: 'KawaCity', address: 'kawacity@localhost'};

const ALL = 'all';

// What went wrong with a mail, in the log: nodemailer's code and the SMTP command and reply code, never the text of
// the error, where the server's reply (which usually repeats the address) is copied
const failure = (error: unknown) => {
  const e = (typeof error === 'object' && error !== null ? error : {}) as
    {code?: unknown; originalCode?: unknown; command?: unknown; responseCode?: unknown; response?: unknown};
  const text = (value: unknown) => typeof value === 'string' ? value.slice(0, 40) : undefined;
  return {
    // EENVELOPE, ECONNECTION, EAUTH... (and the system's code, such as ECONNREFUSED)
    code: text(e.code),
    originalCode: text(e.originalCode),
    // RCPT TO, DATA, AUTH PLAIN...
    command: text(e.command),
    responseCode: typeof e.responseCode === 'number' ? e.responseCode : undefined,
    // The enhanced status code of the reply: 5.1.1 (no such mailbox), 5.7.1 (refused)...
    status: typeof e.response === 'string' ? /\b[245]\.\d{1,3}\.\d{1,3}\b/.exec(e.response)?.[0] : undefined,
  };
};

export type DropReason = 'recipient' | 'global' | 'queue' | 'closed';

export interface MailerOptions {
  transport: MailTransport;
  from: MailAddress;
  clock: Clock;
  log: Logger;
  // MAIL_MAX_PER_HOUR
  maxPerHour: number;
  queueLimit?: number;
}

export class Mailer {
  readonly transport: MailTransport;
  private readonly from: MailAddress;
  private readonly log: Logger;
  private readonly queueLimit: number;
  private readonly recipientLimiters: RateLimiter[];
  private readonly noticeLimiters: RateLimiter[];
  private readonly globalLimiter: RateLimiter;
  private readonly queue: Mail[] = [];
  private sending = false;
  private closed = false;
  private idleWaiters: (() => void)[] = [];

  constructor(options: MailerOptions) {
    this.transport = options.transport;
    this.from = options.from;
    this.log = options.log;
    this.queueLimit = options.queueLimit ?? QUEUE_LIMIT;
    this.recipientLimiters = RECIPIENT_LIMITS.map(({limit, windowMs}) =>
      new RateLimiter({limit, windowMs, clock: options.clock}));
    this.noticeLimiters = NOTICE_LIMITS.map(({limit, windowMs}) =>
      new RateLimiter({limit, windowMs, clock: options.clock}));
    this.globalLimiter = new RateLimiter({limit: options.maxPerHour, windowMs: HOUR, clock: options.clock});
  }

  // The per-recipient limits a mail counts against
  private limitersFor(notice: boolean): RateLimiter[] {
    return notice ? this.noticeLimiters : this.recipientLimiters;
  }

  // Why a mail to that recipient would be dropped now, or null if it would be sent
  private refusal(toKey: string, notice: boolean): DropReason | null {
    if (this.closed)
      return 'closed';
    if (this.queue.length >= this.queueLimit)
      return 'queue';
    // Links only (see the top of this file)
    if (!notice && !this.globalLimiter.check(ALL).allowed)
      return 'global';
    if (this.limitersFor(notice).some(limiter => !limiter.check(toKey).allowed))
      return 'recipient';
    return null;
  }

  // Whether a mail (a link, unless notice) to that recipient would be sent now: checked before making the token a
  // mail would carry
  allows(toKey: string, notice = false): boolean {
    return this.refusal(toKey, notice) === null;
  }

  // Queues a mail, or drops it over a limit (logged as mail.dropped). Never throws; true when queued. The content
  // may be given as a function, called only if the mail is sent: a link's token is then made only when it is.
  send(envelope: MailEnvelope, content: MailContent | (() => MailContent)): boolean {
    const notice = envelope.notice === true;
    const reason = this.refusal(envelope.toKey, notice);
    if (reason) {
      // Once a minute per reason and template: a notice dropped is not lost among links dropped
      this.log.security('mail.dropped', `${reason} ${envelope.template}`,
                        {reason, template: envelope.template, notice: notice || undefined});
      return false;
    }

    const {subject, text, html} = typeof content === 'function' ? content() : content;
    if (!notice)
      this.globalLimiter.hit(ALL);
    this.limitersFor(notice).forEach(limiter => limiter.hit(envelope.toKey));
    this.queue.push({template: envelope.template, to: envelope.to, toKey: envelope.toKey, subject, text, html});
    if (!this.sending)
      void this.drain();
    return true;
  }

  private async drain(): Promise<void> {
    this.sending = true;
    let mail: Mail | undefined;
    while ((mail = this.queue.shift()) !== undefined) {
      try {
        await this.transport.deliver(mail, this.from);
        this.log.info('mail.sent', {template: mail.template});
      } catch (error) {
        // Nothing of the recipient: even a hash of the address, which anyone could check for an address they guess
        this.log.error('mail.error', {template: mail.template, ...failure(error),
                                      message: 'A mail could not be sent: the mail-test admin command shows the ' +
                                               'whole error'});
      }
    }

    this.sending = false;
    this.idleWaiters.splice(0).forEach(resolve => resolve());
  }

  // Resolves once every queued mail was handed to the transport (or failed)
  idle(): Promise<void> {
    if (!this.sending && this.queue.length === 0)
      return Promise.resolve();
    return new Promise(resolve => this.idleWaiters.push(resolve));
  }

  // Refuses new mails, gives the queued ones up to `timeoutMs` to go, then closes the transport
  async close(timeoutMs = 3000): Promise<void> {
    if (this.closed)
      return;
    this.closed = true;

    let timer: NodeJS.Timeout | undefined;
    await Promise.race([this.idle(), new Promise<void>(resolve => { timer = setTimeout(resolve, timeoutMs); })]);
    clearTimeout(timer);
    if (this.queue.length > 0)
      this.log.warn('mail.unsent', {count: this.queue.length, message: 'Mails still queued at shutdown were not sent'});
    this.transport.close?.();
  }
}

// The mailer of a configuration: null when no mail can be sent (no SMTP_HOST, no MAIL_TRANSPORT=log)
export function createMailer(config: Config, deps: {clock: Clock; log: Logger}): Mailer | null {
  let transport: MailTransport;
  if (config.mailTransport === 'smtp' && config.smtp)
    transport = smtpTransport(config.smtp);
  else if (config.mailTransport === 'log')
    transport = logTransport(deps.log);
  else
    return null;

  return new Mailer({transport, from: config.mailFrom ?? NO_SENDER, clock: deps.clock, log: deps.log,
                     maxPerHour: config.mailMaxPerHour});
}
