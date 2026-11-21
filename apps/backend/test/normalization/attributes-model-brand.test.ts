import { describe, expect, it } from 'vitest';
import {
  buildBrandDictionary,
  extractAttributes,
  extractModelNumber,
  normalizeBrand,
  normalizeOffer,
  normalizeText,
} from '../../src/modules/normalization/index';

const attrs = (title: string) => extractAttributes(normalizeText(title)).attributes;

describe('extractAttributes (§8.1.3)', () => {
  it.each([
    ['Celular Galaxy A56 256GB 8GB RAM Verde', { storage_gb: 256, ram_gb: 8, color: 'verde' }],
    ['Celular Nubrix N12 128 GB 4 GB de RAM Negro', { storage_gb: 128, ram_gb: 4, color: 'negro' }],
    ['Smartphone X 8+256GB Azul', { storage_gb: 256, ram_gb: 8, color: 'azul' }],
    ['Smartphone X 8GB+128GB Plateado', { storage_gb: 128, ram_gb: 8, color: 'plata' }],
    ['Celular Y 256GB/8GB Gris', { storage_gb: 256, ram_gb: 8, color: 'gris' }],
    ['Portátil 15.6" 16GB RAM 512GB SSD', { storage_gb: 512, ram_gb: 16, screen_in: 15.6 }],
    ['Portátil Ultra 1TB SSD 16GB', { storage_gb: 1024, ram_gb: 16 }],
    ['Memoria USB 64GB', { storage_gb: 64 }],
    ['Memoria RAM DDR4 16GB', { ram_gb: 16 }],
    ['Memoria RAM 8GB DDR5 SODIMM', { ram_gb: 8 }],
    ['Memoria DDR5 32GB 5600MHz', { ram_gb: 32 }],
    ['Portátil 16GB DDR5 512GB SSD', { ram_gb: 16, storage_gb: 512 }],
    ['Portátil 16GB RAM 512GB DDR5', { ram_gb: 16, storage_gb: 512 }],
    ['Disco SSD 1TB NVMe', { storage_gb: 1024 }],
    ['Memoria microSD 128GB', { storage_gb: 128 }],
    ['Nevera No Frost 300 Litros Gris', { capacity_l: 300, color: 'gris' }],
    ['Nevecón 520 L Plata', { capacity_l: 520, color: 'plata' }],
    // H3: los kilos también se extraen (weight_kg).
    ['Lavadora Carga Superior 19 Kg 45 Lts', { capacity_l: 45, weight_kg: 19 }],
    ['Licuadora 1,5 L Roja', { capacity_l: 1.5, color: 'rojo' }],
    ['Olla arrocera 1.8lt', { capacity_l: 1.8 }],
    ['Televisor 55" 4K UHD', { screen_in: 55 }],
    ['Televisor 65 pulgadas QLED Negro', { screen_in: 65, color: 'negro' }],
    ['Monitor 27 Pulg. IPS', { screen_in: 27 }],
    ['Tablet 10,1” 64GB Rosada', { screen_in: 10.1, storage_gb: 64, color: 'rosado' }],
    ['Audífonos inalámbricos Blancos', {}], // "blancos" (plural) no está en la lista cerrada
    ['Audífonos inalámbricos Blanca', { color: 'blanco' }],
    ['Reloj inteligente Midnight Black', { color: 'negro' }],
    ['Cafetera de goteo', {}],
  ])('%j', (title, expected) => {
    expect(attrs(title)).toEqual(expected);
  });

  it('no confunde la RAM con el almacenamiento cuando aparece primero', () => {
    expect(attrs('Celular 8GB RAM 256GB')).toEqual({ ram_gb: 8, storage_gb: 256 });
  });

  it('ignora pulgadas fuera de rango', () => {
    expect(attrs('Cable 300" de largo')).toEqual({});
  });
});

describe('extractModelNumber (§8.1.4)', () => {
  const model = (title: string) => {
    const text = normalizeText(title);
    return extractModelNumber(text, extractAttributes(text).matched);
  };

  it.each([
    ['Samsung Galaxy A56 SM-A566B 256GB Verde', 'SM-A566B'],
    ['Nevera Haceb BCD205 205 L', 'BCD205'],
    ['Televisor Kalora 55" 4K 55KU7000 Smart TV', '55KU7000'],
    ['Celular SM-A566B/DS 8GB RAM', 'SM-A566B'],
    ['Portátil 16GB RAM 512GB DDR5 Wifi6', null], // atributos y estándares no son modelo
    ['Celular Nubrix N12 Pro 5000mAh 120Hz', null], // N12 tiene 3 caracteres
    ['Lavadora WA19T6260BY 19 Kg', 'WA19T6260BY'],
    ['Cafetera de goteo', null],
  ])('%j → %j', (title, expected) => {
    expect(model(title)).toBe(expected);
  });
});

describe('normalizeBrand (§8.1.2)', () => {
  const dict = buildBrandDictionary(['Samsung', 'LG', 'Kalora', 'Nubrix Tech', 'HP']);

  it.each([
    ['LG Electronics', 'lg'],
    ['  SAMSUNG ', 'samsung'],
    ['Samsung Electronics', 'samsung'],
    ['Hewlett-Packard', 'hp'],
    ['Kalora S.A.S.', 'kalora'],
    ['Marca Desconocida', 'marca desconocida'],
  ])('marca de la fuente %j → %j', (raw, expected) => {
    expect(normalizeBrand(raw, '', dict)).toBe(expected);
  });

  it.each([
    ['televisor kalora 55" 4k', 'kalora'],
    ['celular nubrix tech n12', 'nubrix tech'],
    ['monitor lg electronics 27"', 'lg'],
    ['cable generico usb', null],
    ['samsunglg sin espacios', null], // solo palabras completas
  ])('marca desde el título %j → %j', (title, expected) => {
    expect(normalizeBrand(null, title, dict)).toBe(expected);
  });
});

describe('normalizeOffer', () => {
  const dict = buildBrandDictionary(['Nubrix']);

  it('normaliza una oferta completa', () => {
    const result = normalizeOffer(
      {
        title: 'Celular Nubrix NX-1290 256GB 8GB RAM Azul',
        gtin: '7702001041015',
        price: '$1.299.900',
        listPrice: '1.599.900',
      },
      dict,
    );
    expect(result).toEqual({
      ok: true,
      value: {
        titleNormalized: 'celular nubrix nx-1290 256gb 8gb ram azul',
        brand: 'nubrix',
        modelNumber: 'NX-1290',
        gtin: '07702001041015',
        attributes: { storage_gb: 256, ram_gb: 8, color: 'azul' },
        price: 1299900,
        listPrice: 1599900,
      },
    });
  });

  it('descarta un GTIN inválido sin rechazar la oferta', () => {
    const result = normalizeOffer({ title: 'Cafetera', gtin: '123', price: 99900 }, dict);
    expect(result.ok && result.value.gtin).toBeNull();
  });

  it('rechaza precio inválido y título vacío', () => {
    expect(normalizeOffer({ title: 'Cafetera', price: 0 }, dict)).toEqual({
      ok: false,
      reason: 'invalid_price',
    });
    expect(normalizeOffer({ title: '   ', price: 1000 }, dict)).toEqual({
      ok: false,
      reason: 'empty_title',
    });
  });
});

describe('ampliaciones de H3 (matching)', () => {
  it.each([
    ['Lavadora Carga Superior 17 Kg Gris', { weight_kg: 17, color: 'gris' }],
    ['LAVADORA 19KG BLANCA', { weight_kg: 19, color: 'blanco' }],
    ['Lavadora 22 kilos', { weight_kg: 22 }],
    ['Secadora 10,5 kg', { weight_kg: 10.5 }],
  ])('kilos: %j', (title, expected) => {
    expect(extractAttributes(normalizeText(title)).attributes).toEqual(expected);
  });

  it('el color reconocido queda entre los fragmentos (el matching lo quita del título)', () => {
    expect(extractAttributes(normalizeText('Celular X 128GB Negro')).matched).toContain('negro');
  });

  it.each([
    ['Portátil Vireo Book 14 Core i5-1235U 8GB RAM VR-B14', 'VR-B14'],
    ['Portátil Gamer Vireo RTX4060 VR-G15', 'VR-G15'],
  ])('el procesador o la tarjeta gráfica no son el modelo: %j', (title, expected) => {
    const text = normalizeText(title);
    expect(extractModelNumber(text, extractAttributes(text).matched)).toBe(expected);
  });
});
