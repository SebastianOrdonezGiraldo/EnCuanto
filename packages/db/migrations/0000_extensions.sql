-- Extensiones para búsqueda en español (§5): trigramas y eliminación de tildes.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS unaccent;
