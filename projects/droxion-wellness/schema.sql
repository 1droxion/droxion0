CREATE TABLE IF NOT EXISTS products (
  slug text PRIMARY KEY, enabled boolean NOT NULL DEFAULT true, data jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  id boolean PRIMARY KEY CHECK (id), data jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS media (
  id uuid PRIMARY KEY, contents bytea NOT NULL CHECK (octet_length(contents) <= 1048576)
);
CREATE TABLE IF NOT EXISTS subscribers (
  email text PRIMARY KEY, consent_at timestamptz NOT NULL DEFAULT now(), unsubscribed_at timestamptz,
  consent_version text NOT NULL
);
CREATE TABLE IF NOT EXISTS subscriber_interests (
  email text REFERENCES subscribers(email) ON DELETE CASCADE, slug text REFERENCES products(slug),
  PRIMARY KEY (email, slug)
);
CREATE TABLE IF NOT EXISTS events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, at timestamptz NOT NULL DEFAULT now(),
  visitor uuid NOT NULL, kind text NOT NULL CHECK (kind IN ('home','view','interest','notify')),
  slug text REFERENCES products(slug), device text NOT NULL, referrer text NOT NULL, campaign jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS events_at ON events(at);
CREATE INDEX IF NOT EXISTS events_slug_kind ON events(slug, kind);
CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash text PRIMARY KEY, csrf text NOT NULL, expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, at timestamptz NOT NULL DEFAULT now(),
  action text NOT NULL, target text NOT NULL
);
CREATE TABLE IF NOT EXISTS finances (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, at timestamptz NOT NULL DEFAULT now(),
  kind text CHECK (kind IN ('projection','actual')), slug text REFERENCES products(slug), data jsonb NOT NULL
);
