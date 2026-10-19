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

  // 2: shared cities and regions. A city's state is its save: one format byte (1: the save's JSON, gzipped) and the
  // gzip. edge_state is what the city has at each of its edges for the cities beside it in a region (see
  // game/regionLink.ts): {side: {transport, power, powerOut, signed: {trade, buyPower, sellPower, twinning}}}. Each member
  // of a city has a colour of their own there (an index in the palette of game/room.ts).
  `
  CREATE TABLE regions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    public_id TEXT UNIQUE NOT NULL,
    owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    width INTEGER NOT NULL CHECK (width BETWEEN 2 AND 4),
    height INTEGER NOT NULL CHECK (height BETWEEN 2 AND 4),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX regions_owner ON regions(owner_id);

  CREATE TABLE cities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    public_id TEXT UNIQUE NOT NULL,
    owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    state BLOB NOT NULL,
    population INTEGER NOT NULL DEFAULT 0,
    city_time INTEGER NOT NULL DEFAULT 0,
    paused INTEGER NOT NULL DEFAULT 0,
    region_id INTEGER REFERENCES regions(id) ON DELETE SET NULL,
    region_x INTEGER,
    region_y INTEGER,
    edge_state TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    played_at INTEGER,
    UNIQUE (region_id, region_x, region_y)
  );
  CREATE INDEX cities_owner ON cities(owner_id);

  CREATE TABLE city_members (
    city_id INTEGER NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('owner', 'player', 'viewer')),
    colour INTEGER NOT NULL DEFAULT 0,
    joined_at INTEGER NOT NULL,
    PRIMARY KEY (city_id, user_id)
  );
  CREATE INDEX city_members_user ON city_members(user_id);

  CREATE TABLE city_invitations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    public_id TEXT UNIQUE NOT NULL,
    city_id INTEGER NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
    inviter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    invitee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('player', 'viewer')),
    created_at INTEGER NOT NULL,
    UNIQUE (city_id, invitee_id)
  );
  CREATE INDEX city_invitations_invitee ON city_invitations(invitee_id);
  CREATE INDEX city_invitations_inviter ON city_invitations(inviter_id);

  CREATE TABLE region_members (
    region_id INTEGER NOT NULL REFERENCES regions(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at INTEGER NOT NULL,
    PRIMARY KEY (region_id, user_id)
  );
  CREATE INDEX region_members_user ON region_members(user_id);

  CREATE TABLE region_invitations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    public_id TEXT UNIQUE NOT NULL,
    region_id INTEGER NOT NULL REFERENCES regions(id) ON DELETE CASCADE,
    inviter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    invitee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    UNIQUE (region_id, invitee_id)
  );
  CREATE INDEX region_invitations_invitee ON region_invitations(invitee_id);
  CREATE INDEX region_invitations_inviter ON region_invitations(inviter_id);
  `,

  // 3: public regions, open to every player: listed in the lobby, joined without an invitation. A player the owner
  // removed from a region does not join it again that way (an invitation from its owner still lets them in).
  `
  ALTER TABLE regions ADD COLUMN is_public INTEGER NOT NULL DEFAULT 0 CHECK (is_public IN (0, 1));
  CREATE INDEX regions_public ON regions(is_public, created_at);

  CREATE TABLE region_removals (
    region_id INTEGER NOT NULL REFERENCES regions(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    removed_at INTEGER NOT NULL,
    PRIMARY KEY (region_id, user_id)
  );
  CREATE INDEX region_removals_user ON region_removals(user_id);
  `,
];
