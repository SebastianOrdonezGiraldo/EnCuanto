-- unaccent() es STABLE (depende del search_path), así que no se puede usar en columnas
-- generadas ni en índices. Este envoltorio fija el diccionario por esquema y es IMMUTABLE.
-- Lo usa products.search_tsv (§6) y la búsqueda de H2.
CREATE OR REPLACE FUNCTION public.immutable_unaccent(text)
  RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  RETURN public.unaccent('public.unaccent'::regdictionary, $1);
