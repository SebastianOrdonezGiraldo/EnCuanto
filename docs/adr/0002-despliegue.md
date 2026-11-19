# ADR 0002: Plataforma de despliegue (D5)

- **Estado:** Abierta (se decide en H7)
- **Fecha:** 2026-11-19
- **Decide:** el usuario (decisión D5 de §14 del documento maestro)

## Contexto

El documento maestro (§5, §12 H7) asume Docker Compose en un VPS con Caddy. El usuario pidió después desplegar **gratis**, en cualquier plataforma que lo permita, no necesariamente Vercel ni un VPS, y sin dominio propio por ahora.

La aplicación tiene cuatro piezas con necesidades distintas:

| Pieza                                             | Necesita                                            |
| ------------------------------------------------- | --------------------------------------------------- |
| Web (Next.js, SSR/ISR)                            | Node o una plataforma con soporte nativo de Next.js |
| API (Fastify)                                     | Proceso Node de larga duración con HTTP             |
| Worker (BullMQ, desde H1)                         | Proceso Node de larga duración, sin HTTP            |
| PostgreSQL 16 con `pg_trgm` y `unaccent`, Redis 7 | Servicios gestionados o contenedores                |

## Decisión

Todavía ninguna. Mientras tanto, el código **no se ata a una plataforma**:

1. Toda la configuración entra por variables de entorno validadas con Zod (`apps/backend/src/shared/config.ts`); no hay rutas ni hosts fijos.
2. El backend escucha en `HOST`/`PORT`, que es lo que inyectan las PaaS.
3. `DATABASE_URL` y `REDIS_URL` aceptan TLS (`?sslmode=require`, `rediss://`), como exigen los servicios gestionados gratuitos.
4. El backend se empaqueta en un solo `dist/server.js` (tsup), que corre igual en un contenedor, en una PaaS o en un VPS.
5. `infra/docker-compose.yml` es **solo para desarrollo local**.
6. Las migraciones se aplican con un comando explícito (`pnpm db:migrate`), no al arrancar, para que funcionen en cualquier pipeline.

## Criterios para decidir en H7

- Coste cero real y límites del plan gratuito (horas de cómputo, suspensión por inactividad, almacenamiento de Postgres).
- **Uso comercial permitido:** el redirect `/go/{offerId}` con afiliación es monetización; algunos planes gratuitos lo prohíben (por ejemplo, el plan Hobby de Vercel es solo para uso no comercial).
- Soporte de procesos de larga duración para el worker de BullMQ (las plataformas _serverless_ no lo tienen).
- Extensiones `pg_trgm` y `unaccent` disponibles en el Postgres gestionado.
- Copias de seguridad y restauración verificable (criterio de H7).

## Alternativas a evaluar en H7

- Web en una plataforma con Next.js nativo y API + worker en una PaaS con contenedores.
- Todo en contenedores en una PaaS.
- VPS gratuito (capa gratuita de un proveedor cloud) con Docker Compose, como plantea §5.

## Consecuencias

- §5 (Infra: VPS) y §12 H7 ("despliegue reproducible en VPS") quedan sujetos a esta decisión.
- No se añaden SDK ni configuración específica de ninguna plataforma antes de decidir.
