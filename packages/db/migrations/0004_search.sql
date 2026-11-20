-- Búsqueda (H2, §8.3).
--
-- 1. Trigramas sobre el nombre sin tildes ni mayúsculas, igual que la consulta.
-- 2. offers.product_id: producto de la variante, desnormalizado para que los listados lean las
--    ofertas de cientos de productos con un index-only scan, sin pasar por product_variants.
--    Lo mantienen los triggers de abajo; la aplicación nunca lo escribe.
ALTER TABLE "offers" ADD COLUMN "product_id" uuid;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "products_name_unaccent_trgm_idx" ON "products" USING gin (public.immutable_unaccent(lower("canonical_name")) gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "offers_product_listing_idx" ON "offers" USING btree ("product_id","merchant_id","price","last_seen_at","availability","currency","list_price","id","variant_id");--> statement-breakpoint
-- La oferta toma el producto de su variante al insertarse o al cambiar de variante (incluido el
-- SET NULL cuando se borra la variante). Escribir product_id a mano no tiene efecto.
CREATE FUNCTION "offers_sync_product_id"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.product_id := (SELECT v.product_id FROM product_variants v WHERE v.id = NEW.variant_id);
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER "offers_sync_product_id" BEFORE INSERT OR UPDATE OF "variant_id", "product_id" ON "offers"
  FOR EACH ROW EXECUTE FUNCTION "offers_sync_product_id"();--> statement-breakpoint
-- Si una variante pasa a otro producto (fusión de fichas), sus ofertas la siguen.
CREATE FUNCTION "product_variants_sync_offers"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE offers SET product_id = NEW.product_id WHERE variant_id = NEW.id;
  RETURN NULL;
END
$$;--> statement-breakpoint
CREATE TRIGGER "product_variants_sync_offers" AFTER UPDATE OF "product_id" ON "product_variants"
  FOR EACH ROW WHEN (OLD.product_id IS DISTINCT FROM NEW.product_id)
  EXECUTE FUNCTION "product_variants_sync_offers"();--> statement-breakpoint
UPDATE "offers" o SET "product_id" = v."product_id" FROM "product_variants" v WHERE v."id" = o."variant_id";
