-- Retail shops on the showcase store (Cloudflare D1). Mirrors backend/retail on the Django store.

-- Staff who sign in with a username and password. The Boss is not stored here: their
-- login comes from the BOSS_USERNAME / BOSS_PASSWORD Worker secrets.
CREATE TABLE staff (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('RETAILER')),
  first_name TEXT NOT NULL DEFAULT '',
  last_name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  city TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE stores (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL UNIQUE REFERENCES staff(id),
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  phone TEXT NOT NULL,
  gst_number TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL,
  city_name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

-- Schools added through retailers' requests, and showcase schools given a UDISE code.
-- A showcase school keeps its id from showcase-data.json.
CREATE TABLE schools (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  udise_code TEXT UNIQUE,
  city TEXT NOT NULL,
  city_name TEXT NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  board TEXT NOT NULL DEFAULT '',
  pincode TEXT NOT NULL DEFAULT '',
  logo_key TEXT,
  active INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE store_schools (
  store_id TEXT NOT NULL REFERENCES stores(id),
  school_id TEXT NOT NULL,
  PRIMARY KEY (store_id, school_id)
);

CREATE TABLE school_requests (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id),
  name TEXT NOT NULL,
  udise_code TEXT NOT NULL,
  address TEXT NOT NULL,
  city TEXT NOT NULL,
  city_name TEXT NOT NULL,
  board TEXT NOT NULL,
  pincode TEXT NOT NULL,
  logo_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
  school_id TEXT,
  reviewed_by TEXT,
  reviewed_at TEXT,
  reject_reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX uniq_pending_request_per_store_udise ON school_requests (store_id, udise_code) WHERE status = 'PENDING';
CREATE INDEX idx_school_requests_status_created ON school_requests (status, created_at);
CREATE INDEX idx_school_requests_store_created ON school_requests (store_id, created_at);
