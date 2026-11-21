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

interface VariantAttributes {
  color?: string;
  storage_gb?: number;
  ram_gb?: number;
  capacity_l?: number;
  screen_in?: number;
  weight_kg?: number;
}

const decimal = (n: number) => String(n).replace('.', ',');
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Nombre de una variante a partir de sus atributos (§6): "256 GB · 8 GB RAM · Negro". Los
 * almacenamientos de 1024 GB o más se muestran en TB. Sin atributos: "Única".
 */
export function variantLabel(attributes: VariantAttributes): string {
  const parts: string[] = [];
  if (attributes.storage_gb !== undefined) {
    const gb = attributes.storage_gb;
    parts.push(gb >= 1024 && gb % 1024 === 0 ? `${gb / 1024} TB` : `${decimal(gb)} GB`);
  }
  if (attributes.ram_gb !== undefined) parts.push(`${decimal(attributes.ram_gb)} GB RAM`);
  if (attributes.screen_in !== undefined) parts.push(`${decimal(attributes.screen_in)}"`);
  if (attributes.capacity_l !== undefined) parts.push(`${decimal(attributes.capacity_l)} L`);
  if (attributes.weight_kg !== undefined) parts.push(`${decimal(attributes.weight_kg)} kg`);
  if (attributes.color) parts.push(capitalize(attributes.color));
  return parts.length > 0 ? parts.join(' · ') : 'Única';
}
