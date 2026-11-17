-- Add public logo fields to schools table for the About page showcase
ALTER TABLE schools ADD COLUMN logo_url TEXT;
ALTER TABLE schools ADD COLUMN show_logo_public INTEGER NOT NULL DEFAULT 0;
