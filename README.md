# Семейный банк

Приложение для семейного банкинга: у каждого члена семьи отдельный личный кабинет со своими
картами и лимитами, родитель видит общую картину и подтверждает спорные операции, а семейные
цели можно пополнять вместе.

## Что умеет

**Аккаунты и доступ**
- Регистрация с ролью: родитель, подросток, старшее поколение.
- Родитель создаёт семейную группу и получает код приглашения; остальные присоединяются по этому коду.
- Вход по почте и паролю (bcrypt), JWT-сессия, восстановление сессии после перезагрузки страницы.
- Профиль: смена имени и телефона, смена пароля, ротация кода приглашения.

**Банковские операции**
- Список счетов и карт с балансами, история операций, аналитика по категориям.
- Переводы по номеру телефона с проверкой получателя.
- Если операция выглядит подозрительно или превышает лимит доверия — она приостанавливается
  и уходит на подтверждение родителю (механика со-подписания).
- Родитель подтверждает или отклоняет запрос; решение мгновенно применяется.

**Дополнительно**
- Цели-копилки: подросток копит, родитель может дополнить накопления.
- Обучающие квесты по финансовой грамотности с начислением баллов доверия и бонуса на карту.
- Правила безопасности для каждого участника: лимиты трат, доверенные получатели, проверка звонков.
- Тёмная и светлая темы интерфейса.
- Обновления в реальном времени через SSE.

## Стек

**Backend** — Go 1.24+
- `chi/v5`, `slog` со сквозным трейсингом (`op`, `request_id`, `sl.Err`)
- `validator/v10` для валидации, единый конверт ответов `resp.Response`
- PostgreSQL 16 + `pgx/v5`, миграции `goose` из `embed.FS`
- JWT (`golang-jwt/jwt/v5`), bcrypt для паролей
- Эвристический скоринг операций (модуль антифрода)

**Frontend** — React 19 + TypeScript + Vite
- `antd` v6 с переключаемой тёмной/светлой темой
- Тема интерфейса построена на CSS-переменных (`src/index.css`), поэтому обе темы используют одну вёрстку
- Навигация зависит от роли: каждый видит только свои разделы

## Запуск

### Docker Compose

```bash
cd fintech-app
docker compose up --build -d
```

- Frontend: http://localhost:3000
- Backend API: http://localhost:8080/api/v1

### Локально

1. PostgreSQL:
   ```bash
   docker run -d --name vtb_family_postgres -p 5432:5432 \
     -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=vtb_family \
     postgres:16-alpine
   ```
2. Backend (миграции применяются автоматически при старте):
   ```bash
   cd backend
   go run ./cmd/main.go
   ```
3. Frontend:
   ```bash
   cd frontend
   npm install
   npm run dev
   ```
   Откройте http://localhost:5173

## Переменные окружения

Backend (`backend/.env`):

| Переменная | Назначение | По умолчанию |
|---|---|---|
| `DATABASE_URL` | строка подключения к PostgreSQL | `postgres://postgres:postgres@localhost:5432/vtb_family?sslmode=disable` |
| `APP_SECRET` | секрет для подписи JWT | — задайте свой |
| `HTTP_ADDRESS` | адрес HTTP-сервера | `:8080` |
| `ACCESS_TOKEN_TTL` | время жизни токена | `24h` |

Frontend: `VITE_API_URL` — базовый адрес API, по умолчанию `http://localhost:8080/api/v1`.

## API

Публичные:

| Метод | Путь | Описание |
|---|---|---|
| `POST` | `/api/v1/auth/register` | регистрация с датой рождения; создаёт семью или подаёт заявку по `invite_code` |
| `POST` | `/api/v1/auth/login` | вход по почте и паролю |

Требуют заголовок `Authorization: Bearer <token>`:

| Метод | Путь | Описание |
|---|---|---|
| `POST` | `/api/v1/auth/logout` | выход |
| `GET` | `/api/v1/auth/me` | текущий пользователь, счета, семья |
| `PATCH` | `/api/v1/auth/profile` | имя и телефон (дату рождения меняет владелец) |
| `POST` | `/api/v1/auth/password` | смена пароля |
| `POST` | `/api/v1/family/join` | подать заявку на вступление по коду |
| `GET` | `/api/v1/family/invite` | код приглашения (только владелец) |
| `POST` | `/api/v1/family/invite/regenerate` | выпустить новый код (только владелец) |
| `GET` | `/api/v1/family/dashboard` | сводка по семье |
| `GET` | `/api/v1/family/members` | участники семьи (владелец и опекун) |
| `GET` | `/api/v1/family/requests` | заявки на вступление (только владелец) |
| `POST` | `/api/v1/family/requests/confirm` | принять заявку и выдать права |
| `DELETE` | `/api/v1/family/requests/{userId}` | отклонить заявку |
| `PUT` | `/api/v1/family/members/{userId}/authority` | сменить права участника |
| `PUT` | `/api/v1/family/members/{userId}/birth-date` | поправить дату рождения |
| `DELETE` | `/api/v1/family/members/{userId}` | исключить участника |
| `GET`/`PUT` | `/api/v1/family/policies/{userId}` | правила безопасности участника |
| `POST` | `/api/v1/transfers` | перевод |
| `GET` | `/api/v1/transfers/history` | история операций |
| `GET` | `/api/v1/guardian/pending` | запросы на подтверждение |
| `POST` | `/api/v1/guardian/decide` | подтвердить или отклонить |
| `GET` | `/api/v1/quests` | обучающие квесты |
| `POST` | `/api/v1/quests/{id}/answer` | ответ на квест |
| `GET`/`POST` | `/api/v1/goals` | цели-копилки |
| `POST` | `/api/v1/goals/{id}/topup` | пополнить цель |
| `GET` | `/api/v1/events/stream` | поток событий (SSE) |

## Роли и права

Две независимые оси. Первая это **права** (`authority`): `owner` управляет семьёй,
`guardian` подтверждает операции подопечных, `member` видит только свои счета.
Вторая это **профиль защиты** (`profile`): `teen`, `standard`, `senior`. Профиль
не выбирается вручную, он выводится из даты рождения (порог 18 и 65 лет). Владелец
семьи всегда без защитных мер, независимо от возраста.

Права выдаёт только владелец. Вступление по коду приглашения это **заявка**:
человек регистрируется по коду и ждёт подтверждения, после чего владелец задаёт
права и при необходимости поправляет дату рождения. Дата рождения меняется
владельцем, а не самим участником (`PATCH /auth/profile` возвращает 400).

## Проверка

Скрипты проверки лежат в `scripts/` и работают против запущенного стенда
(Windows PowerShell 5.1 и PowerShell 7, файлы должны оставаться в UTF-8 с BOM).

```bash
# 100+ проверок: регистрация с датой рождения, вход, подтверждение заявок,
# права и профиль, награды за квесты, со-подписание, изоляция семей
powershell -ExecutionPolicy Bypass -File scripts/e2e-auth.ps1 -Base http://localhost:8080/api/v1

# без следов старого бренда и ссылок на законы
powershell -ExecutionPolicy Bypass -File scripts/verify-copy-cleanup.ps1 -Base http://localhost:8080/api/v1

# статический аудит дизайн-системы (тире, эмодзи, радиусы, цвета, состояния)
powershell -ExecutionPolicy Bypass -File scripts/verify-design.ps1

# закрытые дыры доступа: эскалация прав и чужие политики
powershell -ExecutionPolicy Bypass -File scripts/probe-role-authz.ps1 -Base http://localhost:8080/api/v1
powershell -ExecutionPolicy Bypass -File scripts/probe-escalation.ps1 -Base http://localhost:8080/api/v1
```

Сборка и статические проверки:

```bash
cd backend  && go build ./... && go vet ./... && go test ./...
cd frontend && npm run build && npm run lint
```

## Структура

```
fintech-app/
├── backend/
│   ├── cmd/main.go                        точка входа, миграции, HTTP-сервер
│   ├── migrations/                         SQL-миграции goose
│   └── internal/
│       ├── config/                         конфигурация из окружения
│       ├── domain/                         модели предметной области
│       ├── http-server/
│       │   ├── handlers/                   auth, family, transfers, guardian, quests, goals, events
│       │   ├── middleware/                 аутентификация, логирование
│       │   └── router/                     маршруты
│       ├── lib/                            JWT, ответы API, логирование
│       ├── services/                       антифрод, переводы, брокер событий
│       └── storage/postgres/               доступ к данным
└── frontend/
    └── src/
        ├── auth/                           AuthContext — сессия, вход, выход
        ├── theme/                          переключение тёмной и светлой темы
        ├── pages/                          экран входа/регистрации, профиль
        ├── components/layout/              шапка, сайдбар, навигация по ролям
        ├── components/tabs/                разделы кабинета
        └── api.ts                          HTTP-клиент
```
