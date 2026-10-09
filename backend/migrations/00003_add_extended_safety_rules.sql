-- +goose Up
-- +goose StatementBegin
ALTER TABLE safety_policies 
ADD COLUMN IF NOT EXISTS night_lockdown BOOLEAN DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS anti_dropper_shield BOOLEAN DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS parent_match_percent INT DEFAULT 50,
ADD COLUMN IF NOT EXISTS trusted_whitelist JSONB DEFAULT '["+7 (903) 123-45-67", "Мама", "Бабушка Нина", "Школьная столовая", "Репетитор Анна"]'::jsonb;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE safety_policies 
DROP COLUMN IF EXISTS night_lockdown,
DROP COLUMN IF EXISTS anti_dropper_shield,
DROP COLUMN IF EXISTS parent_match_percent,
DROP COLUMN IF EXISTS trusted_whitelist;
-- +goose StatementEnd
