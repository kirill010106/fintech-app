-- +goose Up
-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS users (
    id BIGSERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(50) NOT NULL,
    role VARCHAR(50) NOT NULL, -- parent, teen, senior
    pass_hash TEXT NOT NULL,
    avatar VARCHAR(255) DEFAULT '',
    safety_score INT DEFAULT 70,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS family_groups (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    owner_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS family_members (
    id BIGSERIAL PRIMARY KEY,
    family_id BIGINT REFERENCES family_groups(id) ON DELETE CASCADE,
    user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(50) NOT NULL,
    nickname VARCHAR(100) DEFAULT '',
    UNIQUE(family_id, user_id)
);

CREATE TABLE IF NOT EXISTS accounts (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
    bank_provider VARCHAR(50) DEFAULT 'vtb',
    account_number VARCHAR(50) NOT NULL,
    card_number VARCHAR(30) NOT NULL,
    card_type VARCHAR(100) NOT NULL,
    balance NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
    currency VARCHAR(10) DEFAULT 'RUB',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS transactions (
    id BIGSERIAL PRIMARY KEY,
    account_id BIGINT REFERENCES accounts(id) ON DELETE CASCADE,
    user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
    amount NUMERIC(15, 2) NOT NULL,
    currency VARCHAR(10) DEFAULT 'RUB',
    category VARCHAR(100) NOT NULL,
    mcc VARCHAR(10) DEFAULT '0000',
    description VARCHAR(255) NOT NULL,
    recipient_phone VARCHAR(50) DEFAULT '',
    recipient_name VARCHAR(255) DEFAULT '',
    status VARCHAR(50) NOT NULL DEFAULT 'completed', -- completed, pending_approval, rejected, blocked
    risk_level VARCHAR(50) NOT NULL DEFAULT 'low', -- low, medium, high, critical
    risk_reason TEXT DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS co_sign_requests (
    id BIGSERIAL PRIMARY KEY,
    transaction_id BIGINT REFERENCES transactions(id) ON DELETE CASCADE,
    user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
    guardian_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
    amount NUMERIC(15, 2) NOT NULL,
    recipient VARCHAR(255) NOT NULL,
    risk_reason TEXT NOT NULL,
    status VARCHAR(50) DEFAULT 'pending', -- pending, approved, rejected
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    decided_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS safety_policies (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    max_instant_transfer NUMERIC(15, 2) DEFAULT 1000.00,
    fast_food_limit_month NUMERIC(15, 2) DEFAULT 3000.00,
    gaming_limit_month NUMERIC(15, 2) DEFAULT 1500.00,
    require_co_signing BOOLEAN DEFAULT TRUE,
    trusted_contacts_only BOOLEAN DEFAULT FALSE,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS goals (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    target_amount NUMERIC(15, 2) NOT NULL,
    current_amount NUMERIC(15, 2) DEFAULT 0.00,
    boost_multiplier NUMERIC(5, 2) DEFAULT 0.50,
    sponsor_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    status VARCHAR(50) DEFAULT 'active',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS quests (
    id BIGSERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    category VARCHAR(50) NOT NULL,
    reward_rub NUMERIC(15, 2) DEFAULT 0.00,
    safety_score_reward INT DEFAULT 10,
    scenario TEXT NOT NULL,
    options JSONB NOT NULL,
    correct_option INT NOT NULL,
    explanation TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_quest_completions (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
    quest_id BIGINT REFERENCES quests(id) ON DELETE CASCADE,
    completed_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, quest_id)
);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS user_quest_completions CASCADE;
DROP TABLE IF EXISTS quests CASCADE;
DROP TABLE IF EXISTS goals CASCADE;
DROP TABLE IF EXISTS safety_policies CASCADE;
DROP TABLE IF EXISTS co_sign_requests CASCADE;
DROP TABLE IF EXISTS transactions CASCADE;
DROP TABLE IF EXISTS accounts CASCADE;
DROP TABLE IF EXISTS family_members CASCADE;
DROP TABLE IF EXISTS family_groups CASCADE;
DROP TABLE IF EXISTS users CASCADE;
-- +goose StatementEnd
