-- The retailer accepts or rejects each finished mock-up; a set goes live only when all are accepted.
ALTER TABLE mockups ADD COLUMN review TEXT NOT NULL DEFAULT 'PENDING' CHECK (review IN ('PENDING', 'ACCEPTED', 'REJECTED'));
