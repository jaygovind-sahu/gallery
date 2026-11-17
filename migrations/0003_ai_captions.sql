-- Milestone 8: saved captions per tone, subject, hashtags and the blind model comparison
-- (see docs/DESIGN.md, "AI suggestions"). Everything here is admin-only; the public site still reads
-- photos.caption, which holds a copy of whichever saved caption is shown.

CREATE TABLE photo_captions (
  photo_id    TEXT NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  tone        TEXT NOT NULL CHECK (tone IN ('field-notes','poetic','playful','own')),
  text        TEXT NOT NULL,
  edited      INTEGER NOT NULL DEFAULT 0,  -- 1 once the owner has typed in it; a re-run never overwrites those
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (photo_id, tone)
);

ALTER TABLE photos ADD COLUMN subject TEXT;       -- PRIVATE: "Great Blue Heron", typed by the owner or confirmed from an AI guess
ALTER TABLE photos ADD COLUMN hashtags TEXT;      -- PRIVATE: "#greatblueheron #birdphotography", for Instagram
ALTER TABLE photos ADD COLUMN caption_tone TEXT;  -- which photo_captions row photos.caption is a copy of; NULL = none shown

-- Captions written before this migration become the owner's own saved caption, still shown.
INSERT INTO photo_captions (photo_id, tone, text, edited)
  SELECT id, 'own', caption, 1 FROM photos WHERE caption IS NOT NULL AND trim(caption) <> '';
UPDATE photos SET caption_tone = 'own' WHERE caption IS NOT NULL AND trim(caption) <> '';

-- One row per blind comparison the owner settled: which model's set they chose over which.
CREATE TABLE ai_votes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  winner      TEXT NOT NULL,               -- "anthropic:claude-haiku-5-5"
  loser       TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
