/** Unidades que, pegadas a un número, son atributos y no modelos (`5000mah`, `120hz`, `256gb`). */
const UNIT_TOKEN =
  /^\d+(?:[.,]\d+)?(?:gb|tb|mb|l|lt|lts|litros?|pulgadas?|pulg|mah|w|hz|mp|mm|cm|kg|btu|rpm|ghz|v)$/;
/** Tecnologías y estándares que tienen letras y dígitos pero no identifican un producto. */
const STOPWORDS =
  /^(?:lp)?ddr\d+x?$|^wifi\d+e?$|^usb\d*(?:\.\d)?$|^bt\d+(?:\.\d)?$|^hdmi\d+(?:\.\d)?$|^i[3579]-?\d{4,5}[a-z]{0,2}$|^(?:rtx|gtx|rx)-?\d{3,4}(?:ti)?$/;

/**
 * Número de modelo (§8.1.4): token alfanumérico con letra y dígito, de longitud ≥ 4
 * (`SM-A566B`, `BCD205`), excluidos los atributos ya extraídos y las unidades.
 * Si hay varios candidatos se elige el más largo. Devuelve el modelo en mayúsculas o `null`.
 */
export function extractModelNumber(text: string, excluded: readonly string[] = []): string | null {
  let rest = text;
  for (const fragment of excluded) rest = rest.replace(fragment, ' ');

  let best: string | null = null;
  for (const raw of rest.split(/[\s,;:/()[\]{}|"'+]+/)) {
    const token = raw.replace(/^[-.]+|[-.]+$/g, '');
    if (token.replace(/-/g, '').length < 4) continue;
    if (!/^[a-z0-9-]+$/.test(token) || !/[a-z]/.test(token) || !/\d/.test(token)) continue;
    if (UNIT_TOKEN.test(token) || STOPWORDS.test(token)) continue;
    if (!best || token.length > best.length) best = token;
  }
  return best ? best.toUpperCase() : null;
}

/**
 * Token de especificación (unidad pegada a un número, como `5000mah` o `120hz`, o una tecnología
 * como `ddr5` o `wifi6`): tiene letras y dígitos pero no identifica el producto. Lo usa también
 * el matching (H3) para comparar los números que sí lo identifican.
 */
export function isSpecToken(token: string): boolean {
  return UNIT_TOKEN.test(token) || STOPWORDS.test(token);
}
