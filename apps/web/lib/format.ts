const cop = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  maximumFractionDigits: 0,
});

/** Formatea pesos colombianos enteros (ADR 0001): 1899900 → "$ 1.899.900". */
export function formatCOP(pesos: number): string {
  if (!Number.isSafeInteger(pesos)) throw new RangeError('El precio debe ser un entero de pesos');
  // Normaliza el espacio duro de Intl a un espacio normal para que sea predecible en texto y tests.
  return cop.format(pesos).replace(/\u00a0/g, ' ');
}
