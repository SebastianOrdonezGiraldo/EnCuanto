# ADR 0003: Decisiones de la búsqueda (H2)

- **Estado:** Aceptada (pendiente de revisión)
- **Fecha:** 2026-11-20
- **Decide:** Claude implementa; ChatGPT revisa; el usuario aprueba (§15)

## Contexto

H2 pide FTS + trigramas, ranking §8.3, facetas, caché §8.6, `/api/search`, `/go/:offerId` y páginas SSR. Hay huecos que el documento maestro no cierra:

1. Las ofertas de H1 no tienen ficha (`variant_id` es nulo hasta el matching de H3), pero la búsqueda de §7 devuelve **productos**.
2. §8.3 no dice cómo combinar los términos de la consulta.
3. `discount_only` solo admite descuentos **validados** (§8.4), que llegan en H5.
4. §7 no define qué cuentan las facetas cuando hay filtros.

## Decisiones

1. **Fichas del seed hasta H3.** El seed sintético conoce la variante de cada oferta: crea categorías, productos y variantes (`catalog.upsertCatalog`) y enlaza las ofertas con `match_status = 'manual'` (`matching.assignVariants`). Las ofertas reales sin ficha no aparecen en la búsqueda hasta que el matching de H3 las enlace.
2. **Términos en OR.** `to_tsquery('spanish', 't1 | t2 | …')` con términos limitados a `[a-z0-9]` (el usuario no puede inyectar operadores). `ts_rank_cd` premia los productos con más términos y el umbral de 0,05 descarta el resto: "nevera no frost 300 litros" encuentra neveras aunque "litros" no esté en el nombre, y una consulta sin ninguna palabra conocida devuelve vacío. La entrada por trigramas usa `word_similarity` (`<%`, umbral 0,6 de `pg_trgm`); la puntuación usa `similarity` como dice §8.3.
3. **`discount_only` vacío hasta H5.** La consulta no elige ninguna oferta con ese filtro (la validación con historial llega en H5): no se dan por buenos los descuentos de la tienda. La web no muestra el filtro todavía y etiqueta los descuentos como "informado por la tienda".
4. **Facetas disyuntivas.** Cada faceta ignora su propio filtro y respeta los demás; el número de una tienda usa el precio de esa tienda. Así el número coincide con lo que se ve al marcarla.
5. **Ranking y facetas en TypeScript.** Una sola consulta devuelve todos los candidatos que coinciden (sin recorte: filtros, orden, total y facetas se calculan sobre el universo completo) y, por cada (producto, tienda), el resumen de sus ofertas vigentes: mejor oferta, precio máximo, número de ofertas y si hay stock. Filtros, facetas y orden son funciones puras (`search/rank.ts`) con tests unitarios; `groupOffers` es la referencia en TypeScript de esa agregación. La caché guarda el conjunto ordenado completo como tuplas compactas, con TTL acotado a la primera caducidad (72 h, §8.5) de las ofertas con las que se calculó: el paso del tiempo no sube la versión de catálogo, así que sin ese límite podía servir un producto cuya mejor oferta ya no está vigente; la página se recorta de él y se completa con los datos vigentes, incluido el número de versiones (variantes), que no influye en el orden.
6. **`offers.product_id` desnormalizado.** Los listados leen las ofertas de cientos de productos; ir por `product_variants` costaba la mitad del tiempo de la consulta. La columna la mantienen triggers (al insertar la oferta, al cambiarle la variante, al borrarse la variante y al mover una variante a otro producto) y la aplicación nunca la escribe. Un índice btree cubriente sobre `(product_id, merchant_id, price, last_seen_at, …)` permite un index-only scan. Coste: más escritura de índice en cada sync.
7. **Rendimiento medido sin caché.** `pnpm bench:search` siembra ~50.000 ofertas en una BD aislada, hace `VACUUM ANALYZE` (estado estable; si no, el autovacuum de lo recién sembrado corre durante la medición) y exige p95 < 150 ms en el peor caso: cada petición va a la BD. El CI usa la imagen `postgres:16` (Debian/glibc), más parecida a las plataformas gestionadas que la variante Alpine (musl).
8. **Frescura.** Las ofertas con `last_seen_at` > 72 h no entran en la búsqueda ni en `/go`; entre 24 y 72 h llevan `stale: true`.
9. **`/go` sin identificar a nadie.** `outbound_clicks` se guarda sin `user_id` ni `session_hash` hasta H4 (cookie de dispositivo). La web expone `/go/:offerId` en su propio dominio con un route handler que pide el destino a la API.

## Consecuencias

- La búsqueda real depende de H3 para catálogos que no vengan del seed.
- Los atributos de la variante (capacidad, color) aún no puntúan: solo el nombre y el modelo del producto (`search_tsv`).
- Los errores de escritura cercanos (similitud de palabra < 0,6, como "nebera") no encuentran nada; bajar el umbral se puede evaluar con datos reales.
