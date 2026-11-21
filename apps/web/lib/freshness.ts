/**
 * "Precio verificado hace X" (§4.6): toda afirmación sobre precio muestra su frescura.
 * Se calcula al renderizar en el servidor.
 */
export function verifiedAgo(lastSeenAt: string, now: Date = new Date()): string {
  const minutes = Math.max(
    0,
    Math.floor((now.getTime() - new Date(lastSeenAt).getTime()) / 60_000),
  );
  if (minutes < 60) return 'hace menos de una hora';
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? 'hace 1 hora' : `hace ${hours} horas`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'hace 1 día' : `hace ${days} días`;
}
