-- Fresh CMS only. No imported data and no administrator is granted by default.
PRAGMA foreign_keys = ON;

CREATE TABLE admins (
  clerk_user_id TEXT PRIMARY KEY NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE site_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  data TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(data) AND json_type(data) = 'object'),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE products (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'Books' CHECK (category IN ('Books','Printed Notes','Test Series','Combo')),
  description TEXT NOT NULL DEFAULT '',
  price REAL NOT NULL CHECK (price >= 0),
  mrp REAL CHECK (mrp IS NULL OR mrp >= 0),
  language TEXT NOT NULL DEFAULT 'Bengali' CHECK (language IN ('Bengali','English','Bengali + English')),
  image TEXT NOT NULL DEFAULT '',
  in_stock INTEGER NOT NULL DEFAULT 0 CHECK (in_stock IN (0,1)),
  is_new INTEGER NOT NULL DEFAULT 0 CHECK (is_new IN (0,1)),
  published INTEGER NOT NULL DEFAULT 0 CHECK (published IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE blog_posts (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  excerpt TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  cover TEXT,
  date TEXT NOT NULL DEFAULT (date('now')),
  read_mins INTEGER NOT NULL DEFAULT 0 CHECK (read_mins >= 0),
  tags TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tags) AND json_type(tags) = 'array'),
  published INTEGER NOT NULL DEFAULT 0 CHECK (published IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE pyqs (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL,
  year INTEGER NOT NULL CHECK (year BETWEEN 1900 AND 2200),
  description TEXT NOT NULL DEFAULT '',
  language TEXT NOT NULL DEFAULT 'Bengali' CHECK (language IN ('Bengali','English','Bengali + English')),
  file_size TEXT NOT NULL DEFAULT '',
  paper_url TEXT NOT NULL,
  answer_key_url TEXT,
  is_new INTEGER NOT NULL DEFAULT 0 CHECK (is_new IN (0,1)),
  published INTEGER NOT NULL DEFAULT 0 CHECK (published IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE gallery_items (
  id TEXT PRIMARY KEY NOT NULL,
  src TEXT NOT NULL,
  alt TEXT NOT NULL,
  caption TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'Classes' CHECK (category IN ('Classes','Toppers','Events')),
  aspect TEXT NOT NULL DEFAULT 'square' CHECK (aspect IN ('square','tall','wide')),
  published INTEGER NOT NULL DEFAULT 0 CHECK (published IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE success_photos (
  id TEXT PRIMARY KEY NOT NULL,
  src TEXT NOT NULL,
  alt TEXT NOT NULL DEFAULT 'Student success photo',
  aspect TEXT NOT NULL DEFAULT 'tall' CHECK (aspect IN ('square','tall','wide')),
  published INTEGER NOT NULL DEFAULT 0 CHECK (published IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE current_affairs_monthly (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL,
  month TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  language TEXT NOT NULL DEFAULT 'Bengali' CHECK (language IN ('Bengali','English','Bengali + English')),
  file_size TEXT NOT NULL DEFAULT '',
  file_url TEXT NOT NULL,
  is_new INTEGER NOT NULL DEFAULT 0 CHECK (is_new IN (0,1)),
  published INTEGER NOT NULL DEFAULT 0 CHECK (published IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE current_affairs_daily (
  id TEXT PRIMARY KEY NOT NULL,
  headline TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL DEFAULT (date('now')),
  tag TEXT NOT NULL DEFAULT 'Health' CHECK (tag IN ('Health','National','West Bengal','Science','Sports','Awards')),
  published INTEGER NOT NULL DEFAULT 0 CHECK (published IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE resources (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'Syllabus' CHECK (category IN ('Syllabus','Papers','Notes','Mocks','Guides')),
  description TEXT NOT NULL DEFAULT '',
  language TEXT NOT NULL DEFAULT 'Bengali' CHECK (language IN ('Bengali','English','Bengali + English')),
  file_size TEXT NOT NULL DEFAULT '',
  file_url TEXT NOT NULL,
  is_new INTEGER NOT NULL DEFAULT 0 CHECK (is_new IN (0,1)),
  published INTEGER NOT NULL DEFAULT 0 CHECK (published IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE syllabus_subjects (
  id TEXT PRIMARY KEY NOT NULL,
  sid TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  blurb TEXT NOT NULL DEFAULT '',
  questions INTEGER NOT NULL DEFAULT 0 CHECK (questions >= 0),
  file_url TEXT NOT NULL DEFAULT '',
  file_name TEXT NOT NULL DEFAULT '',
  published INTEGER NOT NULL DEFAULT 0 CHECK (published IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE syllabus_downloads (
  id TEXT PRIMARY KEY NOT NULL,
  label TEXT NOT NULL,
  caption TEXT NOT NULL DEFAULT '',
  file_url TEXT NOT NULL,
  file_name TEXT NOT NULL DEFAULT '',
  published INTEGER NOT NULL DEFAULT 0 CHECK (published IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE norcet_resources (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'Notes' CHECK (category IN ('Syllabus','Previous Year Papers','Notes','Mock Tests','Guides')),
  stage TEXT NOT NULL DEFAULT 'Both stages' CHECK (stage IN ('Both stages','Stage I','Stage II')),
  subject TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  language TEXT NOT NULL DEFAULT 'English' CHECK (language IN ('English','Hindi','English + Hindi','Bengali + English')),
  file_url TEXT NOT NULL,
  file_size TEXT NOT NULL DEFAULT '',
  is_new INTEGER NOT NULL DEFAULT 0 CHECK (is_new IN (0,1)),
  published INTEGER NOT NULL DEFAULT 0 CHECK (published IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE batches (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  start_date TEXT NOT NULL DEFAULT '',
  mode TEXT NOT NULL DEFAULT 'Online' CHECK (mode IN ('Online','Offline','Hybrid')),
  timing TEXT NOT NULL DEFAULT '',
  seats_filled INTEGER NOT NULL DEFAULT 0 CHECK (seats_filled >= 0),
  seats_total INTEGER NOT NULL DEFAULT 0 CHECK (seats_total >= 0 AND seats_total >= seats_filled),
  published INTEGER NOT NULL DEFAULT 0 CHECK (published IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE assets (
  id TEXT PRIMARY KEY NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  staging_key TEXT NOT NULL UNIQUE,
  public_url TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL CHECK (size > 0),
  owner_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','ready','deleting')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE asset_references (
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
  collection_slug TEXT NOT NULL,
  row_id TEXT NOT NULL,
  field_name TEXT NOT NULL,
  PRIMARY KEY (collection_slug, row_id, field_name)
);

-- Linking and deletion claims are serialized by D1. A link cannot attach to
-- an asset after cleanup has claimed it; referenced assets cannot be claimed.
CREATE TRIGGER asset_reference_ready BEFORE INSERT ON asset_references
BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM assets WHERE id = NEW.asset_id AND status = 'ready')
    THEN RAISE(ABORT, 'Asset must be ready') END;
END;
CREATE TRIGGER asset_reference_update_ready BEFORE UPDATE ON asset_references
BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM assets WHERE id = NEW.asset_id AND status = 'ready')
    THEN RAISE(ABORT, 'Asset must be ready') END;
END;
CREATE TRIGGER asset_delete_unreferenced BEFORE UPDATE OF status ON assets
WHEN NEW.status != 'ready' AND EXISTS (SELECT 1 FROM asset_references WHERE asset_id = OLD.id)
BEGIN
  SELECT RAISE(ABORT, 'Asset is still referenced');
END;

CREATE INDEX assets_cleanup_idx ON assets(status, created_at);
CREATE INDEX assets_owner_created_idx ON assets(owner_id, created_at);
CREATE INDEX asset_references_asset_idx ON asset_references(asset_id);
CREATE INDEX products_published_created_idx ON products(published, created_at DESC);
CREATE INDEX blog_posts_published_date_idx ON blog_posts(published, date DESC);
CREATE INDEX pyqs_published_year_idx ON pyqs(published, year DESC);
CREATE INDEX gallery_items_published_created_idx ON gallery_items(published, created_at DESC);
CREATE INDEX success_photos_published_created_idx ON success_photos(published, created_at DESC);
CREATE INDEX current_affairs_monthly_published_created_idx ON current_affairs_monthly(published, created_at DESC);
CREATE INDEX current_affairs_daily_published_date_idx ON current_affairs_daily(published, date DESC);
CREATE INDEX resources_published_created_idx ON resources(published, created_at DESC);
CREATE INDEX syllabus_subjects_published_questions_idx ON syllabus_subjects(published, questions DESC);
CREATE INDEX syllabus_downloads_published_created_idx ON syllabus_downloads(published, created_at);
CREATE INDEX norcet_resources_published_created_idx ON norcet_resources(published, created_at DESC);
CREATE INDEX batches_published_created_idx ON batches(published, created_at DESC);
