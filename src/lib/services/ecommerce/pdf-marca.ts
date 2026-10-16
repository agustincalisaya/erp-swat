/**
 * @module pdf-marca
 * @description HU-B10 (spec_modulo_B.md §2.10) — identidad de SWAT
 * Indumentarias para los PDF que genera el sistema con `pdf-lib`: colores del
 * sistema, isotipo del login, datos del emisor, número fiscal visible y
 * helpers de texto alineado. Sin dependencias del proyecto: lo reutilizan el
 * comprobante fiscal (HU-E9/HU-G3) y el Libro de IVA (HU-G4).
 */
import { LineCapStyle, rgb, type Color, type PDFFont, type PDFPage } from "pdf-lib";

// ──────────────────────────────────────────────────────────────────────────────
// Colores — tokens del tema claro de src/app/globals.css (`:root`)
// ──────────────────────────────────────────────────────────────────────────────

/** Valor de cada token (`--<nombre>`); un test los compara con globals.css. */
export const TOKENS = {
  foreground: "#202521",
  "muted-foreground": "#626B63",
  border: "#D7DCD5",
  background: "#F4F5F3",
  secondary: "#E9EDE5",
  primary: "#46583D",
  sidebar: "#202521",
  "sidebar-foreground": "#E9EDE5",
  "sidebar-muted-foreground": "#AFB8AB",
  "sidebar-primary": "#A3B58C",
  "sidebar-accent": "#34452B",
  "sidebar-border": "#414A3D",
  warning: "#FEF3C7",
  "warning-foreground": "#92400E",
} as const;

function hex(valor: string): Color {
  return rgb(
    parseInt(valor.slice(1, 3), 16) / 255,
    parseInt(valor.slice(3, 5), 16) / 255,
    parseInt(valor.slice(5, 7), 16) / 255,
  );
}

export const COLORES = {
  tinta: hex(TOKENS.foreground),
  suave: hex(TOKENS["muted-foreground"]),
  borde: hex(TOKENS.border),
  fondo: hex(TOKENS.background),
  secundario: hex(TOKENS.secondary),
  primario: hex(TOKENS.primary),
  banda: hex(TOKENS.sidebar),
  bandaTexto: hex(TOKENS["sidebar-foreground"]),
  bandaSuave: hex(TOKENS["sidebar-muted-foreground"]),
  oliva: hex(TOKENS["sidebar-primary"]),
  acento: hex(TOKENS["sidebar-accent"]),
  acentoBorde: hex(TOKENS["sidebar-border"]),
  avisoFondo: hex(TOKENS.warning),
  avisoTexto: hex(TOKENS["warning-foreground"]),
  blanco: rgb(1, 1, 1),
} as const;

// ──────────────────────────────────────────────────────────────────────────────
// Emisor y número fiscal
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Copia de `CUIT_EMISOR_SIMULADO` de `comprobante-fiscal.service.ts:42`
 * (HU-B7), que no está exportada y no se modifica. Un test de fuente
 * (`pdf-marca.test.ts`) falla si las dos constantes divergen.
 */
export const CUIT_EMISOR_SIMULADO = "30000000007";

/** Punto de venta sustituto, el mismo del Libro de IVA (Backlog Sprint 5, HU-G4). */
export const PUNTO_VENTA = "00001";

/** `30000000007` → `30-00000000-7`. */
export function formatearCuit(cuit: string): string {
  return `${cuit.slice(0, 2)}-${cuit.slice(2, 10)}-${cuit.slice(10)}`;
}

/**
 * Datos del emisor que muestra el PDF. `domicilio` y `bajada` son
 * valores de ejemplo, editables aquí: ninguna fuente del proyecto define el
 * domicilio fiscal del emisor (spec_modulo_B.md §2.10).
 */
export const EMISOR = {
  razon_social: "SWAT Indumentarias",
  cuit: formatearCuit(CUIT_EMISOR_SIMULADO),
  domicilio: "Sucursal Salta",
  bajada: "Indumentaria táctica",
} as const;

/**
 * Número fiscal visible `00001-<8 dígitos>`: los últimos 8 dígitos del número
 * de venta (Backlog Sprint 5, HU-G4; prevalece sobre spec G4-5). Por ejemplo,
 * `V-2026-000001` → `00001-26000001`. La NC usa el número de su venta original.
 * Devuelve `null` si el número no tiene al menos 8 dígitos: el llamador decide
 * qué mostrar, nunca se inventa un número.
 */
export function numeroFiscalVisible(numeroVenta: string): string | null {
  const digitos = numeroVenta.replace(/\D/g, "");
  return digitos.length >= 8 ? `${PUNTO_VENTA}-${digitos.slice(-8)}` : null;
}

// ──────────────────────────────────────────────────────────────────────────────
// Isotipo
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Paths del ícono `shield-check` de lucide (viewBox 24 × 24, trazo 2, extremos
 * redondeados), el mismo `ShieldCheck` que muestra el login.
 * Lucide — ISC License, Copyright (c) for portions of Lucide are held by
 * Cole Bemis 2013-2022 as part of Feather (MIT); all other copyright (c) for
 * Lucide are held by Lucide Contributors 2022.
 */
const SHIELD_CHECK = [
  "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z",
  "m9 12 2 2 4-4",
] as const;

/**
 * Isotipo del login: `ShieldCheck` en `--sidebar-primary` dentro del recuadro
 * redondeado `--sidebar-accent` con borde `--sidebar-border`. `(x, yTop)` es
 * la esquina superior izquierda y `lado` el tamaño del recuadro.
 */
export function dibujarIsotipo(pagina: PDFPage, x: number, yTop: number, lado: number): void {
  const r = lado * 0.24;
  const recuadro =
    `M${r} 0 H${lado - r} A${r} ${r} 0 0 1 ${lado} ${r} V${lado - r} A${r} ${r} 0 0 1 ${lado - r} ${lado} ` +
    `H${r} A${r} ${r} 0 0 1 0 ${lado - r} V${r} A${r} ${r} 0 0 1 ${r} 0 Z`;
  pagina.drawSvgPath(recuadro, { x, y: yTop, color: COLORES.acento, borderColor: COLORES.acentoBorde, borderWidth: 0.8 });
  const escala = (lado * 0.66) / 24;
  const margen = (lado - 24 * escala) / 2;
  for (const path of SHIELD_CHECK) {
    pagina.drawSvgPath(path, {
      x: x + margen,
      y: yTop - margen,
      scale: escala,
      borderColor: COLORES.oliva,
      borderWidth: 2,
      borderLineCap: LineCapStyle.Round,
    });
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Texto
// ──────────────────────────────────────────────────────────────────────────────

export interface EstiloTexto {
  size: number;
  font: PDFFont;
  color: Color;
}

/** Dibuja `texto` con su borde derecho en `xDerecha`. */
export function textoDerecha(pagina: PDFPage, texto: string, xDerecha: number, y: number, estilo: EstiloTexto): void {
  pagina.drawText(texto, { ...estilo, x: xDerecha - estilo.font.widthOfTextAtSize(texto, estilo.size), y });
}

/** Dibuja `texto` centrado en `xCentro`. */
export function textoCentrado(pagina: PDFPage, texto: string, xCentro: number, y: number, estilo: EstiloTexto): void {
  pagina.drawText(texto, { ...estilo, x: xCentro - estilo.font.widthOfTextAtSize(texto, estilo.size) / 2, y });
}

/** Recorta `texto` con «...» para que no supere `anchoMaximo`. */
export function recortarTexto(texto: string, anchoMaximo: number, estilo: Pick<EstiloTexto, "size" | "font">): string {
  if (estilo.font.widthOfTextAtSize(texto, estilo.size) <= anchoMaximo) return texto;
  let recorte = texto;
  while (recorte.length > 0 && estilo.font.widthOfTextAtSize(`${recorte}...`, estilo.size) > anchoMaximo) {
    recorte = recorte.slice(0, -1);
  }
  return `${recorte.trimEnd()}...`;
}
