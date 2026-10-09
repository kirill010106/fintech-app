-- +goose Up
-- +goose StatementBegin
ALTER TABLE family_groups ADD COLUMN IF NOT EXISTS invite_code VARCHAR(12);
UPDATE family_groups SET invite_code = 'SMIRNOV1' WHERE invite_code IS NULL AND id = 1;
UPDATE family_groups SET invite_code = 'FAM' || LPAD(id::text, 5, '0') WHERE invite_code IS NULL;
ALTER TABLE family_groups ALTER COLUMN invite_code SET NOT NULL;
ALTER TABLE family_groups ADD CONSTRAINT family_groups_invite_code_key UNIQUE (invite_code);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE family_groups DROP CONSTRAINT IF EXISTS family_groups_invite_code_key;
ALTER TABLE family_groups DROP COLUMN IF EXISTS invite_code;
-- +goose StatementEnd
