# ADR 0001: Nombre y marca del producto

- **Estado:** Aceptada
- **Fecha:** 2026-11-19
- **Decide:** el usuario (decisión D2 de §14 del documento maestro)
- **Reemplaza:** el nombre provisional "Comparador"

## Contexto

El documento maestro deja abierta la decisión D2 (nombre y marca). Restricciones:

- Identidad propia, sin nada parecido a la referencia de mercado: ni nombre, ni colores, ni textos, ni assets (§4.2 y §11).
- Público colombiano, en español.
- Accesibilidad: contraste AA (§11).
- El diferencial del producto es la honestidad del precio: ofertas agrupadas por producto, descuentos validados con historial y frescura visible (`last_seen_at`).

## Decisión

El producto se llama **¿EnCuánto?**

Es la pregunta que hace cualquier persona en Colombia antes de comprar ("¿en cuánto está?", "¿en cuánto me lo deja?"). El nombre es la pregunta y el producto es la respuesta: en cuánto está ese producto en cada tienda, y si el descuento es real.

### Escritura del nombre

| Uso | Forma |
|---|---|
| Logo y momentos de marca | **¿EnCuánto?** (con signos de interrogación y tilde) |
| Texto corrido | **EnCuánto** (con tilde, sin signos: "Busca en EnCuánto") |
| Identificadores técnicos, slugs, paquetes, repositorio, correo | `encuanto` (minúsculas, sin tilde) |
| Título de página | `{página} · EnCuánto` |

Nunca "Encuanto", "EN CUANTO" ni "En Cuánto" separado.

### Lema

Principal (elegido por el usuario): **"Todas las tiendas. Un solo precio: el más bajo."**
Secundario, para la sección de ofertas: **"Aquí los descuentos no echan cuento."**

El lema promete el precio más bajo **entre las tiendas que comparamos**. Los textos legales (`/terminos`) deben aclarar ese alcance y que el precio puede cambiar en la tienda (ver §8.5, frescura).

Descartados: "Pregunta antes de pagar" (demasiado suave), "Ni un peso de más", "Que no te metan el dedo en la boca", "Paga lo que es, no lo que te dicen".

### Paleta

Base clara (crema) con verde esmeralda como primario, un guiño a Colombia sin usar la bandera. El amarillo se reserva para resaltar el mejor precio. El tema principal es claro; la referencia usa un tema casi negro (`#06080F`), así que nuestro modo oscuro usa un azul tinta distinto y es secundario.

| Rol | Token | Hex | Uso |
|---|---|---|---|
| Primario | `brand-600` | `#0B6E4F` | Botones, enlaces, logo |
| Primario suave | `brand-50` | `#E8F3EE` | Fondos de chips, insignia "descuento verificado" |
| Tinta | `ink-900` | `#14213D` | Texto principal, precios |
| Texto secundario | `ink-500` | `#5B6475` | Metadatos, "verificado hace 2 h" |
| Fondo | `paper` | `#FBF8F1` | Fondo de página |
| Superficie | `white` | `#FFFFFF` | Tarjetas |
| Mejor precio | `maiz-400` | `#FFC845` | Etiqueta del mejor precio (siempre con texto `ink-900` encima) |
| Alerta / precio sospechoso | `error-700` | `#B42318` | Errores, "descuento no verificado" |
| Aviso | `warn-700` | `#9A5B00` | "El precio puede haber cambiado" (24–72 h) |
| Fondo modo oscuro | `night` | `#101826` | Fondo en modo oscuro |
| Primario modo oscuro | `brand-300` | `#3DD9A0` | Enlaces y botones en modo oscuro |

Contrastes verificados (WCAG 2.1, mínimo AA = 4,5:1 para texto normal):

| Combinación | Ratio |
|---|---|
| `#14213D` sobre `#FBF8F1` | 15,1:1 |
| `#0B6E4F` sobre `#FFFFFF` | 6,3:1 |
| `#0B6E4F` sobre `#FBF8F1` | 5,9:1 |
| `#FFFFFF` sobre `#0B6E4F` (texto de botón) | 6,3:1 |
| `#5B6475` sobre `#FBF8F1` | 5,6:1 |
| `#14213D` sobre `#FFC845` | 10,3:1 |
| `#14213D` sobre `#E8F3EE` | 14,1:1 |
| `#B42318` sobre `#FFFFFF` | 6,6:1 |
| `#9A5B00` sobre `#FFFFFF` | 5,4:1 |
| `#E6EAF2` sobre `#101826` (modo oscuro) | 14,8:1 |
| `#3DD9A0` sobre `#101826` | 9,9:1 |
| `#FFC845` sobre `#101826` | 11,5:1 |

Regla: el color nunca es la única señal. "Descuento verificado" lleva icono y texto, no solo verde.

### Tipografía

Ambas en Google Fonts, gratuitas (SIL OFL), cargadas con `next/font` (sin peticiones a terceros en tiempo de ejecución).

- **Titulares y logo:** *Bricolage Grotesque* (600–800). Tiene carácter y buena lectura en tamaños grandes.
- **Interfaz y cuerpo:** *Inter* (400–600), con `font-variant-numeric: tabular-nums` en precios para que las cifras se alineen en las listas de ofertas.
- **Formato de precios:** `Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })` → `$ 1.899.900`.

### Tono de voz

Somos el amigo que siempre sabe en cuánto está todo y no se deja meter cuentos.

1. **Claro antes que gracioso.** El humor se permite en estados vacíos y mensajes menores, nunca cuando hablamos de precios o del dinero de alguien.
2. **Honesto.** Decimos lo que sabemos y lo que no: "La tienda dice −40 %, pero aún no tenemos historial para confirmarlo."
3. **Cercano, colombiano neutro, de "tú".** Sin regionalismos fuertes ni jerga que excluya.
4. **Sin gritos.** Nada de MAYÚSCULAS, "¡¡OFERTÓN!!" ni urgencia falsa ("¡solo hoy!") si no la confirma la tienda.

| Situación | Sí | No |
|---|---|---|
| Resultado | "Desde $ 1.899.900 en 4 tiendas" | "¡¡PRECIAZO INCREÍBLE!!" |
| Descuento validado | "Descuento verificado: 18 % por debajo de su precio de los últimos 30 días" | "¡Súper descuento!" |
| Descuento sin historial | "Descuento informado por la tienda" | (mostrarlo igual que uno verificado) |
| Búsqueda sin resultados | "No encontramos nada para «xyz». Prueba con otras palabras o con la marca." | Rellenar con productos irrelevantes |
| Precio viejo (24–72 h) | "Verificado hace 30 h; puede haber cambiado" | (ocultarlo) |
| Alerta por correo | "Bajó: la Nevera X ahora está en $ 1.749.900 en Tienda A" | "¡No te lo pierdas!" |

### Logo

El usuario eligió la dirección **A · Etiqueta** entre las cuatro de `docs/marca/logo-direcciones.png`. Antes había descartado un primer boceto, un wordmark con la tilde convertida en flecha.

- **Isotipo:** una etiqueta de precio en `brand-600` con su agujero y "$?" en blanco. Une la etiqueta (precio) con la pregunta (comparar).
- **Wordmark:** "¿en cuánto?" en minúscula, Bricolage Grotesque 800, con espaciado de −2,8 %. El texto va en `ink-900` y los signos ¿ ? en `brand-600`.
- **Modo oscuro:** etiqueta y signos en `brand-300`, texto `#F3F1EA` y "$?" en `night`.
- **Favicon:** solo "$" dentro de la etiqueta, porque "$?" no se lee a 16 px.
- **Zona de respeto:** alrededor del logo, como mínimo la altura de la "n". **Tamaño mínimo:** 96 px de ancho para el logo horizontal y 16 px para el favicon.

Archivos (los textos están convertidos a trazos, así que no dependen de la fuente instalada), en `docs/marca/logo/`:
`logo-claro.svg/png`, `logo-oscuro.svg/png`, `isotipo.svg`, `isotipo-oscuro.svg`, `app-icon.svg`, `app-icon-512.png`, `app-icon-192.png`, `apple-touch-icon.png` (180), `favicon.svg`, `favicon-32.png`, `favicon-16.png`.
En Next.js van a `apps/web/app/` (`icon.svg`, `apple-icon.png`) y a `apps/web/public/brand/`.

Nota: en el logo se escribe "¿en cuánto?" en minúscula. En texto corrido se mantiene "EnCuánto" (ver tabla de escritura).

## Alternativas consideradas

| Opción | Por qué no |
|---|---|
| "Comparador" (provisional) | Genérico, no registrable como marca, no se recuerda |
| Preciclaro | Propuesta inicial; al usuario no le convenció |
| Cotejito | Cálido, pero el diminutivo resta seriedad y "cotejo" es poco usado |
| Platicómetro | Memorable, pero largo y con tilde |
| Vitrinero / Vitrinear | Demasiado cerca de *Vitrinea*, app colombiana de compras existente |
| Nombres con "mirar", "pillar" u "ojo" | Demasiado cerca de la referencia |
| Cotejo, Cuentaclara, Preciazo, Tantico, Kuanto, Lukazo, Plataclara | Dominios .com y .co ya registrados |

## Consecuencias

- Renombrar el repositorio y el paquete raíz de `comparador` a `encuanto` antes de H0 (o usar `encuanto` desde el inicio).
- Los tokens de la paleta van en la configuración de Tailwind (`theme.extend.colors`) y se usan **solo** por nombre de token, nunca hex sueltos en componentes.
- `encuanto.com` está registrado por un tercero desde 2006. El despliegue inicial será gratuito y sin dominio propio; la plataforma está abierta (no necesariamente Vercel), ver [ADR 0002](0002-despliegue.md). Si más adelante se compra uno, a 19‑nov‑2026 están libres `encuantoapp.com`, `encuantoesta.com` y `encuanto.app`. La disponibilidad de `encuanto.co` no se pudo verificar.
- **Pendiente antes de lanzar públicamente:** búsqueda formal de antecedentes de la marca "EnCuánto" en la SIC (clases 35 y 42). En la web no se encontraron productos con ese nombre.
- El logo final y los íconos se producen a partir del concepto; ningún asset de la referencia entra al repositorio.
