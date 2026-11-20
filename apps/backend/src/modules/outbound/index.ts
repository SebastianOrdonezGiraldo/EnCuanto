/** Módulo `outbound` (CU‑4): `/go/:offerId`. Dueño de `outbound_clicks`. */
export { registerOutboundRoutes, type OutboundDeps } from './outbound.routes';
export { buildOutboundUrl, findOutboundTarget, recordClick } from './outbound.service';
