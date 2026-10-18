/* KawaCity, a modified version of micropolisJS.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

import { EMAIL_TEXTS } from '../../src/emailTexts.js';
import { I18n } from '../../src/i18n.js';

// The account emails, in the player's language: their texts are in src/emailTexts.js (English, which is also the key
// of the French text in src/lang/fr.js), filled in with I18n.translate. Each mail has a text part, and an HTML part
// made from it: one paragraph per paragraph of the text, every character escaped, and the paragraph that is the link
// made a link. Subjects hold nothing about the account.

export type EmailTemplate = keyof typeof EMAIL_TEXTS;

export type MailParams = Readonly<Record<string, string | number>>;

export interface RenderedMail {
  subject: string;
  text: string;
  html: string;
}

const HTML_ESCAPES: Record<string, string> = {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'};

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, c => HTML_ESCAPES[c]);
}

// The language a mail is written in: a player's locale, English for anything else
const languageOf = (lang: string) => (I18n.LANGUAGES as readonly string[]).includes(lang) ? lang : 'en';

export function renderMail(template: EmailTemplate, lang: string, params: MailParams): RenderedMail {
  const language = languageOf(lang);
  const {subject, text} = EMAIL_TEXTS[template];
  const filled = I18n.translate(language, text, params) as string;
  const link = typeof params.link === 'string' ? params.link : null;

  const paragraphs = filled.split('\n\n').map(paragraph => {
    const escaped = escapeHtml(paragraph);
    if (link !== null && paragraph === link)
      return `<p><a href="${escaped}">${escaped}</a></p>`;
    return `<p>${escaped.replace(/\n/g, '<br>')}</p>`;
  });

  const title = escapeHtml(I18n.translate(language, subject) as string);
  return {
    subject: I18n.translate(language, subject) as string,
    text: filled,
    html: `<!DOCTYPE html>\n<html lang="${language}">\n<head>\n<meta charset="utf-8">\n<title>${title}</title>\n` +
          `</head>\n<body>\n${paragraphs.join('\n')}\n</body>\n</html>\n`,
  };
}
