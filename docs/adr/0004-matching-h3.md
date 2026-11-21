# ADR 0004: Decisiones del matching (H3)

- **Estado:** Aceptada (pendiente de revisión)
- **Fecha:** 2026-11-21
- **Decide:** Claude implementa; ChatGPT revisa; el usuario aprueba (§15)

## Contexto

H3 pide el matching de §8.2 (ofertas → producto/variante), la cola `match_reviews` y la ficha de producto con variantes y ofertas. Criterio de aceptación: en el set de prueba, precisión ≥ 95 % en los auto‑matches, y el mismo GTIN en dos tiendas da una variante con dos ofertas. §8.2 fija los niveles y los umbrales de trigramas (0,80 auto, 0,55 revisión), pero no cierra:

1. Cómo se calcula la similitud y dónde viven las reglas.
2. Qué hace que dos títulos parecidos sean productos distintos ("Nova 12" frente a "Nova 12 Pro", un teléfono frente a su funda).
3. Qué pasa con una oferta ya enlazada cuando la tienda cambia el título o el GTIN.
4. Cómo evitar dos fichas para el mismo producto cuando corren varios workers.

## Decisiones

1. **Reglas puras en TypeScript, candidatos en SQL.** `findCandidates` trae de la BD las fichas posibles (por GTIN, por marca + modelo y por trigramas con `pg_trgm`); `decideMatch` decide sin E/S. La similitud en TypeScript (`matching/trigram.ts`) da exactamente lo mismo que `similarity()` de `pg_trgm` (comprobado sobre todos los pares del set de prueba), y `candidatesInMemory` es la referencia que usan los tests de precisión; un test de integración compara las dos vías.
2. **Niveles.**
   - **1 · GTIN** (normalizado a 14 dígitos): auto, salvo que la marca contradiga a la ficha o los atributos sean incompatibles → revisión `gtin_conflicto`.
   - **2 · marca + modelo** (modelo sin guiones ni espacios, `SM-A566B` = `SMA566B`): exige similitud ≥ 0,3 con el nombre (si no, revisión `modelo_poco_parecido`) y que no sea accesorio o combo frente a un producto. Si ninguna variante es compatible, crea una **variante nueva** en la ficha; si encaja en varias, revisión. Si la oferta trae un GTIN y la variante no lo tiene, se lo completa (solo si ninguna otra variante lo usa).
   - **3/4 · trigramas** entre el núcleo del título (sin atributos ni palabras de venta) y el nombre de la ficha: auto con ≥ 0,80 solo si la marca coincide, los **tokens de identidad** son iguales, no hay conflicto accesorio/combo y la variante es única; ≥ 0,55 → revisión. Si varias fichas pasan el umbral automático → revisión `ficha_ambigua`.
   - **5 · ficha nueva**: producto + variante creados desde la oferta (marca y categoría se crean si no existen). `match_confidence` queda nulo: no hay comparación.
3. **Tokens de identidad.** Los tokens con dígitos que no son especificaciones (`12` de "Nova 12", el modelo) y los sufijos de línea (`pro`, `max`, `plus`, `ultra`, `lite`, `mini`, `neo`, `fe`, `xl`). "5G" y "4K" no cuentan. Es lo que separa productos de la misma línea con títulos casi iguales.
4. **Exclusiones duras.** Una ficha con otra marca, o con otro modelo cuando los dos lo tienen, deja de ser candidata: dos modelos distintos de la misma línea no van a revisión (con el seed completo eran cientos de revisiones inútiles). Una variante con otro GTIN es incompatible.
5. **Accesorios y combos.** Un título que empieza como accesorio ("Funda para…", "Cargador…", "Vidrio templado…") o dice "compatible con" no se enlaza con un producto principal, ni un combo o pack con la unidad: su precio no es comparable. La lista de términos de accesorio se movió a `normalization` y la comparte la búsqueda.
6. **Extensión de la normalización.** Se añade `weight_kg` a los atributos (lavadoras "19 Kg"), el color se quita del núcleo del título y los tokens de CPU/GPU (`i5-1235u`, `rtx4060`) no se toman como modelo.
7. **Recuperación acotada y visible.** Los candidatos por trigramas usan un umbral de recuperación de 0,5 (`set_config('pg_trgm.similarity_threshold', …, true)`, solo en la transacción) y un tope de 50 fichas parecidas por oferta (`MAX_SIMILAR_PRODUCTS`). Cuando se alcanza, se cuenta en `candidatesCapped` y se registra un aviso: el límite no es silencioso.
8. **Concurrencia.** Cada oferta se decide en su propia transacción con `pg_advisory_xact_lock('matching:catalog')` y la fila bloqueada (`for update`). Varios workers pueden correr a la vez sin crear dos fichas para el mismo producto. Las ofertas se recorren en orden de llegada (`first_seen_at`, `id`), en pasadas sucesivas hasta que no quedan pendientes nuevas: la primera tienda que trae un producto le da nombre a la ficha, y reejecutar sin cambios no hace nada.
9. **Cambios en la oferta.** El trigger `offers_reset_match` devuelve a `pending` la oferta no manual cuyo `title_raw`, `gtin` o `brand` cambia, borra su nivel y confianza y borra su revisión pendiente. La variante se mantiene hasta que se vuelve a decidir (la oferta no desaparece de la búsqueda entre sync y matching). Las decisiones manuales no se tocan.
10. **Columnas nuevas.** `offers.match_level` (1, 2, 3 o 5), `offers.category` (ruta de categoría de la fuente; nombra la categoría de una ficha nueva), `match_reviews.reason` y un índice único parcial de una revisión pendiente por oferta. La migración 0005 normaliza a 14 dígitos los GTIN de variantes que ya existían.
11. **Cola de revisión por API.** `GET /api/admin/match-reviews` y `POST /api/admin/match-reviews/:id` con cuatro decisiones: aceptar el candidato, crear una variante en su ficha, crear una ficha nueva o descartar la oferta. Quedan como `manual` o `rejected` y el matching no las vuelve a tocar. `POST /api/admin/matching` encola una ejecución.
12. **Cola BullMQ sin deduplicar.** Cada sync encola un matching al terminar y el worker lo procesa con concurrencia 1. No se deduplican trabajos: una ejecución que llega mientras otra corre encuentra solo lo que quedó pendiente, y deduplicar podía perder las ofertas insertadas durante la ejecución en curso.
13. **Ficha de producto.** `GET /api/products/:id` devuelve el producto con sus variantes y ofertas vigentes (72 h, §8.5), ordenadas por precio; 404 si no tiene ninguna oferta vigente. La web la muestra en `/producto/[id]` (SSR, `?variante=` para elegir una) y las tarjetas de la búsqueda enlazan a ella.
14. **Seed con matching.** `pnpm seed --matching` siembra ofertas sin ficha y deja que el matching cree el catálogo, e imprime la evaluación contra la verdad del seed. Sin la opción, el seed sigue enlazando como en H2 (ADR 0003, decisión 1).

## Consecuencias

- Los sinónimos no se resuelven ("smartphone" frente a "celular", "tv" frente a "televisor"): pueden quedar fichas duplicadas que habrá que unir a mano o con un diccionario.
- Los portátiles con la CPU en el título y los modelos con sufijo regional pueden ir a revisión o crear una ficha aparte.
- La cola de revisión no tiene interfaz web todavía, y `reviewed_by` queda nulo hasta que haya usuarios (H4).
- Los umbrales son los de §8.2; ajustarlos requiere medir con ofertas reales.
