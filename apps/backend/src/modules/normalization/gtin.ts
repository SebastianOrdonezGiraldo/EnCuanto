const VALID_LENGTHS = new Set([8, 12, 13, 14]);

/**
 * Valida un GTIN (EAN‑8, UPC‑A/GTIN‑12, EAN‑13, GTIN‑14) con su dígito de control (§8.1.5).
 * Acepta espacios y guiones entre dígitos. Devuelve el GTIN en 14 dígitos (con ceros a la
 * izquierda), para que el mismo producto con UPC‑12 y EAN‑13 coincida, o `null` si no es válido.
 */
export function normalizeGtin(input: string | number | null | undefined): string | null {
  if (input === null || input === undefined) return null;
  const digits = String(input).trim().replace(/[\s-]/g, '');
  if (!/^\d+$/.test(digits) || !VALID_LENGTHS.has(digits.length)) return null;
  const padded = digits.padStart(14, '0');
  if (/^0+$/.test(padded)) return null;
  return checkDigit(padded.slice(0, 13)) === Number(padded[13]) ? padded : null;
}

/** Dígito de control GS1 de los 13 primeros dígitos de un GTIN‑14. */
export function checkDigit(body: string): number {
  let sum = 0;
  // De derecha a izquierda, pesos 3, 1, 3, 1…
  for (let i = 0; i < body.length; i++) {
    const digit = Number(body[body.length - 1 - i]);
    sum += digit * (i % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10;
}
