-- +goose Up
-- +goose StatementBegin
-- Trusted recipients: no demo names baked into the column default or existing rows.
ALTER TABLE safety_policies ALTER COLUMN trusted_whitelist SET DEFAULT '[]'::jsonb;
UPDATE safety_policies
   SET trusted_whitelist = '[]'::jsonb
 WHERE trusted_whitelist::text LIKE '%Бабушка Нина%'
    OR trusted_whitelist::text LIKE '%Репетитор Анна%';

-- Card types no longer carry the old brand prefix.
UPDATE accounts SET card_type = REPLACE(card_type, 'ВТБ ', '') WHERE card_type LIKE 'ВТБ %';

-- Bank identifier is machine-readable again; the UI renders its own label for it.
UPDATE accounts SET bank_provider = 'familybank' WHERE bank_provider = 'vtb';

-- Sample family: drop the demo role labels from display names and move off the old mail domain.
UPDATE users SET name = 'Алексей Смирнов', email = 'alex@familybank.local'
 WHERE email = 'alex@vtb.family';
UPDATE users SET name = 'Артём Смирнов', email = 'artem@familybank.local'
 WHERE email = 'artem@vtb.family';
UPDATE users SET name = 'Нина Смирнова', email = 'nina@familybank.local'
 WHERE email = 'nina@vtb.family';

-- Repair sample balances that were drained by the old demo panel (only if negative).
UPDATE accounts SET balance = 164500.00 WHERE id = 1 AND balance < 0;
UPDATE accounts SET balance =   4850.00 WHERE id = 2 AND balance < 0;
UPDATE accounts SET balance =  28300.00 WHERE id = 3 AND balance < 0;

-- Learning quest 1: same lesson, no legal citations or brand mentions.
UPDATE quests SET
  title = 'Сомнительная подработка в мессенджере',
  description = 'Разбор схемы, в которой незнакомцы предлагают «принимать переводы» за вознаграждение',
  scenario = 'Вам пишет незнакомец: «Привет! Ищем людей для приёма оплат. Тебе приходит 25 000 ₽, оставляешь себе 2 500 ₽, остальное отправляешь дальше. Всё честно и без вложений!»',
  options = '["Отличный лёгкий заработок для студента", "Это участие в мошеннической схеме: счёт заблокируют, а данные попадут в базу, из-за которой другой банк тоже откажет в обслуживании", "Попрошу 5 000 рублей авансом на карту"]'::jsonb,
  explanation = 'Приём чужих средств и их дальнейшая пересылка — это участие в отмывании денег. Банк заблокирует счёт, а информация о вас попадёт в базу, из-за которой банки смогут отказать в обслуживании.'
WHERE id = 1;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
-- Only the column default is reverted: the cleaned display copy, quest text and
-- repaired balances are intentional product content and stay as they are.
ALTER TABLE safety_policies ALTER COLUMN trusted_whitelist SET DEFAULT '["+7 (903) 123-45-67", "Мама", "Бабушка Нина", "Школьная столовая", "Репетитор Анна"]'::jsonb;
-- +goose StatementEnd
