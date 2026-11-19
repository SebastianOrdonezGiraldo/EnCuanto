/** Precio máximo aceptado en COP (100 mil millones): por encima es casi seguro un error de la fuente. */
export const MAX_PRICE_COP = 100_000_000_000;

/**
 * Convierte un precio a pesos COP enteros (§8.1.6). Acepta números y textos como
 * `"$1.899.900"`, `"1899900.00 COP"`, `"1.899.900,50"` o `"COP 1,899,900"`.
 * Devuelve `null` si no es un entero positivo razonable.
 */
export function parsePriceCop(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  let value: number;
  if (typeof input === 'number') {
    value = input;
  } else {
    const cleaned = input.replace(/cop|col\$|\$|\s|\u00a0/gi, '');
    if (!/^\d[\d.,]*$/.test(cleaned)) return null;
    value = Number(toPlainDecimal(cleaned));
  }
  if (!Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  return rounded > 0 && rounded <= MAX_PRICE_COP ? rounded : null;
}

/**
 * Decide qué separador es decimal. Con punto y coma a la vez, el último es el decimal.
 * Con uno solo: si forma grupos de 3 dígitos (`1.899.900`) es de miles; si no, decimal (`1899900.00`).
 */
function toPlainDecimal(s: string): string {
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    const decimal = lastDot > lastComma ? '.' : ',';
    const thousands = decimal === '.' ? ',' : '.';
    return s.split(thousands).join('').replace(decimal, '.');
  }
  const sep = lastDot >= 0 ? '.' : lastComma >= 0 ? ',' : null;
  if (!sep) return s;
  const groups = s.split(sep);
  const isThousands = groups.length > 1 && groups.slice(1).every((g) => g.length === 3);
  if (isThousands) return groups.join('');
  return groups.length === 2 ? `${groups[0]}.${groups[1]}` : 'NaN';
}

/**
 * Normaliza el par precio / precio antes del descuento (§8.1.6).
 * `list_price` menor que `price` no tiene sentido: se descarta (queda `null`).
 */
export function normalizePrices(
  price: string | number | null | undefined,
  listPrice: string | number | null | undefined,
): { price: number; listPrice: number | null } | null {
  const p = parsePriceCop(price);
  if (p === null) return null;
  const lp = parsePriceCop(listPrice);
  return { price: p, listPrice: lp !== null && lp >= p ? lp : null };
}
