-- Matching (H3, §8.2).
--
-- 1. offers.category: categoría de la fuente, para la ficha nueva que crea el nivel 5.
-- 2. offers.match_level: nivel de §8.2 que decidió el enlace automático (1, 2, 3 o 5).
-- 3. match_reviews.reason y una sola revisión abierta por oferta.
-- 4. Índice de marca + modelo (sin guiones ni espacios) para el nivel 2.
-- 5. Los GTIN de las variantes pasan a 14 dígitos, como los de las ofertas (normalizeGtin).
-- 6. Trigger: si la fuente cambia lo que el matching usa (título, GTIN o marca) de una oferta
--    decidida por el algoritmo, vuelve a `pending` y su revisión abierta se descarta.
-- 7. Índice parcial de las pendientes, en el orden en que las recorre el matching.
ALTER TABLE "match_reviews" ADD COLUMN "reason" text DEFAULT 'similitud_media' NOT NULL;--> statement-breakpoint
ALTER TABLE "offers" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "offers" ADD COLUMN "match_level" smallint;--> statement-breakpoint
CREATE UNIQUE INDEX "match_reviews_offer_pending_unique" ON "match_reviews" USING btree ("offer_id") WHERE "match_reviews"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "products_brand_model_key_idx" ON "products" USING btree ("brand_id",regexp_replace(upper("model_number"), '[^A-Z0-9]', '', 'g'));--> statement-breakpoint
CREATE INDEX "offers_match_pending_idx" ON "offers" USING btree ("first_seen_at","id") WHERE "offers"."match_status" = 'pending';--> statement-breakpoint
-- Las ofertas guardan el GTIN en 14 dígitos (normalizeGtin): las variantes, igual. Si ya existe
-- la forma de 14 dígitos en otra variante, se deja la original (no se rompe la unicidad).
UPDATE "product_variants" v SET "gtin" = lpad(v."gtin", 14, '0')
 WHERE v."gtin" ~ '^[0-9]{8}$|^[0-9]{12,13}$'
   AND NOT EXISTS (SELECT 1 FROM "product_variants" o WHERE o."gtin" = lpad(v."gtin", 14, '0'));--> statement-breakpoint
-- Una oferta emparejada por el algoritmo (auto), descartada (rejected) o pendiente vuelve a
-- `pending` si cambian los datos con los que se decidió. Conserva la variante hasta que el
-- matching vuelva a decidir (sigue visible). Las decididas por una persona (manual) no se tocan.
CREATE FUNCTION "offers_reset_match"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.match_status := 'pending';
  NEW.match_confidence := NULL;
  NEW.match_level := NULL;
  DELETE FROM match_reviews WHERE offer_id = NEW.id AND status = 'pending';
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER "offers_reset_match" BEFORE UPDATE OF "title_raw", "gtin", "brand" ON "offers"
  FOR EACH ROW
  WHEN (OLD.match_status <> 'manual'
        AND (OLD.title_raw IS DISTINCT FROM NEW.title_raw
             OR OLD.gtin IS DISTINCT FROM NEW.gtin
             OR OLD.brand IS DISTINCT FROM NEW.brand))
  EXECUTE FUNCTION "offers_reset_match"();
