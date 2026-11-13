# Тестовое задание: сервис статистики заказов

Внутри:

```
orders-aggregator/            код сервиса — в нём и работаете
  TASK.md                     ← само задание, начните с него
  README.md                   как запустить сервис, его API и API внешней системы
  docker-compose.yml          PostgreSQL + внешний API
orders-mock-arm64.tar.gz      образ внешнего API для arm64 (Mac на Apple Silicon)
orders-mock-amd64.tar.gz      образ внешнего API для x86_64
```

С чего начать:

```bash
docker load -i orders-mock-arm64.tar.gz   # или amd64 — смотрите `uname -m`
cd orders-aggregator
cat TASK.md
```

Нужно: Docker, Node 20+. Время — до 3 часов.
Результат присылайте ссылкой на репозиторий или архивом папки `orders-aggregator` (без `node_modules` и образов).
