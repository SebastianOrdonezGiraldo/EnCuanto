/**
 * Descripción de un error apta para logs y para lo que se guarda fuera del proceso (BullMQ, §4).
 *
 * Los mensajes de los errores de infraestructura no son seguros: Drizzle escribe en el suyo la
 * consulta y sus parámetros (títulos, URLs con tokens, lo que traiga el feed) y postgres.js puede
 * incluir valores en `detail`. Aquí solo sale el tipo del error, su código (SQLSTATE o código de
 * sistema, como `ECONNREFUSED`) y los marcos de la pila, nunca el mensaje ni la causa.
 */
export interface SafeErrorInfo {
  err_type: string;
  err_code?: string;
}

const CODE = /^(?:[0-9A-Z]{5}|E[A-Z_]{2,30})$/;

function codeOf(error: unknown, depth = 0): string | undefined {
  if (!error || typeof error !== 'object' || depth > 3) return undefined;
  const code = (error as { code?: unknown }).code;
  if (typeof code === 'string' && CODE.test(code)) return code;
  return codeOf((error as { cause?: unknown }).cause, depth + 1);
}

export function safeErrorInfo(error: unknown): SafeErrorInfo {
  const type = error instanceof Error ? error.name : typeof error;
  const info: SafeErrorInfo = {
    err_type: type.replace(/[^A-Za-z0-9_]/g, '').slice(0, 40) || 'Error',
  };
  const code = codeOf(error);
  if (code) info.err_code = code;
  return info;
}

/** Mensaje corto sin datos: "DrizzleQueryError 23505". */
export function safeErrorMessage(error: unknown): string {
  const { err_type, err_code } = safeErrorInfo(error);
  return err_code ? `${err_type} ${err_code}` : err_type;
}

/** Solo los marcos de la pila ("at …"): la primera línea repite el mensaje. */
export function safeStack(error: unknown): string | undefined {
  if (!(error instanceof Error) || !error.stack) return undefined;
  const frames = error.stack.split('\n').filter((l) => /^\s+at\s/.test(l));
  return frames.length > 0 ? frames.slice(0, 15).join('\n') : undefined;
}
