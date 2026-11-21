# ¿EnCuánto?

Comparador de precios para Colombia. **Todas las tiendas. Un solo precio: el más bajo.**

El documento maestro está en [docs/CONTEXTO-PROYECTO.md](docs/CONTEXTO-PROYECTO.md) y las decisiones en [docs/adr/](docs/adr/).

## Requisitos

- Node 22 (`.nvmrc`) y pnpm 10 (`corepack enable`)
- Docker con Compose (para PostgreSQL y Redis en local)

## Empezar

```bash
pnpm i      # instala y crea .env a partir de .env.example si no existe
pnpm dev    # levanta Postgres y Redis, aplica migraciones y arranca API, worker y web
pnpm db:seed  # catálogo sintético: 3 comerciantes ficticios y ~2.400 ofertas con sus fichas
```

- Web: http://localhost:3000
- API: http://localhost:4000/health

## Scripts

| Comando                             | Qué hace                                                                                 |
| ----------------------------------- | ---------------------------------------------------------------------------------------- |
| `pnpm dev`                          | Infra + migraciones + API y worker (`tsx watch`) + web (`next dev`)                      |
| `pnpm db:seed [--day N]`            | Genera feeds sintéticos y los sincroniza; `--day N` simula N días de cambios de precio   |
| `pnpm lint` / `pnpm format:check`   | ESLint y Prettier                                                                        |
| `pnpm typecheck`                    | `tsc --noEmit` en todos los paquetes                                                     |
| `pnpm test`                         | Vitest. Los tests de integración usan `DATABASE_URL` y `REDIS_URL`; sin ellas se omiten  |
| `pnpm build`                        | Build de la web y del backend                                                            |
| `pnpm bench:search`                 | p95 de `/api/search` con ~50.000 ofertas sintéticas en una BD aparte (`encuanto_bench`)  |
| `pnpm e2e`                          | e2e de búsqueda con Playwright (necesita el seed y `pnpm build`, o `pnpm dev` en marcha) |
| `pnpm db:generate`                  | Genera una migración desde el esquema Drizzle                                            |
| `pnpm db:migrate`                   | Aplica migraciones pendientes                                                            |
| `pnpm infra:up` / `pnpm infra:down` | Arranca o para Postgres y Redis                                                          |

## Estructura

```
apps/web          Next.js 15 (App Router) + Tailwind 4
apps/backend      Fastify 5 (monolito modular)
packages/contracts  Esquemas Zod compartidos
packages/db       Esquema Drizzle, migraciones y cliente
fixtures/         Feeds sintéticos de ejemplo (los del seed van a fixtures/generado/, ignorado)
infra/            docker-compose.yml de desarrollo
docs/             Documento maestro, ADR y marca
```

## Ingesta (H1)

Las ofertas llegan solo de fuentes autorizadas (§4): un adaptador por comerciante según
`merchants.provider_config` (`fixture`, `csv` o `google_merchant`). El worker (`src/worker.ts`)
procesa la cola `provider-sync` de BullMQ y programa un sync cada `SYNC_INTERVAL_MINUTES`.
Cada ejecución queda en `provider_sync_runs`; los registros inválidos, en `quarantined_records`.

Admin mínimo (requiere `ADMIN_TOKEN` en `.env`; sin él las rutas no existen):

```bash
curl -H "Authorization: Bearer $ADMIN_TOKEN" localhost:4000/api/admin/merchants
curl -H "Authorization: Bearer $ADMIN_TOKEN" "localhost:4000/api/admin/sync-runs?merchant=tienda-aurora"
curl -H "Authorization: Bearer $ADMIN_TOKEN" localhost:4000/api/admin/quarantine
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" localhost:4000/api/admin/merchants/tienda-aurora/sync
```

## Búsqueda y web (H2)

- API: `GET /api/search?q=…` (§7) con filtros `merchants`, `brands`, `min_price`, `max_price`,
  `discount_only`, `sort` y `page`; `GET /api/categories[/:slug]`, `GET /api/merchants[/:slug]` y
  `GET /go/:offerId` (302 a la tienda).
- Web: `/buscar`, `/categoria/[slug]`, `/tienda/[slug]`, `/go/[offerId]`, `sitemap.xml` y `robots.txt`.
- Ranking §8.3 con pesos `SEARCH_W_TEXT` y `SEARCH_W_TRGM`; caché §8.6 en Redis con
  `SEARCH_CACHE_TTL_SECONDS` (0 la desactiva). Decisiones en [ADR 0003](docs/adr/0003-busqueda-h2.md).
