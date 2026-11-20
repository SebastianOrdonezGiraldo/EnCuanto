/**
 * Módulo `matching` (§8.2): escribe `offers.variant_id`, `match_status` y `match_confidence`, y
 * es dueño de `match_reviews`. En H2 solo expone la asignación conocida que usa el seed; el
 * algoritmo llega en H3.
 */
export { assignVariants, type VariantAssignment } from './assign.service';
