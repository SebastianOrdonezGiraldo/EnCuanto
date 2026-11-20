-- Búsqueda (H2, §8.3): trigramas sobre el nombre sin tildes ni mayúsculas, igual que la consulta.
CREATE INDEX "products_name_unaccent_trgm_idx" ON "products" USING gin (public.immutable_unaccent(lower("canonical_name")) gin_trgm_ops);
