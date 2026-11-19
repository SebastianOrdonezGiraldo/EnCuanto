# Contexto del proyecto: comparador de precios para Colombia

> Documento maestro para el desarrollo. **Claude** escribe el código y **ChatGPT** supervisa.
> Ambos deben leer este archivo completo antes de cada hito. Si algo del código contradice este documento, manda este documento hasta que se actualice con una decisión explícita (ver §14).
>
> Versión 1.0 · 19‑nov‑2026. Nombre de trabajo del producto: **"Comparador"** (provisional).
>
> **Actualizaciones por ADR:** D2 resuelta en [ADR 0001](adr/0001-nombre-y-marca.md) (el producto se llama **¿EnCuánto?**, código `encuanto`). D5 sigue abierta con nuevas restricciones en [ADR 0002](adr/0002-despliegue.md).

---

## 1. Objetivo

Construir una plataforma **original e independiente** que permita a usuarios en Colombia:

1. Buscar un producto y ver **en una sola ficha** las ofertas de varias tiendas, ordenadas por precio.
2. Saber si un descuento es real (historial de precios).
3. Guardar favoritos y recibir **alertas** cuando baje el precio.
4. Comparar de 2 a 5 productos con **IA** (recomendación estructurada).

**Referencia de mercado:** PillePrecios (pilleprecios.com), analizado por ingeniería inversa observacional (§2). Lo usamos para aprender qué funciona y qué falla. **No se copia** su código, textos, marca, diseño ni activos.

### Fuera de alcance (v1)

- App móvil nativa (la web debe ser responsive y funcionar bien en móvil).
- Pagos, checkout o carrito: siempre redirigimos a la tienda.
- Marketplace propio.
- *Scraping* de sitios de terceros sin autorización (ver §4).

---

## 2. Qué aprendimos de PillePrecios (resumen de la investigación)

La investigación completa está en `../investigacion-pilleprecios/`. Lo esencial:

| Tema | Hallazgo | Lección para nosotros |
|---|---|---|
| Stack | Monolito PHP 8.2 en Hostinger, JS vanilla de 37 KB, SSR PHP para SEO | Con una arquitectura simple basta; no hacen falta microservicios |
| Obtención de datos | Metabuscador. Cada búsqueda reenvía la consulta en vivo a los buscadores de ~9 tiendas (`/scrapers/` en robots.txt) y fusiona las respuestas en 1,4–2,4 s | Frágil (Éxito y Amazon ya devuelven 0) y de dudosa legalidad. **Nosotros: catálogo propio con ingesta programada desde fuentes autorizadas** |
| Comparación | No agrupa el mismo producto entre tiendas. Duplicados exactos. Mismo EAN repetido en Alkosto/Ktronix | **Modelo producto → variante → oferta** con *matching* por GTIN/modelo |
| Relevancia | "Relevancia" = turno rotativo por tienda. Una consulta sin sentido devuelve 40 resultados irrelevantes | **Ranking propio** + filtro de relevancia + estado vacío honesto |
| Descuentos | Muestra −99,8 % ($470.000 → $900) como "oferta del día" | **Validación de descuentos con historial** |
| Caché | Caché de respuesta compartida, TTL ≥ 4,5 min; cambiar página u orden vuelve a consultar todo | Caché en Redis con versión de catálogo; filtros y orden sobre resultados cacheados |
| IA | `POST` con productos enviados por el cliente (título, precio, descuento); devuelve `{recommended_index, headline, reasoning, pros, cons, tip, confidence}` en ~5 s | Mismo contrato de salida, pero **entrada por IDs** y datos (incluidas especificaciones) leídos de la BD |
| Seguridad | XSS potencial (`innerHTML` sin escapar, `onclick` inline). Límites de uso solo en localStorage. Cookie sin `HttpOnly` | Escapado por defecto, CSP, **límites en servidor**, cookies seguras |
| Auth | Google OAuth (*authorization code*) + sesión PHP | Google OIDC con cookies `HttpOnly; Secure; SameSite=Lax` |
| Favoritos | Guardan una copia del precio, con clave solo `external_id` (colisiones) | Favoritos sobre variante/oferta del catálogo vivo |
| Monetización | Sin afiliación ni publicidad | **Redirect `/go/{offerId}`** desde el día 1 (medición + afiliación autorizada) |
| SEO | Páginas SSR por tienda, categoría y producto; sitemap dinámico con slugs rotos | SSR + sitemap correcto + JSON‑LD Product/Offer |

---

## 3. Usuarios y casos de uso

| Caso de uso | Descripción | Hito |
|---|---|---|
| CU‑1 Buscar | Escribir "nevera no frost 300 litros" y ver fichas agrupadas con "desde $X en N tiendas" | H2 |
| CU‑2 Filtrar y ordenar | Por tienda, marca, rango de precio, solo descuentos reales; orden por relevancia, precio o descuento. Todo queda en la URL | H2 |
| CU‑3 Ver ficha | Variantes, ofertas por tienda, historial de precio, "precio verificado hace X" | H3/H5 |
| CU‑4 Ir a la tienda | Clic → `/go/{offerId}` → 302 a la tienda | H2 |
| CU‑5 Cuenta | Entrar con Google | H4 |
| CU‑6 Favoritos | Guardar una variante u oferta; ver el precio actual frente al precio al guardar | H4 |
| CU‑7 Alertas | Definir precio objetivo y recibir un email al cumplirse | H5 |
| CU‑8 Comparar con IA | Seleccionar 2–5, contexto opcional, recibir recomendación | H6 |
| CU‑9 Operar | Admin: estado de las fuentes, ejecuciones de sync, cola de *matching* dudoso | H1/H3 |

---

## 4. Restricciones no negociables

1. **Solo fuentes de datos autorizadas:** feeds de programas de afiliados, APIs oficiales, feeds entregados por el comerciante, CSV/JSON acordados o carga manual. **Prohibido** implementar adaptadores que hagan *scraping* de sitios o consuman endpoints no documentados de tiendas sin permiso escrito. Si una tarea lo requiriera, se detiene y se escala al usuario.
2. **Nada de PillePrecios en el código:** ni textos, ni nombres internos, ni colores, ni assets.
3. **Datos personales (Ley 1581 de 2012):** mínimo necesario (email, nombre, avatar de Google), política de privacidad, borrado de cuenta, nada de datos personales en logs ni en URLs.
4. **Secretos** solo por variables de entorno; `.env.example` sin valores reales; nunca en el repo.
5. **Seguridad por defecto:** sin `innerHTML` con datos, CSP, validación con Zod en cada borde, rate limiting en servidor.
6. **Toda afirmación sobre precio muestra su frescura** (`last_seen_at`).

---

## 5. Stack técnico (decisión por defecto, ver §14)

| Capa | Tecnología | Notas |
|---|---|---|
| Lenguaje | TypeScript 5 (strict) en todo el repo | Node 22 LTS |
| Monorepo | pnpm workspaces | Sin Turborepo/Nx al principio |
| Web | Next.js 15 (App Router, SSR/ISR) + Tailwind CSS | SEO y rendimiento |
| API + workers | Fastify 5 (un solo backend modular; entrypoints `server` y `worker` del mismo código) | Monolito modular |
| Colas | BullMQ sobre Redis 7 | Sync, matching, alertas |
| BD | PostgreSQL 16 + extensiones `pg_trgm`, `unaccent` | FTS en español |
| ORM / migraciones | Drizzle ORM + drizzle‑kit | SQL explícito, buen soporte de tipos |
| Validación | Zod (compartido entre web y API) | Contratos en `packages/contracts` |
| Auth | Google OIDC (`openid-client`) + sesión en cookie firmada/servidor (Redis) | Sin JWT en localStorage |
| IA | SDK oficial del proveedor elegido, detrás de la interfaz `LlmClient` | Proveedor intercambiable |
| Email | Proveedor SMTP/transaccional detrás de la interfaz `Mailer` | — |
| Tests | Vitest (unit/integración), Testcontainers (Postgres/Redis), Playwright (e2e mínimos) | — |
| Calidad | ESLint + Prettier + `tsc --noEmit` en CI | — |
| Infra | Docker Compose (postgres, redis, server, worker, web, caddy) en 1 VPS Linux | Caddy para TLS |
| CI | GitHub Actions: lint, typecheck, test, build | — |
| Observabilidad | pino (logs JSON), endpoint `/health`, métricas de sync en BD; Sentry opcional | — |

### Estructura del repositorio

```
comparador/
├── apps/
│   ├── web/                 # Next.js
│   └── backend/
│       ├── src/
│       │   ├── modules/
│       │   │   ├── catalog/        # products, variants, brands, categories
│       │   │   ├── merchants/
│       │   │   ├── providers/      # adaptadores + registro + rate limit
│       │   │   ├── ingestion/      # jobs de sync, sync runs, cuarentena
│       │   │   ├── normalization/
│       │   │   ├── matching/
│       │   │   ├── search/
│       │   │   ├── pricing/        # price_history, validación de descuentos
│       │   │   ├── ai/
│       │   │   ├── users/  favorites/  alerts/
│       │   │   ├── outbound/       # /go/:offerId
│       │   │   └── admin/
│       │   ├── shared/             # db, redis, logger, config, errors
│       │   ├── server.ts           # entrypoint HTTP
│       │   └── worker.ts           # entrypoint de colas
│       └── test/
├── packages/
│   ├── contracts/           # esquemas Zod + tipos de la API
│   └── db/                  # esquema Drizzle + migraciones + seeds
├── infra/                   # docker-compose.yml, Caddyfile, scripts de backup
├── docs/                    # este documento, ADRs, runbooks
└── fixtures/                # feeds de ejemplo (sintéticos) para dev/tests
```

**Regla de módulos:** un módulo solo expone su `index.ts` (servicio + tipos). Prohibido importar archivos internos de otro módulo. La BD es compartida, pero cada tabla tiene un módulo dueño que la escribe.

---

## 6. Modelo de datos

Tablas principales. Los nombres de columna van en `snake_case`; el dinero en `bigint` de **pesos COP enteros**.

| Tabla | Campos clave | Restricciones |
|---|---|---|
| `merchants` | id, slug, name, brand_color, platform, source_type (`affiliate_feed`\|`official_api`\|`partner_feed`\|`manual`), active, terms_reviewed_at, affiliate_template | `slug` único |
| `brands` | id, name, normalized_name | `normalized_name` único |
| `categories` | id, parent_id, slug, name, accessory (bool) | — |
| `products` | id, brand_id, category_id, canonical_name, model_number, specs JSONB, search_tsv (generada) | GIN en `search_tsv`; trigram en `canonical_name` |
| `product_variants` | id, product_id, gtin (nullable), attributes JSONB (`color`, `storage_gb`, `ram_gb`, `capacity_l`, `screen_in`), image_url | `gtin` único si no es nulo |
| `offers` | id, merchant_id, variant_id (nullable hasta el *match*), external_id, title_raw, url, image_url, seller_name, is_marketplace, condition, availability, price, list_price, currency, first_seen_at, last_seen_at, last_changed_at, match_status (`pending`\|`auto`\|`manual`\|`rejected`), match_confidence | **único `(merchant_id, external_id)`** |
| `price_history` | offer_id, price, list_price, observed_at | Fila nueva **solo cuando cambia** el precio; particionado mensual cuando supere 10 M filas |
| `provider_sync_runs` | id, merchant_id, started_at, finished_at, status, items_seen, items_upserted, items_quarantined, error_summary JSONB | — |
| `quarantined_records` | id, merchant_id, payload JSONB, reason, created_at | — |
| `match_reviews` | id, offer_id, candidate_variant_id, score, status, reviewed_by | — |
| `search_queries` | id, q_normalized, filters JSONB, results_count, latency_ms, user_id (nullable), created_at | Sin IP en claro |
| `users` | id, google_sub, email, name, avatar_url, prefs JSONB, created_at, deleted_at | `google_sub` único |
| `favorites` | user_id, variant_id, offer_id (nullable), price_at_save, created_at | PK `(user_id, variant_id)` |
| `price_alerts` | id, user_id, variant_id, target_price, active, last_notified_at | — |
| `ai_comparisons` | id, user_id (nullable), input_hash, variant_ids[], context, response JSONB, model, prompt_version, tokens_in, tokens_out, cost_usd, latency_ms, created_at | Índice en `input_hash` |
| `outbound_clicks` | id, offer_id, user_id (nullable), session_hash, created_at | — |

**Semántica de producto, variante y oferta:**

- **Producto** = el modelo ("Galaxy A56").
- **Variante** = atributos concretos, idealmente con GTIN ("A56 256 GB/8 GB Verde").
- **Oferta** = una variante vendida por un comerciante, a un precio, en un momento dado.

La "ficha" que ve el usuario es el **producto**, con selector de variante y lista de ofertas de la variante.

---

## 7. Contratos de la API (v1)

Todos los esquemas viven en `packages/contracts` (Zod). Errores con formato uniforme: `{ "error": { "code": "string", "message": "string", "details"?: {} } }`.

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| GET | `/api/search` | No | `q` (2–100 caracteres), `merchants` (CSV de slugs), `brands` (CSV), `min_price`, `max_price`, `discount_only` (bool), `sort` (`relevance`\|`price_asc`\|`price_desc`\|`discount`), `page` (≥ 1), `page_size` (≤ 48, por defecto 24) |
| GET | `/api/products/:id` | No | Ficha con variantes y ofertas vigentes |
| GET | `/api/variants/:id/price-history?days=90` | No | Serie de precios por oferta |
| GET | `/api/deals` | No | Ofertas con descuento **validado** |
| GET | `/go/:offerId` | No | Registra el clic y responde 302 a la URL de la tienda (+ afiliado si existe) |
| GET | `/api/auth/google` · `/api/auth/callback` · POST `/api/auth/logout` · GET `/api/me` | — | OIDC |
| GET/POST/DELETE | `/api/favorites` | Sí | Sobre `variant_id` |
| GET/POST/PATCH/DELETE | `/api/alerts` | Sí | `variant_id`, `target_price` |
| POST | `/api/ai/compare` | No (con límites) | `{ variant_ids: string[2..5], context?: string≤200 }` |
| DELETE | `/api/me` | Sí | Borrado de cuenta |
| GET | `/health` | No | Estado de BD, Redis y colas |

### Respuesta de búsqueda

```json
{
  "query": "nevera no frost",
  "normalized": { "terms": ["nevera","no","frost"], "brand": null, "attributes": {} },
  "total": 57, "page": 1, "page_size": 24,
  "results": [{
    "product_id": "uuid", "name": "Nevera X No Frost 300 L", "brand": "X",
    "image_url": "…", "variant_count": 2, "offer_count": 4,
    "min_price": 1899900, "max_price": 2199900,
    "best_offer": { "offer_id": "uuid", "merchant": "tienda-a", "price": 1899900,
                    "list_price": 2499900, "discount_pct": 24.0, "discount_validated": true,
                    "last_seen_at": "2026-11-19T12:00:00Z" }
  }],
  "facets": { "merchants": [{"slug":"tienda-a","count":31}], "brands": [{"name":"X","count":12}],
              "price": { "min": 89900, "max": 5999900 } },
  "cache": { "hit": true, "generated_at": "2026-11-19T12:00:00Z" }
}
```

### Respuesta de la IA

```json
{ "recommended_index": 0, "recommended_variant_id": "uuid",
  "headline": "≤80 caracteres", "reasoning": "≤600 caracteres",
  "pros": ["≤60 caracteres", "…≤4"], "cons": ["…≤4"], "tip": "≤140 caracteres",
  "confidence": 0.0, "data_coverage": 0.0, "cached": false }
```

---

## 8. Algoritmos y reglas de negocio

### 8.1 Normalización (`normalization`)

1. Texto: NFKC → minúsculas → `unaccent` → colapsar espacios.
2. Marca: diccionario `brands.normalized_name` + alias (`lg electronics` → `lg`).
3. Atributos por regex (tests obligatorios con casos reales):
   - almacenamiento `(\d+)\s?(gb|tb)`
   - RAM `(\d+)\s?gb\s?ram`
   - litros `(\d+)\s?(l|lt|lts|litros)\b`
   - pulgadas `(\d+([.,]\d)?)\s?("|pulgadas|pulg)`
   - color, contra una lista cerrada en español
4. Modelo: tokens alfanuméricos con dígito y letra de longitud ≥ 4 (`SM-A566B`, `BCD205`), excluyendo atributos ya extraídos.
5. GTIN: validar el dígito de control (EAN‑8/12/13/14); si no valida, descartarlo.
6. Precio: entero COP > 0. `list_price` < `price` → `list_price = null`.

### 8.2 Matching (`matching`)

| Nivel | Regla | Resultado |
|---|---|---|
| 1 | GTIN válido igual a una variante existente | `auto`, confianza 1,0 |
| 2 | Misma marca + mismo `model_number` + atributos compatibles | `auto`, 0,9 |
| 3 | Misma marca + similitud de trigramas del título ≥ 0,80 + atributos compatibles | `auto`, 0,8 |
| 4 | Similitud entre 0,55 y 0,80 | `pending` → cola de revisión manual |
| 5 | Sin candidato | Crear producto/variante nuevos |

**Atributos compatibles** = ningún atributo presente en ambos difiere (256 GB ≠ 128 GB bloquea el match).

### 8.3 Ranking (`search`)

```
score = ts_rank_cd(search_tsv, query) * w_text
      + similarity(canonical_name, q) * w_trgm
      - accessory_penalty   (0,5 si la categoría es accesorio y la consulta no contiene términos de accesorio)
      + availability_bonus  (0,1 si hay ≥ 1 oferta en stock)
```

Valores iniciales: `w_text = 1`, `w_trgm = 0,5`, configurables. **Umbral mínimo:** si no hay resultados con score > 0,05, se responde vacío (nunca "rellenar"). Los empates se resuelven por precio mínimo.

### 8.4 Descuentos (`pricing`)

- `discount_pct = round((list_price - price) / list_price * 100, 1)` cuando `list_price` existe.
- **Validado** si se cumplen todas:
  1. El precio actual es ≤ 0,95 × la mediana de los últimos 30 días (con ≥ 3 observaciones en ≥ 7 días).
  2. `discount_pct` ≤ 80.
  3. El precio es ≥ 10 % de la mediana de su categoría.
- Sin historial suficiente: `discount_validated = false` y la UI muestra "descuento informado por la tienda".
- Solo los validados entran en `/api/deals` y en el filtro `discount_only`.

### 8.5 Frescura

- `last_seen_at` > 72 h → la oferta se oculta.
- Entre 24 y 72 h → aviso "puede haber cambiado".

### 8.6 Caché

| Clave | TTL | Invalidación |
|---|---|---|
| `search:v{catalogVersion}:{sha1(q_norm + filtros + sort)}` → **conjunto completo de IDs + scores** | 10 min | La página se recorta del conjunto, así que cambiar de página no recalcula; `catalogVersion` sube al terminar un sync con cambios |
| `product:{id}` | 30 min | Al cambiar una oferta de esa variante |
| `ai:{sha256(sorted variant_ids + context_norm + prompt_version)}` | 24 h | Cambio de precio > 5 % en alguna de las ofertas |

### 8.7 Límites (Redis, ventana deslizante)

| Recurso | Anónimo (por IP + cookie de dispositivo) | Usuario |
|---|---|---|
| Búsquedas | 60/min, 500/día | 120/min |
| IA | 3/día | 20/día |
| Presupuesto IA global | Corte con *circuit breaker* al alcanzar `AI_DAILY_BUDGET_USD` | — |

---

## 9. Integraciones (adaptadores)

```ts
export interface ProviderAdapter {
  readonly merchantSlug: string;
  readonly sourceType: 'affiliate_feed' | 'official_api' | 'partner_feed' | 'manual';
  readonly limits: { rps: number; burst: number; dailyQuota?: number };
  sync(ctx: SyncContext): AsyncIterable<RawOffer>;      // completa o incremental (cursor en ctx)
  refresh?(externalIds: string[], ctx: SyncContext): Promise<RawOffer[]>;
  healthCheck(): Promise<{ ok: boolean; detail?: string }>;
}
```

`RawOffer` se valida con Zod. Los registros inválidos van a `quarantined_records`, nunca a `offers`.

**Adaptadores de v1** (no dependen de acuerdos aún no cerrados):

1. `FixtureAdapter`: lee `fixtures/*.json` con datos **sintéticos** (marcas y tiendas ficticias). Sirve para dev, tests y demo.
2. `CsvFeedAdapter`: CSV/TSV con mapeo de columnas configurable por comerciante.
3. `GoogleMerchantFeedAdapter`: formato estándar de feed de productos (XML/TSV con `id, title, link, image_link, price, sale_price, gtin, brand, availability`), habitual en programas de afiliación y de comerciantes.

Los adaptadores de APIs específicas se añaden **solo** cuando exista autorización documentada (registrar `terms_reviewed_at`).

**Operación de las fuentes:**

- Token bucket por comerciante.
- 3 reintentos exponenciales con *jitter*.
- *Circuit breaker*: 5 fallos seguidos → pausa de 30 min y alerta.
- Cada ejecución queda registrada en `provider_sync_runs`.
- Alerta si `items_seen` cae > 50 % respecto a la media de las últimas 7 ejecuciones.

---

## 10. IA

1. La entrada son `variant_ids`. El servidor carga nombre, marca, specs, atributos, mejor oferta, rating y frescura.
2. El prompt es versionado (`prompt_version`) y vive en `modules/ai/prompts/`. Los datos del usuario y del catálogo van delimitados como **datos**, nunca como instrucciones.
3. Se pide salida estructurada con JSON Schema y se valida con Zod. Si falla, se reintenta 1 vez; si vuelve a fallar, se devuelve una comparación determinista (tabla de precio, descuento validado y specs clave) con `ai_available:false`.
4. `confidence_final = min(confidence_modelo, data_coverage)`, donde `data_coverage` = fracción de specs relevantes de la categoría que están presentes.
5. Cada llamada registra tokens, costo, latencia, modelo y versión del prompt en `ai_comparisons`.
6. Timeout de 20 s.
7. El proveedor va detrás de `LlmClient`. La elección es una decisión abierta (§14).

---

## 11. Frontend

- **Páginas:** `/` · `/buscar` · `/p/[slug]-[id]` (ficha) · `/tienda/[slug]` · `/categoria/[slug]` · `/ofertas` · `/favoritos` · `/alertas` · `/cuenta` · `/privacidad` · `/terminos`.
- **SSR** para búsqueda, ficha, tienda, categoría y ofertas.
- **SEO:** JSON‑LD `Product` + `AggregateOffer`; `sitemap.xml` generado desde la BD con slugs transliterados correctamente (test con "Cámaras", "Nevecón", "iPhone").
- **Estado** en la URL: filtros, orden y página son compartibles; el botón Atrás funciona.
- **Seguridad:** nunca `dangerouslySetInnerHTML` con datos externos. La salida de la IA se renderiza como texto.
- **Accesibilidad:** contraste AA, navegación por teclado, `prefers-reduced-motion`.
- **Rendimiento:** LCP < 2,5 s en 4G; imágenes con `next/image` y dominios permitidos.
- **Identidad visual propia:** paleta, tipografía y logo distintos de la referencia.

---

## 12. Plan por hitos

Cada hito = una o varias PR revisables. ChatGPT revisa **cada PR** contra la checklist de `PROMPT-SUPERVISOR-CHATGPT.md`.

| Hito | Contenido | Criterios de aceptación |
|---|---|---|
| **H0 Fundaciones** | Monorepo, Docker Compose (pg, redis), Drizzle + primera migración, Fastify con `/health`, Next.js base, ESLint/Prettier/tsc, Vitest, CI | `pnpm i && pnpm dev` levanta todo; CI en verde; `/health` responde OK con BD y Redis |
| **H1 Catálogo e ingesta** | Tablas §6, `merchants`, `providers` (Fixture + CSV + Google Merchant), `ingestion` con BullMQ, `normalization`, `price_history` solo en cambios, cuarentena, admin mínimo de sync runs | Seed sintético de 3 comerciantes y ≥ 2.000 ofertas; reejecutar sync es idempotente; tests de normalización con ≥ 40 casos |
| **H2 Búsqueda y web** | FTS + trigramas, ranking §8.3, facetas, caché §8.6, `/api/search`, `/go/:offerId`, páginas SSR de búsqueda, tienda y categoría, sitemap | p95 < 150 ms con 50 k ofertas sintéticas; una consulta sin sentido devuelve vacío; filtros en URL; e2e de búsqueda |
| **H3 Matching y ficha** | Matching §8.2, cola `match_reviews`, ficha de producto con variantes y ofertas | En el set de prueba: precisión ≥ 95 % en auto‑matches; mismo GTIN en 2 tiendas → 1 variante con 2 ofertas |
| **H4 Usuarios** | Google OIDC, sesión, favoritos, borrado de cuenta, límites §8.7 | Cookies `HttpOnly; Secure; SameSite=Lax`; favoritos por variante; 429 al superar el límite |
| **H5 Precios y alertas** | Validación de descuentos §8.4, `/api/deals`, gráfico de historial, alertas por email (job) | Descuento de −99 % sin historial → no validado; alerta enviada una sola vez por cruce de umbral |
| **H6 IA** | `/api/ai/compare` §10, UI de selección (2–5), caché, presupuesto, fallback | Esquema validado; se cumple el presupuesto; salida renderizada como texto; costo por llamada registrado |
| **H7 Endurecimiento y despliegue** | CSP, cabeceras, Caddy, backups diarios con prueba de restauración, runbooks, monitoreo de fuentes | Despliegue reproducible en VPS desde cero con un script; restauración verificada |

---

## 13. Convenciones y Definition of Done

- **Commits:** Conventional Commits (`feat(search): …`). Una PR por tarea coherente, de < ~600 líneas netas cuando sea posible.
- **TypeScript:** `strict`, sin `any` implícito; los `any` explícitos llevan un comentario que lo justifique.
- **Errores:** clases de dominio (`NotFoundError`, `ValidationError`, `RateLimitError`) mapeadas en un único *error handler*.
- **Logs:** pino JSON con `request_id`; prohibido loguear emails, tokens o cuerpos completos de usuario.
- **Config:** `shared/config.ts` valida `process.env` con Zod al arrancar; falta una variable → no arranca.
- **Tests:** cada regla de §8 tiene tests unitarios; cada endpoint, al menos un test de integración (éxito + validación + auth/límite).
- **Migraciones:** solo hacia adelante, revisadas en la PR; nunca editar una migración ya fusionada.
- **Dependencias:** versiones exactas fijadas en el lockfile; justificar cada dependencia nueva en la PR.

**Definition of Done de una PR:**

1. Lint, typecheck y tests en verde.
2. Tests nuevos para el comportamiento nuevo.
3. Criterios del hito cubiertos o explícitamente pendientes.
4. Sin secretos ni datos reales en el diff.
5. Docs/ADR actualizados si cambió una decisión.
6. Descripción de PR con: qué, por qué, cómo se probó, riesgos y qué falta.

---

## 14. Decisiones abiertas (las toma el usuario)

| # | Decisión | Opción por defecto (si no se responde) |
|---|---|---|
| D1 | Stack: TypeScript (este doc) o PHP/Laravel | TypeScript |
| D2 | Nombre y marca del producto | "Comparador" (provisional) |
| D3 | Primeras fuentes autorizadas reales (afiliados, feeds, acuerdos) | Solo fixtures + adaptadores genéricos hasta confirmarlas |
| D4 | Proveedor de IA | Interfaz `LlmClient` + implementación de un proveedor que el usuario elija; en tests, un mock |
| D5 | Proveedor de VPS y dominio | Pendiente para H7 |
| D6 | Repositorio (GitHub privado) | GitHub privado + Actions |
| D7 | Proveedor de email | Interfaz `Mailer` + SMTP genérico |

**Registro de decisiones:** cada decisión tomada se añade como ADR en `docs/adr/NNNN-titulo.md`: contexto, decisión, alternativas, consecuencias.

---

## 15. Protocolo de trabajo Claude ↔ ChatGPT

1. **El usuario** indica el hito o tarea.
2. **Claude** implementa en una rama, ejecuta lint, typecheck y tests, y entrega:
   - un resumen (qué, por qué, cómo se probó, riesgos, pendientes);
   - el diff o enlace a la PR;
   - la salida de los tests.
3. **El usuario** pega a ChatGPT esa entrega, junto con este documento (la primera vez) y `PROMPT-SUPERVISOR-CHATGPT.md`.
4. **ChatGPT** devuelve una revisión en el formato acordado: hallazgos clasificados BLOQUEANTE / IMPORTANTE / SUGERENCIA, cada uno con archivo y línea, problema, por qué y propuesta.
5. **El usuario** pega la revisión a Claude. Claude responde punto por punto:
   - **Aplicado** (con commit);
   - **No aplicado** (con argumento técnico);
   - **Requiere decisión del usuario**.
6. **Se fusiona** cuando no quedan bloqueantes abiertos y el usuario aprueba.

**Reglas de desacuerdo:** si Claude y ChatGPT discrepan, cada uno da su argumento en ≤ 5 líneas y **decide el usuario**. Lo que contradiga §4 (restricciones) se resuelve siempre a favor de §4.
