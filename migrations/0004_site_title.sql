-- The site name changed to "Jay’s Gallery" (README.md, Decisions). Only the seeded title is replaced,
-- so a title set by hand stays as it is.

UPDATE settings SET value = 'Jay’s Gallery' WHERE key = 'site_title' AND value = 'Jaygovind Sahu — Gallery';
