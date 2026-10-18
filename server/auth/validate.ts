/* KawaCity, a modified version of micropolisJS.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

import { FieldErrors, FieldReason, HttpError } from '../http/response';
import { BODY_LIMIT } from '../limits';
import { passwordProblem } from '../security/passwords';
import { checkEmail } from './users';

// Reading request bodies: a body is an object with known fields only, copied into a fresh object; anything else is
// refused with 400 invalid_input (with the reason of each field at fault).

const hasOwn = (object: object, key: string) => Object.prototype.hasOwnProperty.call(object, key);

export const invalidInput = (fields?: FieldErrors) => new HttpError(400, 'invalid_input', fields);

// The body's fields: every required one present, optional ones maybe, no others
export function readFields<R extends string, O extends string = never>(body: unknown, required: readonly R[],
                                                                      optional: readonly O[] = []):
    Record<R, unknown> & Partial<Record<O, unknown>> {
  if (typeof body !== 'object' || body === null || Array.isArray(body))
    throw invalidInput();

  const known = new Set<string>([...required, ...optional]);
  if (Object.keys(body).some(key => !known.has(key)))
    throw invalidInput();

  const missing: Record<string, FieldReason> = {};
  const fields: Record<string, unknown> = {};
  for (const key of known) {
    if (hasOwn(body, key))
      fields[key] = (body as Record<string, unknown>)[key];
    else if ((required as readonly string[]).includes(key))
      missing[key] = 'required';
  }

  if (Object.keys(missing).length > 0)
    throw invalidInput(missing);
  return fields as Record<R, unknown> & Partial<Record<O, unknown>>;
}

// The body of a request that takes nothing: {}
export function readEmpty(body: unknown): void {
  readFields(body, []);
}

// A string field, at most maxLength UTF-16 units long; empty is 'required' unless allowEmpty
export function stringField(value: unknown, field: string, maxLength: number, allowEmpty = false): string {
  if (typeof value !== 'string')
    throw invalidInput({[field]: 'invalid'});
  if (value === '' && !allowEmpty)
    throw invalidInput({[field]: 'required'});
  if (value.length > maxLength)
    throw invalidInput({[field]: 'too_long'});
  return value;
}

const EMAIL_FIELD = 1024;

// The address of a form, checked: 400 invalid_input with the reason under `field`
export function emailField(value: unknown, field: string): {email: string; key: string} {
  const checked = checkEmail(stringField(value, field, EMAIL_FIELD));
  if (!checked.ok)
    throw invalidInput({[field]: checked.reason});
  return checked;
}

// A new password, checked against the rules (read at any length the body allows, so that a long one is refused as
// weak_password too_long): 400 weak_password with the reason under `field`
export function newPasswordField(value: unknown, field: string, owner: {username: string; email: string}): string {
  const password = stringField(value, field, BODY_LIMIT);
  const problem = passwordProblem(password, owner);
  if (problem)
    throw new HttpError(400, 'weak_password', {[field]: problem});
  return password;
}
