/* KawaCity, a modified version of micropolisJS.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details.
 *
 */

// The database schema, as the list of its versions: the SQL of version n is MIGRATIONS[n - 1]. A version, once
// released, never changes: a change is a new version at the end.
//
// Ids are INTEGER PRIMARY KEY AUTOINCREMENT so that an id is never reused (a stale reference cannot point at a newer
// row). Times are Unix milliseconds. Tokens are stored as their SHA-256 (hex).

export const MIGRATIONS: readonly string[] = [
  // 1: accounts
  `
  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    public_id TEXT UNIQUE NOT NULL,
    username TEXT NOT NULL,
    username_key TEXT UNIQUE NOT NULL,
    username_skeleton TEXT UNIQUE NOT NULL,
    email TEXT NOT NULL,
    email_key TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    locale TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    last_login_at INTEGER,
    failed_logins_day INTEGER NOT NULL DEFAULT 0,
    failed_window_start INTEGER,
    locked_until INTEGER
  );

  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX sessions_user ON sessions(user_id);
  CREATE INDEX sessions_expiry ON sessions(expires_at);

  CREATE TABLE signup_tokens (
    token_hash TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    email_key TEXT NOT NULL,
    locale TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX signup_tokens_email ON signup_tokens(email_key);
  CREATE INDEX signup_tokens_expiry ON signup_tokens(expires_at);

  CREATE TABLE email_tokens (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    purpose TEXT NOT NULL CHECK (purpose IN ('reset', 'email_change')),
    new_email TEXT,
    new_email_key TEXT,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX email_tokens_user ON email_tokens(user_id);
  CREATE INDEX email_tokens_expiry ON email_tokens(expires_at);

  CREATE TABLE captcha_used (
    salt TEXT PRIMARY KEY,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX captcha_used_expiry ON captcha_used(expires_at);
  `,
];
