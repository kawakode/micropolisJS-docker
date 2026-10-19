/* KawaCity, a modified version of micropolisJS.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

import { EMAIL_TEXTS } from '../../src/emailTexts.js';
import { I18n } from '../../src/i18n.js';
import { FakeClock } from '../clock';
import { createLogger } from '../log';
import { createMailer, Mail, Mailer, MailTransport, MemoryTransport, smtpOptions } from '../mail/mailer';
import { sha256Hex } from '../security/tokens';
import { escapeHtml, renderMail } from '../mail/render';
import { testConfig } from '../testing';

const HOUR = 60 * 60 * 1000;

const setUp = (options: {maxPerHour?: number; queueLimit?: number; transport?: MailTransport} = {}) => {
  const clock = new FakeClock();
  const logs: any[] = [];
  const log = createLogger({level: 'debug', clock, write: line => logs.push(JSON.parse(line))});
  const transport = options.transport ?? new MemoryTransport();
  const mailer = new Mailer({transport, from: {name: 'KawaCity', address: 'k@example.com'}, clock, log,
                             maxPerHour: options.maxPerHour ?? 200, queueLimit: options.queueLimit});
  return {clock, logs, mailer, transport};
};

const mail = (to: string, template = 'test') => ({template, to, toKey: to.toLowerCase()});
const content = {subject: 'Subject', text: 'Text'};

describe('Mailer', () => {
  test('Sends after the caller goes on, never throwing; failures are logged without the text', async () => {
    const {mailer, logs, transport} = setUp();
    const memory = transport as MemoryTransport;
    expect(mailer.send(mail('a@example.com'), content)).toBe(true);
    await mailer.idle();
    expect(memory.sent).toEqual([{template: 'test', to: 'a@example.com', toKey: 'a@example.com', subject: 'Subject',
                                  text: 'Text', html: undefined}]);
    expect(logs.some(line => line.event === 'mail.sent' && line.template === 'test')).toBe(true);

    // As nodemailer makes them: the server's reply, with the address, in the message
    const reply = '550 5.1.1 <B@example.com>: Recipient address rejected: User unknown in local recipient table';
    memory.failWith = Object.assign(new Error('Can\'t send mail - all recipients were rejected: ' + reply),
                                    {code: 'EENVELOPE', command: 'RCPT TO', response: reply, responseCode: 550});
    expect(mailer.send(mail('B@example.com', 'reset'), {subject: 'S', text: 'secret link'})).toBe(true);
    await mailer.idle();
    memory.failWith = new Error('Invalid recipient "c.private@example.org"');
    expect(mailer.send(mail('c.private@example.org', 'signup'), content)).toBe(true);
    await mailer.idle();

    const errors = logs.filter(line => line.event === 'mail.error');
    expect(errors[0]).toMatchObject({level: 'error', template: 'reset', code: 'EENVELOPE', command: 'RCPT TO',
                                     responseCode: 550, status: '5.1.1'});
    expect(errors[1]).toMatchObject({level: 'error', template: 'signup'});
    // Neither the address, nor a hash of it (anyone could check a guess), nor the mail's text
    const logText = JSON.stringify(logs).toLowerCase();
    for (const secret of ['b@example.com', 'c.private', 'secret link', 'user unknown',
                          ...['b@example.com', 'c.private@example.org'].map(key => sha256Hex(key).slice(0, 8))])
      expect(logText).not.toContain(secret);
  });

  test('3 mails an hour and 10 a day per recipient; over that they are dropped, silently', async () => {
    const {mailer, clock, logs, transport} = setUp();
    const memory = transport as MemoryTransport;
    let made = 0;
    const lazy = () => {
      made++;
      return content;
    };

    const sent: boolean[] = [];
    for (let i = 0; i < 4; i++)
      sent.push(mailer.send(mail('A@example.com'), lazy));
    expect(sent).toEqual([true, true, true, false]);
    // The content (and the token it would carry) is only made for mails that go
    expect(made).toBe(3);
    // Another recipient is not concerned; the key is the address in lower case
    expect(mailer.send(mail('b@example.com'), content)).toBe(true);
    expect(mailer.allows('a@example.com')).toBe(false);
    expect(mailer.allows('c@example.com')).toBe(true);

    const dropped = logs.find(line => line.event === 'mail.dropped');
    expect(dropped).toMatchObject({level: 'warn', reason: 'recipient', template: 'test'});
    expect(JSON.stringify(dropped)).not.toContain('example.com');

    // Over the day: 10 at most
    let total = 3;
    for (let hours = 2; hours < 24; hours += 2) {
      clock.advance(2 * HOUR);
      for (let i = 0; i < 3; i++)
        total += mailer.send(mail('a@example.com'), content) ? 1 : 0;
    }
    expect(total).toBe(10);
    await mailer.idle();
    expect(memory.to('A@example.com').length + memory.to('a@example.com').length).toBe(total);
  });

  test('Notices have limits of their own: links cannot use them up', () => {
    const {mailer} = setUp();
    const notice = (to: string) => ({...mail(to, 'passwordChanged'), notice: true});

    for (let i = 0; i < 3; i++)
      expect(mailer.send(mail('a@example.com', 'reset'), content)).toBe(true);
    expect(mailer.allows('a@example.com')).toBe(false);
    expect(mailer.allows('a@example.com', true)).toBe(true);

    const sent = [];
    for (let i = 0; i < 6; i++)
      sent.push(mailer.send(notice('a@example.com'), content));
    expect(sent).toEqual([true, true, true, true, true, false]);
    // Nor do notices use up the links'
    expect(mailer.send(mail('b@example.com', 'reset'), content)).toBe(true);
    for (let i = 0; i < 5; i++)
      mailer.send(notice('b@example.com'), content);
    expect(mailer.allows('b@example.com')).toBe(true);
  });

  test('MAIL_MAX_PER_HOUR in all', () => {
    const {mailer, logs} = setUp({maxPerHour: 5});
    const sent = [];
    for (let i = 0; i < 7; i++)
      sent.push(mailer.send(mail(`user${i}@example.com`), content));
    expect(sent).toEqual([true, true, true, true, true, false, false]);
    expect(logs.filter(line => line.event === 'mail.dropped')[0]).toMatchObject({reason: 'global'});
  });

  test('Links up to MAIL_MAX_PER_HOUR do not silence notices, nor hide that one was dropped', () => {
    const {mailer, logs, clock} = setUp({maxPerHour: 5});
    const notice = (to: string) => ({...mail(to, 'passwordChanged'), notice: true});
    // Links anyone can ask for, to addresses of their choosing
    for (let i = 0; i < 6; i++)
      mailer.send(mail(`junk${i}@example.net`, 'signup'), content);
    expect(mailer.allows('victim@example.com')).toBe(false);

    expect(mailer.allows('victim@example.com', true)).toBe(true);
    expect(mailer.send(notice('victim@example.com'), content)).toBe(true);
    // Nor do notices count against the links' budget (once the links' hour is over)
    clock.advance(2 * HOUR);
    for (let i = 0; i < 10; i++)
      mailer.send(notice(`owner${i}@example.com`), content);
    expect(mailer.send(mail('new@example.net', 'signup'), content)).toBe(true);

    // A notice over its own limit is logged on a line of its own, not counted among the links dropped
    for (let i = 0; i < 6; i++)
      mailer.send(notice('owner0@example.com'), content);
    const dropped = logs.filter(line => line.event === 'mail.dropped');
    expect(dropped.map(line => [line.reason, line.template, line.notice])).toEqual(
      [['global', 'signup', undefined], ['recipient', 'passwordChanged', true]]);
  });

  test('A bounded queue', async () => {
    let release = () => {};
    const delivered: string[] = [];
    const slow: MailTransport = {
      kind: 'memory',
      deliver: (m: Mail) => new Promise(resolve => {
        release = () => {
          delivered.push(m.to);
          resolve();
        };
      }),
    };
    const {mailer, logs} = setUp({transport: slow, queueLimit: 3});
    const sent = [];
    // The first is being sent, three wait, the fifth finds the queue full
    for (let i = 0; i < 5; i++)
      sent.push(mailer.send(mail(`user${i}@example.com`), content));
    expect(sent).toEqual([true, true, true, true, false]);
    expect(logs.find(line => line.event === 'mail.dropped')).toMatchObject({reason: 'queue'});

    const idle = mailer.idle();
    for (let i = 0; i < 4; i++) {
      release();
      await new Promise(resolve => setImmediate(resolve));
    }
    await idle;
    expect(delivered).toEqual(['user0@example.com', 'user1@example.com', 'user2@example.com', 'user3@example.com']);
  });

  test('Closing sends what is queued, then refuses', async () => {
    const {mailer, transport} = setUp();
    mailer.send(mail('a@example.com'), content);
    await mailer.close();
    expect((transport as MemoryTransport).sent.length).toBe(1);
    expect(mailer.send(mail('b@example.com'), content)).toBe(false);
  });

  test('Transports from the configuration: SMTP with TLS required, log, or none', () => {
    const clock = new FakeClock();
    const log = createLogger({level: 'error', clock, write: () => undefined});
    expect(createMailer(testConfig(), {clock, log})).toBeNull();
    expect(createMailer(testConfig({MAIL_TRANSPORT: 'log'}), {clock, log})?.transport.kind).toBe('log');
    const smtp = createMailer(testConfig({SMTP_HOST: 'smtp.example.com', MAIL_FROM: 'k@example.com'}), {clock, log});
    expect(smtp?.transport.kind).toBe('smtp');
    smtp?.transport.close?.();

    const base = {host: 'smtp.example.com', port: 587, secure: false, requireTls: true, user: null, password: null};
    expect(smtpOptions(base)).toMatchObject({host: 'smtp.example.com', port: 587, secure: false, requireTLS: true,
                                             tls: {rejectUnauthorized: true}, disableFileAccess: true,
                                             disableUrlAccess: true});
    expect(smtpOptions(base).auth).toBeUndefined();
    expect(smtpOptions({...base, port: 465, secure: true, user: 'u', password: 'p'})).toMatchObject(
      {secure: true, tls: {rejectUnauthorized: true}, auth: {user: 'u', pass: 'p'}});
    expect(smtpOptions({...base, secure: true}).requireTLS).toBeUndefined();
    // Mailpit in compose.dev.yml: no TLS
    const plain = smtpOptions({...base, port: 1025, requireTls: false});
    expect(plain.requireTLS).toBeUndefined();
    expect(plain.tls).toBeUndefined();
  });

  test('The log transport writes the mail, links included, to the log', async () => {
    const clock = new FakeClock();
    const logs: any[] = [];
    const log = createLogger({level: 'info', clock, write: line => logs.push(JSON.parse(line))});
    const mailer = createMailer(testConfig({MAIL_TRANSPORT: 'log'}), {clock, log}) as Mailer;
    mailer.send(mail('a@example.com', 'signup'), {subject: 'S', text: 'Open http://localhost:8080/#/signup/T'});
    await mailer.idle();
    expect(logs.find(line => line.event === 'mail.log')).toMatchObject(
      {to: 'a@example.com', subject: 'S', text: 'Open http://localhost:8080/#/signup/T', template: 'signup'});
  });
});

describe('Account emails', () => {
  const site = 'https://kawacity.example.com';
  const link = `${site}/#/reset/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`;

  test('Every template renders in English and French, with every placeholder filled', () => {
    const params = {site, link, username: 'Alice', hours: 24};
    for (const template of Object.keys(EMAIL_TEXTS) as (keyof typeof EMAIL_TEXTS)[]) {
      const en = renderMail(template, 'en', params);
      const fr = renderMail(template, 'fr', params);
      for (const rendered of [en, fr]) {
        expect(rendered.subject).not.toMatch(/[{}]/);
        expect(rendered.text).not.toMatch(/\{\w+\}/);
        expect(rendered.html).not.toMatch(/\{\w+\}/);
        expect(rendered.subject).not.toContain('Alice');
      }
      expect(en.subject).toBe(EMAIL_TEXTS[template].subject);
      expect(fr.subject).toBe(I18n.translate('fr', EMAIL_TEXTS[template].subject));
      expect(fr.subject).not.toBe(en.subject);
      expect(fr.text).not.toBe(en.text);
      expect(fr.html).toContain('<html lang="fr">');
      expect(en.html).toContain('<html lang="en">');
    }

    expect(renderMail('reset', 'de', params).subject).toBe(EMAIL_TEXTS.reset.subject);
  });

  test('The text, and an HTML part with a paragraph per paragraph and the link as a link', () => {
    const rendered = renderMail('reset', 'en', {site, link, username: 'Alice', hours: 1});
    expect(rendered.text).toBe(I18n.translate('en', EMAIL_TEXTS.reset.text, {site, link, username: 'Alice', hours: 1}));
    expect(rendered.text).toContain(`\n\n${link}\n\n`);
    expect(rendered.text).toContain('within 1 h');

    const paragraphs = rendered.text.split('\n\n');
    expect(rendered.html.match(/<p>/g)?.length).toBe(paragraphs.length);
    expect(rendered.html).toContain(`<p><a href="${link}">${link}</a></p>`);
    expect(rendered.html).toContain('<p>Hello Alice,</p>');
    expect(rendered.html).toContain('<title>Choose a new KawaCity password</title>');
    // Only these elements
    expect(rendered.html.match(/<\/?[a-z]+/g)?.filter(tag => !['<html', '</html', '<head', '</head', '<meta', '<title',
      '</title', '<body', '</body', '<p', '</p', '<a', '</a'].includes(tag))).toEqual([]);
  });

  test('Every value is escaped in the HTML part', () => {
    const evil = 'x"><script>alert(1)</script>&\'';
    const rendered = renderMail('alreadyRegistered', 'fr', {site: 'https://a.example/?a=1&b="2"', link: evil,
                                                             username: evil, hours: 24});
    expect(rendered.html).not.toContain('<script>');
    expect(rendered.html).toContain('x&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;&amp;&#39;');
    expect(rendered.html).toContain('https://a.example/?a=1&amp;b=&quot;2&quot;');
    // The link paragraph's href is escaped too
    expect(rendered.html).toContain('<a href="x&quot;&gt;&lt;script&gt;');
    // The text part is plain text
    expect(rendered.text).toContain(evil);
    expect(escapeHtml('&<>"\'')).toBe('&amp;&lt;&gt;&quot;&#39;');
  });

  test('French typography: no-break spaces before high punctuation', () => {
    const rendered = renderMail('passwordChanged', 'fr', {site, username: 'Alice'});
    expect(rendered.text).toContain(' :');
    expect(rendered.text).not.toMatch(/ [:;!?]/);
  });
});
