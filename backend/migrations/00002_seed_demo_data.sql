-- +goose Up
-- +goose StatementBegin
-- 1. Create Users (password is 'password123')
INSERT INTO users (id, email, name, phone, role, pass_hash, avatar, safety_score)
VALUES 
(1, 'alex@vtb.family', 'Алексей Смирнов (Отец)', '+7 (999) 111-22-33', 'parent', '$2a$10$nVvB/TaGWLTlzF1gYekRsOiMDSogzqDPJN.RiRwvZNcnEXj.Mo.tu', 'parent_male', 98),
(2, 'artem@vtb.family', 'Артём Смирнов (Сын, 16 лет)', '+7 (999) 222-33-44', 'teen', '$2a$10$nVvB/TaGWLTlzF1gYekRsOiMDSogzqDPJN.RiRwvZNcnEXj.Mo.tu', 'teen_male', 72),
(3, 'nina@vtb.family', 'Нина Ивановна (Бабушка)', '+7 (999) 333-44-55', 'senior', '$2a$10$nVvB/TaGWLTlzF1gYekRsOiMDSogzqDPJN.RiRwvZNcnEXj.Mo.tu', 'senior_female', 65)
ON CONFLICT (id) DO NOTHING;

-- 2. Create Family Group
INSERT INTO family_groups (id, name, owner_id)
VALUES (1, 'Семья Смирновых', 1)
ON CONFLICT (id) DO NOTHING;

-- 3. Add Members
INSERT INTO family_members (family_id, user_id, role, nickname)
VALUES 
(1, 1, 'parent', 'Папа'),
(1, 2, 'teen', 'Артём'),
(1, 3, 'senior', 'Бабушка Нина')
ON CONFLICT (family_id, user_id) DO NOTHING;

-- 4. Accounts & Cards
INSERT INTO accounts (id, user_id, bank_provider, account_number, card_number, card_type, balance, currency)
VALUES
(1, 1, 'vtb', '40817810500001234567', '*4812', 'ВТБ МИР Привилегия', 164500.00, 'RUB'),
(2, 2, 'vtb', '40817810800009876543', '*9124', 'ВТБ Юниор Digital', 4850.00, 'RUB'),
(3, 3, 'vtb', '40817810300005556677', '*3310', 'ВТБ Пенсионная МИР', 28300.00, 'RUB')
ON CONFLICT (id) DO NOTHING;

-- 5. Safety Policies
INSERT INTO safety_policies (user_id, max_instant_transfer, fast_food_limit_month, gaming_limit_month, require_co_signing, trusted_contacts_only)
VALUES 
(2, 1000.00, 3000.00, 1500.00, true, false),
(3, 5000.00, 10000.00, 0.00, true, true)
ON CONFLICT (user_id) DO NOTHING;

-- 6. Goals
INSERT INTO goals (id, user_id, title, target_amount, current_amount, boost_multiplier, sponsor_id, status)
VALUES 
(1, 2, 'Игровой руль и педали Logitech', 12000.00, 4000.00, 0.50, 1, 'active')
ON CONFLICT (id) DO NOTHING;

-- 7. Quests
INSERT INTO quests (id, title, description, category, reward_rub, safety_score_reward, scenario, options, correct_option, explanation)
VALUES 
(1, 'Анти-Дроп: Сомнительная подработка в Telegram', 'Разбор реальной схемы вовлечения молодежи в дропперство под видом криптообменника', 'anti_drop', 300.00, 15,
'Вам в Telegram пишет незнакомец: "Привет! Ищем людей для приёма оплат криптообменника на карты ВТБ. Тебе приходит 25 000 ₽, оставляешь себе 2 500 ₽, остальное шлешь по СБП. Всё честно и без вложений!"',
'["Отличный легкий заработок для студента", "Это уголовное дропперство. Карту заблокируют по 115-ФЗ, а ЦБ РФ внесет в черный список дропперов без права открыть счета", "Попрошу 5 000 рублей авансом на карту"]'::jsonb,
1,
'Внимание: приём чужих средств и их веерная пересылка — это соучастие в мошенничестве (дроппинг). С июля 2024 года закон 161-ФЗ и 115-ФЗ обязывают блокировать карты дропперов и закрывать им доступ ко всей финансовой системе РФ.'),

(2, 'Анти-Фишинг: Покупатель на Авито с курьером', 'Проверка на распознавание поддельных сайтов оплаты и кражи CVC-кода', 'anti_phishing', 200.00, 10,
'Вы продаете старые наушники на Авито за 3 500 ₽. Покупатель в WhatsApp пишет: "Я оплатил через безопасную сделку, перейдите по ссылке avito-safe-transfer.ru/p/38491 чтобы получить средства на карту".',
'["Перейти по ссылке, ввести номер карты и CVC код для получения денег", "Авито не переводит средства по внешним ссылкам. Это фишинговый клон, CVC код никогда не нужен для получения денег", "Отправить скриншот своего паспорта"]'::jsonb,
1,
'Никогда и ни при каких условиях нельзя вводить CVC-код и коды из СМС для "получения" денег. Зачисление денег на карту требует только ее номер или телефон СБП, а сделки на Авито закрываются строго внутри приложения.'),

(3, 'Умный бюджет: Правило 24 часов и импульсивные траты', 'Как уберечь накопления от внезапных игровых скидок и манипуляций', 'budget', 250.00, 10,
'В онлайн-игре началась срочная распродажа легендарного скина за 2 990 ₽ с таймером "Осталось 45 минут". При этом вы копите на игровой руль, и на карте ровно 4 850 ₽.',
'["Срочно купить скин, пока горит скидка — цель подождет", "Применить правило 24 часов: отложить решение на сутки. Если желание не пройдет, согласовать перераспределение бюджета с родителем", "Оформить займ у друзей"]'::jsonb,
1,
'Таймеры "осталось 30 минут" создаются маркетологами для отключения рационального мышления. Правило 24 часов сохраняет до 80% карманных денег и помогает достигать крупных финансовых целей.')
ON CONFLICT (id) DO NOTHING;

-- 8. Realistic Transactions (History)
INSERT INTO transactions (account_id, user_id, amount, currency, category, mcc, description, recipient_phone, recipient_name, status, risk_level, risk_reason, created_at)
VALUES 
(2, 2, 420.00, 'RUB', 'Фастфуд', '5814', 'Вкусно — и точка', '', '', 'completed', 'low', '', NOW() - INTERVAL '1 day'),
(2, 2, 899.00, 'RUB', 'Развлечения и игры', '7994', 'Steam Games (Digital)', '', '', 'completed', 'low', '', NOW() - INTERVAL '2 days'),
(2, 2, 260.00, 'RUB', 'Транспорт', '4121', 'Яндекс Go Такси', '', '', 'completed', 'low', '', NOW() - INTERVAL '3 days'),
(2, 2, 340.00, 'RUB', 'Супермаркеты', '5411', 'Пятёрочка Экспресс', '', '', 'completed', 'low', '', NOW() - INTERVAL '4 days'),
(2, 2, 650.00, 'RUB', 'Фастфуд', '5814', 'Додо Пицца', '', '', 'completed', 'low', '', NOW() - INTERVAL '6 days'),
(2, 2, 499.00, 'RUB', 'Развлечения и игры', '7994', 'Discord Nitro Подписка', '', '', 'completed', 'low', '', NOW() - INTERVAL '7 days'),
(2, 2, 1890.00, 'RUB', 'Электроника', '5732', 'DNS Shop: Мышь игровая', '', '', 'completed', 'low', '', NOW() - INTERVAL '10 days'),
(2, 2, 320.00, 'RUB', 'Транспорт', '4111', 'Пополнение карты Тройка', '', '', 'completed', 'low', '', NOW() - INTERVAL '12 days'),

(1, 1, 4820.00, 'RUB', 'Супермаркеты', '5411', 'Перекрёсток Супермаркет', '', '', 'completed', 'low', '', NOW() - INTERVAL '1 day'),
(1, 1, 3200.00, 'RUB', 'Авто и АЗС', '5541', 'Лукойл АЗС №14', '', '', 'completed', 'low', '', NOW() - INTERVAL '2 days'),
(1, 1, 7450.00, 'RUB', 'Коммунальные услуги', '4900', 'Мосэнергосбыт ЖКХ', '', '', 'completed', 'low', '', NOW() - INTERVAL '5 days'),
(1, 1, 6100.00, 'RUB', 'Маркетплейсы', '5399', 'Озон Маркетплейс', '', '', 'completed', 'low', '', NOW() - INTERVAL '8 days'),
(1, 1, 3900.00, 'RUB', 'Рестораны', '5812', 'Ресторан Токио Сити', '', '', 'completed', 'low', '', NOW() - INTERVAL '9 days');

-- 9. A Pending Co-Sign Request for Demonstration
INSERT INTO transactions (id, account_id, user_id, amount, currency, category, mcc, description, recipient_phone, recipient_name, status, risk_level, risk_reason, created_at)
VALUES 
(999, 2, 2, 4500.00, 'RUB', 'Переводы по СБП', '6538', 'Перевод по СБП (Подозрительная операция)', '+7 (903) 777-66-55', 'Анонимный получатель', 'pending_approval', 'high', 'Сумма 4 500 ₽ превышает порог доверия (1 000 ₽) для подростка. Контакт не входит в семейный список.', NOW() - INTERVAL '10 minutes')
ON CONFLICT (id) DO NOTHING;

INSERT INTO co_sign_requests (id, transaction_id, user_id, guardian_id, amount, recipient, risk_reason, status, created_at)
VALUES 
(1, 999, 2, 1, 4500.00, '+7 (903) 777-66-55 (Анонимный получатель)', 'Сумма 4 500 ₽ превышает лимит доверия (1 000 ₽). Признак риска дроппинга или скама.', 'pending', NOW() - INTERVAL '10 minutes')
ON CONFLICT (id) DO NOTHING;

-- Reset sequence counters
SELECT setval('users_id_seq', (SELECT MAX(id) FROM users));
SELECT setval('family_groups_id_seq', (SELECT MAX(id) FROM family_groups));
SELECT setval('accounts_id_seq', (SELECT MAX(id) FROM accounts));
SELECT setval('goals_id_seq', (SELECT MAX(id) FROM goals));
SELECT setval('quests_id_seq', (SELECT MAX(id) FROM quests));
SELECT setval('transactions_id_seq', (SELECT MAX(id) FROM transactions));
SELECT setval('co_sign_requests_id_seq', (SELECT MAX(id) FROM co_sign_requests));
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DELETE FROM co_sign_requests;
DELETE FROM transactions;
DELETE FROM user_quest_completions;
DELETE FROM quests;
DELETE FROM goals;
DELETE FROM safety_policies;
DELETE FROM accounts;
DELETE FROM family_members;
DELETE FROM family_groups;
DELETE FROM users;
-- +goose StatementEnd
