# orders-aggregator

Сервис забирает заказы интернет-магазина из внешней системы (API поддерживает другая команда),
принимает их обновления через вебхуки и считает статистику по клиентам.

## Стек

Node 20.11+, TypeScript, Fastify, PostgreSQL (`pg`), Zod, Vitest.

## Запуск

Образ внешнего API лежит рядом с этой папкой — загрузите тот, что под вашу архитектуру (`uname -m`):

```bash
docker load -i ../orders-mock-arm64.tar.gz   # arm64 / aarch64 (Mac на Apple Silicon)
docker load -i ../orders-mock-amd64.tar.gz   # x86_64
```

```bash
cp .env.example .env
docker compose up -d --wait # ждём, пока PostgreSQL будет готов
npm ci
npm run migrate
npm run dev                 # http://localhost:3000
```

Команды запуска, миграций и тестов сами читают `.env`. При запуске сервера миграции тоже применяются:
`npm run migrate` можно вызвать отдельно, чтобы проверить их заранее.

Если порты заняты, поменяйте их в `.env`. Для PostgreSQL нужно поправить `POSTGRES_PORT`,
`DATABASE_URL` и `TEST_DATABASE_URL`; для внешнего API — `ORDERS_API_PORT` и `ORDERS_API_URL`.
Порт самого сервиса задаётся через `PORT`. Чтобы запустить отдельный набор контейнеров,
добавьте `COMPOSE_PROJECT_NAME=orders-task`.

Отправка вебхуков из внешней системы (для разработки запускается вручную, сервис должен быть запущен):

```bash
docker compose run --rm orders-api webhooks --target http://host.docker.internal:3000/webhooks/order
```

Тесты (нужен запущенный PostgreSQL):

```bash
npm test
npm run typecheck
```

Тесты чистят таблицы в `TEST_DATABASE_URL` перед каждым сценарием. Для них нужна отдельная база `orders_test`.

## Структура

```
src/
  app.ts              Fastify-приложение, обработка ошибок
  container.ts        сборка зависимостей
  db.ts               пул соединений, миграции
  clients/            клиент внешнего API (лимиты, ретраи)
  repositories/       доступ к данным
  services/           бизнес-логика
  routes/             HTTP-слой
  utils/              деньги, время
migrations/           SQL-миграции, применяются по порядку
test/                 интеграционные тесты на реальной БД (внешний API — фейк)
```

## Соглашения

- Деньги внутри сервиса — в копейках (integer). Рубли — только на входе из внешнего API и в ответах.
- Время храним в UTC (`TIMESTAMPTZ`).
- Ошибки бизнес-логики — наследники `AppError`, в ответе `{ error: <код>, message }`.

## API сервиса

| Метод | Путь | Описание |
|---|---|---|
| POST | `/sync` | Забрать все заказы из внешнего API. Отвечает статистикой, когда всё забрано |
| POST | `/webhooks/order` | Обновление заказа (тело — `Order` внешнего API). Повтор/устаревшая версия → `200 { result: "stale" }` |
| GET | `/customers/:id/daily-totals?from=YYYY-MM-DD&to=YYYY-MM-DD` | Суммы оплаченных (`paid`) заказов по дням в таймзоне клиента |
| GET | `/health` | Проверка живости |

Обе даты входят в период. Заказ попадает в день своего создания (`createdAt`), переведённый в таймзону клиента.
Дни без оплаченных заказов тоже приходят в ответе, с нулевыми суммами.

```json
[
  {
    "date": "2026-02-10",
    "total": 2500,
    "gross": 2500,
    "discount": 412.5,
    "net": 2087.5
  }
]
```

- `gross` — сумма заказов до скидки;
- `net` — фактическая оплата из `amountPaid`;
- `discount` — разница между ними;
- `total` — то же, что `gross`, для старых клиентов API.

Суммы в ответе — числа в рублях. У JSON-числа нет фиксированного числа знаков после запятой:
`412.5` здесь означает 412 рублей 50 копеек.

## Внешний API (`ORDERS_API_URL`)

- `GET /orders?cursor=<string>&limit=<1..100>` → `{ items: Order[], nextCursor: string | null }`. Лимит 5 rps.
- `GET /customers/:id` → `{ id, timezone }` (IANA, например `Europe/Berlin`).
- Вебхуки: `POST` на наш `/webhooks/order`, тело — `Order`. Повторная доставка возможна.

```ts
type Order = {
  id: string;
  customerId: string;
  amount: number;          // сумма заказа в рублях, до скидки
  discountPercent: number; // скидка, % (0 — без скидки)
  amountPaid: number;      // оплачено, в рублях: amount со скидкой
  status: "pending" | "paid" | "refunded";
  createdAt: string;       // ISO 8601, UTC
  updatedAt: string;       // ISO 8601, UTC
};
```

В реальных ответах встречаются суммы и проценты строками. У старых заказов `discountPercent` и `amountPaid`
отсутствуют — такие заказы считаем без скидки. Если скидка больше нуля, но `amountPaid` нет, заказ не принимаем:
без фактической оплаты нельзя надёжно посчитать `net`. При наличии `amountPaid` используем именно его,
а не результат пересчёта по проценту.

После обновления старой базы нужно вызвать `POST /sync`, чтобы заполнить оплаты уже сохранённых заказов.
Для записей без этих данных статистика временно считает оплату равной полной сумме.

## Как получить result.json

Для первого запуска выполните команды из раздела «Запуск». Если уже работали с этой базой и нужен чистый прогон,
остановите сервис и пересоздайте его контейнеры:

```bash
docker compose down --volumes
docker compose up -d --wait
npm start
```

`down --volumes` удалит базу этого Compose-проекта. Не используйте его для базы, которую нужно сохранить.

Сервис оставьте запущенным. В другом терминале, из этой же папки, выполните команды по очереди:

```bash
curl --fail-with-body -sS -X POST http://localhost:3000/sync

docker compose run --rm orders-api webhooks --target http://host.docker.internal:3000/webhooks/order

curl --fail-with-body -sS \
  'http://localhost:3000/customers/c_7/daily-totals?from=2026-03-27&to=2026-03-31' \
  -o result.json
```

Если поменяли `PORT`, подставьте его в эти команды, в том числе в адрес для вебхуков.
Полученный результат и разбор ошибки лежат в [result.json](result.json) и [SOLUTION.md](SOLUTION.md).
