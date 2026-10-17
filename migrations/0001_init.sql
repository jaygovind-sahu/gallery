-- Gallery schema (see docs/DESIGN.md, "Data model").

CREATE TABLE locations (
  id          TEXT PRIMARY KEY,            -- ULID
  slug        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,               -- "Bombay Hook NWR"
  region      TEXT,                        -- "Delaware"
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE photos (
  id                TEXT PRIMARY KEY,      -- ULID, also used in public URLs
  status            TEXT NOT NULL DEFAULT 'uploading' CHECK (status IN ('uploading','ready')),
  published         INTEGER NOT NULL DEFAULT 0,
  r2_key            TEXT NOT NULL,         -- originals/<id>/v<version>.<ext>
  version           INTEGER NOT NULL DEFAULT 1, -- bumped on replace; part of image URLs (cache bust)
  original_filename TEXT,
  mime              TEXT NOT NULL,
  bytes             INTEGER,
  width             INTEGER NOT NULL,      -- display orientation, after EXIF rotation
  height            INTEGER NOT NULL,
  placeholder       TEXT,                  -- ThumbHash, base64
  title             TEXT,
  caption           TEXT,
  taken_at          TEXT,                  -- EXIF DateTimeOriginal as ISO 8601 local time
  location_id       TEXT REFERENCES locations(id) ON DELETE SET NULL,
  camera            TEXT,                  -- "Nikon Z50II"
  lens              TEXT,
  focal_length_mm   REAL,
  aperture          REAL,                  -- 6.3
  shutter_s         REAL,                  -- 0.0005 -> shown as 1/2000 s
  iso               INTEGER,
  exposure_comp     REAL,
  gps_lat           REAL,                  -- PRIVATE: never returned by public pages
  gps_lng           REAL,
  watermark         INTEGER NOT NULL DEFAULT 1,
  sort_order        REAL,                  -- order in the "All" view
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX photos_published_taken ON photos(published, taken_at DESC);
CREATE INDEX photos_location ON photos(location_id);

CREATE TABLE categories (
  id              TEXT PRIMARY KEY,
  slug            TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  description     TEXT,
  cover_photo_id  TEXT REFERENCES photos(id) ON DELETE SET NULL,
  default_layout  TEXT NOT NULL DEFAULT 'rows' CHECK (default_layout IN ('rows','masonry','grid')),
  position        REAL NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE photo_categories (
  photo_id     TEXT NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  category_id  TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  position     REAL NOT NULL,              -- manual order within the category
  PRIMARY KEY (photo_id, category_id)
);
CREATE INDEX photo_categories_order ON photo_categories(category_id, position);

CREATE TABLE settings (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);
