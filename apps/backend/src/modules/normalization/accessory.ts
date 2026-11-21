/**
 * Términos que indican un accesorio (§8.3). La búsqueda no penaliza los accesorios si la
 * consulta contiene alguno; el matching (H3) no empareja automáticamente un título con uno de
 * estos términos con una ficha que no es de accesorio ("Funda para Celular X" no es el celular).
 */
export const ACCESSORY_TERMS: ReadonlySet<string> = new Set([
  'accesorio',
  'accesorios',
  'adaptador',
  'base',
  'cable',
  'cables',
  'cargador',
  'cargadores',
  'case',
  'correa',
  'estuche',
  'forro',
  'funda',
  'fundas',
  'mica',
  'protector',
  'repuesto',
  'soporte',
  'templado',
  'vidrio',
]);
