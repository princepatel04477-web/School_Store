CREATE TABLE parent_otps (
  phone TEXT PRIMARY KEY,
  code INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
