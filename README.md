# ¿EnCuánto?

Comparador de precios para Colombia. **Todas las tiendas. Un solo precio: el más bajo.**

El documento maestro está en [docs/CONTEXTO-PROYECTO.md](docs/CONTEXTO-PROYECTO.md) y las decisiones en [docs/adr/](docs/adr/).

## Requisitos

- Node 22 (`.nvmrc`) y pnpm 10 (`corepack enable`)
- Docker con Compose (para PostgreSQL y Redis en local)

## Empezar

```bash
pnpm i      # instala y crea .env a partir de .env.example si no existe
pnpm dev    # levanta Postgres y Redis, aplica migraciones y arranca API y web
```

- Web: http://localhost:3000
- API: http://localhost:4000/health

## Scripts

| Comando                             | Qué hace                                                                                |
| ----------------------------------- | --------------------------------------------------------------------------------------- |
| `pnpm dev`                          | Infra + migraciones + API (`tsx watch`) + web (`next dev`)                              |
| `pnpm lint` / `pnpm format:check`   | ESLint y Prettier                                                                       |
| `pnpm typecheck`                    | `tsc --noEmit` en todos los paquetes                                                    |
| `pnpm test`                         | Vitest. Los tests de integración usan `DATABASE_URL` y `REDIS_URL`; sin ellas se omiten |
| `pnpm build`                        | Build de la web y del backend                                                           |
| `pnpm db:generate`                  | Genera una migración desde el esquema Drizzle                                           |
| `pnpm db:migrate`                   | Aplica migraciones pendientes                                                           |
| `pnpm infra:up` / `pnpm infra:down` | Arranca o para Postgres y Redis                                                         |

## Estructura

```
apps/web          Next.js 15 (App Router) + Tailwind 4
apps/backend      Fastify 5 (monolito modular)
packages/contracts  Esquemas Zod compartidos
packages/db       Esquema Drizzle, migraciones y cliente
infra/            docker-compose.yml de desarrollo
docs/             Documento maestro, ADR y marca
```
