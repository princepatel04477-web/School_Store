-- Uniform sets a retailer sells for an approved school, and the mock-ups of each set on the
-- store's fixed model students (one per class and gender, see frontend/public/models).

-- A set is always shirt + pant (boys) or shirt + skirt (girls): both photos are required.
CREATE TABLE uniforms (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id),
  school_id TEXT NOT NULL,
  gender TEXT NOT NULL CHECK (gender IN ('BOY', 'GIRL')),
  class_from INTEGER NOT NULL CHECK (class_from BETWEEN 1 AND 12),
  class_to INTEGER NOT NULL CHECK (class_to BETWEEN 1 AND 12),
  name TEXT NOT NULL,
  price INTEGER NOT NULL CHECK (price > 0),
  sizes TEXT NOT NULL DEFAULT '[]',
  top_photo_key TEXT NOT NULL,
  bottom_photo_key TEXT NOT NULL,
  -- DRAFT: mock-ups not made or not all done; LIVE: published to parents; HIDDEN: taken down by the Boss
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'LIVE', 'HIDDEN')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (class_from <= class_to)
);
CREATE INDEX idx_uniforms_store ON uniforms (store_id, created_at);
CREATE INDEX idx_uniforms_school ON uniforms (school_id, gender, status);

-- One mock-up per class in the set's range. Made in two try-on runs: the shirt onto the model,
-- then the pant or skirt onto that result.
CREATE TABLE mockups (
  id TEXT PRIMARY KEY,
  uniform_id TEXT NOT NULL REFERENCES uniforms(id),
  class_no INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED', 'TOP', 'BOTTOM', 'DONE', 'FAILED')),
  job_id TEXT,
  top_image_url TEXT,
  image_key TEXT,
  seed INTEGER NOT NULL DEFAULT 42,
  error TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  UNIQUE (uniform_id, class_no)
);
CREATE INDEX idx_mockups_status ON mockups (status);
