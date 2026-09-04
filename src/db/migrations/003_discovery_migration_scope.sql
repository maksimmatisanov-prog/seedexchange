ALTER TABLE legacy_migration_runs
  ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'full'
  CHECK (scope IN ('discovery','full'));
