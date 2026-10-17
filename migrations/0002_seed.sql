-- Initial categories, locations and settings (see docs/DESIGN.md, "Seeds").

INSERT INTO categories (id, slug, name, default_layout, position) VALUES
  ('01M53JH10086R420JC0GP7PP0A', 'birds',     'Birds',     'rows', 1),
  ('01M53JH101GBT8R4DRSB8RYHZR', 'macro',     'Macro',     'rows', 2),
  ('01M53JH102RWWD78905VKKK9GX', 'landscape', 'Landscape', 'rows', 3),
  ('01M53JH103Y7NJSJJQWP3CPXJV', 'astro',     'Astro',     'rows', 4),
  ('01M53JH104S0TV8C9VBY57JHF7', 'family',    'Family',    'rows', 5);

INSERT INTO locations (id, slug, name, region) VALUES
  ('01M53JH105VX402YCZ9B9CVJ59', 'bombay-hook-nwr',        'Bombay Hook NWR',        'Delaware'),
  ('01M53JH106D6B49CG33N0NQ49V', 'marsh-creek-state-park', 'Marsh Creek State Park', 'Pennsylvania'),
  ('01M53JH10785ST08VZPDFBQQ40', 'struble-trail',          'Struble Trail',          'Pennsylvania'),
  ('01M53JH108E0ZC9FTB4CYK5QDZ', 'stroud-preserve',        'Stroud Preserve',        'Pennsylvania'),
  ('01M53JH109A85R0K8D3XSB833C', 'cheslen-preserve',       'ChesLen Preserve',       'Pennsylvania'),
  ('01M53JH10ABHH14N19BKB7G84E', 'hibernia-county-park',   'Hibernia County Park',   'Pennsylvania');

INSERT INTO settings (key, value) VALUES
  ('watermark_text', '© Jaygovind Sahu'),
  ('site_title',     'Jaygovind Sahu — Gallery'),
  ('default_layout', 'rows');
