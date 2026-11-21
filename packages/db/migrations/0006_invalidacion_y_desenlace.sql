-- Revisión de H3 (ronda 2).
--
-- 1. catalog_invalidations: invalidación de la caché del catálogo pendiente, escrita en la misma
--    transacción que la decisión de matching que la provoca (se reintenta si Redis falla). Su
--    generación sale de una secuencia que no se reinicia al borrar la fila.
-- 2. offers_reset_match: cuando la fuente cambia lo que identifica a una oferta (título, GTIN o
--    marca), deja de publicarse bajo su variante anterior (variant_id y product_id a nulo) hasta
--    que el matching la vuelva a decidir: su precio nuevo puede ser de otra configuración. Aplica
--    también a las decididas por una persona: la decisión se tomó con otros datos.
CREATE TABLE "catalog_invalidations" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"generation" bigserial NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE OR REPLACE FUNCTION "offers_reset_match"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.match_status := 'pending';
  NEW.match_confidence := NULL;
  NEW.match_level := NULL;
  -- Sin enlace hasta que se vuelva a decidir. product_id se pone a mano: el trigger que lo
  -- mantiene solo salta cuando el UPDATE nombra variant_id.
  NEW.variant_id := NULL;
  NEW.product_id := NULL;
  DELETE FROM match_reviews WHERE offer_id = NEW.id AND status = 'pending';
  RETURN NEW;
END
$$;--> statement-breakpoint
DROP TRIGGER "offers_reset_match" ON "offers";--> statement-breakpoint
CREATE TRIGGER "offers_reset_match" BEFORE UPDATE OF "title_raw", "gtin", "brand" ON "offers"
  FOR EACH ROW
  WHEN (OLD.title_raw IS DISTINCT FROM NEW.title_raw
        OR OLD.gtin IS DISTINCT FROM NEW.gtin
        OR OLD.brand IS DISTINCT FROM NEW.brand)
  EXECUTE FUNCTION "offers_reset_match"();
