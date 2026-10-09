-- +goose Up
-- +goose StatementBegin
-- Split the single role enum into two independent axes:
--   * users.role / family_members.role  -> protection profile, derived from age
--   * family_members.authority          -> what the member may do (set by owner)
-- and turn joining into an explicit request that the owner confirms.

-- 1. Birth date becomes the single source of the protection profile.
ALTER TABLE users ADD COLUMN IF NOT EXISTS birth_date DATE;

-- Backfill from the previous role so existing members keep the same supervision.
UPDATE users SET birth_date = DATE '1985-01-01' WHERE birth_date IS NULL AND role = 'parent';
UPDATE users SET birth_date = DATE '2009-01-01' WHERE birth_date IS NULL AND role = 'teen';
UPDATE users SET birth_date = DATE '1955-01-01' WHERE birth_date IS NULL AND role = 'senior';
UPDATE users SET birth_date = DATE '1985-01-01' WHERE birth_date IS NULL;

ALTER TABLE users ALTER COLUMN birth_date SET NOT NULL;

-- 2. Authority is a property of membership, not of the person.
--    Derived BEFORE the role rewrite below, so 'parent' still means "adult" here.
ALTER TABLE family_members ADD COLUMN IF NOT EXISTS authority VARCHAR(20) NOT NULL DEFAULT 'member';

UPDATE family_members fm
   SET authority = 'owner'
  FROM family_groups f
 WHERE f.id = fm.family_id AND f.owner_id = fm.user_id;

UPDATE family_members
   SET authority = 'guardian'
 WHERE authority = 'member' AND role = 'parent';

-- 3. Membership may now be provisional until the owner confirms it.
ALTER TABLE family_members ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active';
ALTER TABLE family_members ADD COLUMN IF NOT EXISTS requested_at TIMESTAMPTZ;

-- Everyone who was already in a family stays active: nobody is evicted retroactively.
UPDATE family_members SET status = 'active' WHERE status IS NULL;

-- 4. 'parent' was authority, not a protection profile. Those users are adults,
--    so their protection profile becomes 'standard'.
UPDATE users SET role = 'standard' WHERE role = 'parent';
UPDATE family_members SET role = 'standard' WHERE role = 'parent';

-- 5. The owner is never under supervision: there is nobody left to confirm
--    the owner's operations. This also covers an older family head.
UPDATE users u SET role = 'standard' FROM family_groups f WHERE f.owner_id = u.id;

-- 6. Domain constraints.
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('teen', 'standard', 'senior'));
ALTER TABLE family_members ADD CONSTRAINT family_members_role_check
  CHECK (role IN ('teen', 'standard', 'senior'));
ALTER TABLE family_members ADD CONSTRAINT family_members_authority_check
  CHECK (authority IN ('owner', 'guardian', 'member'));
ALTER TABLE family_members ADD CONSTRAINT family_members_status_check
  CHECK (status IN ('pending', 'active'));

CREATE INDEX IF NOT EXISTS family_members_pending_idx
  ON family_members (family_id) WHERE status = 'pending';
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
-- Note: the role/authority split is not reversed destructively — rows are only
-- mapped back to the closest representable old value.
DROP INDEX IF EXISTS family_members_pending_idx;

ALTER TABLE family_members DROP CONSTRAINT IF EXISTS family_members_status_check;
ALTER TABLE family_members DROP CONSTRAINT IF EXISTS family_members_authority_check;
ALTER TABLE family_members DROP CONSTRAINT IF EXISTS family_members_role_check;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;

UPDATE users SET role = 'parent' WHERE role = 'standard';
UPDATE family_members SET role = 'parent' WHERE role = 'standard' AND authority IN ('owner', 'guardian');

ALTER TABLE family_members DROP COLUMN IF EXISTS requested_at;
ALTER TABLE family_members DROP COLUMN IF EXISTS status;
ALTER TABLE family_members DROP COLUMN IF EXISTS authority;
ALTER TABLE users DROP COLUMN IF EXISTS birth_date;
-- +goose StatementEnd
