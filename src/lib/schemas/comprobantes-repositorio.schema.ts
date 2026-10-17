import { z } from "zod";

/**
 * Schemas Zod de HU-G3 — repositorio digital de comprobantes fiscales
 * (spec_modulo_G.md §9.5). Solo lectura: filtros del listado hidratados desde
 * la URL e `id` de path. Mismo patrón de paginación `page` / `page_size` que
 * `ingresos-web.schema.ts` (HU-G11).
 *
 * Sin alias `@/...` ni imports relativos: el test del repositorio carga este
 * módulo aislado. Por eso la validación de día calendario se repite acá en vez
 * de importar `fecha-negocio`; el servicio vuelve a validar con
 * `rangoDiasNegocio`, que es la fuente de verdad del rango.
 */

/** Valores de `TipoComprobanteVenta` (schema.prisma). */
export const TIPOS_COMPROBANTE_REPOSITORIO = ["FACTURA_A", "FACTURA_B", "TICKET", "NOTA_CREDITO"] as const;

/** Valores de `CanalVenta` (schema.prisma). */
export const CANALES_COMPROBANTE_REPOSITORIO = ["MOSTRADOR", "WEB"] as const;

/** Un parámetro de URL vacío (`?tipo=`) equivale a no filtrar. */
const opcional = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((valor) => (typeof valor === "string" && valor.trim() === "" ? undefined : valor), schema.optional());

const esDiaCalendario = (dia: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(dia) && new Date(`${dia}T00:00:00.000Z`).toISOString().slice(0, 10) === dia;

const DiaSchema = z.string().refine(esDiaCalendario, "La fecha debe tener formato AAAA-MM-DD y existir en el calendario");

/**
 * Filtros combinables del listado (G3-2). `cliente` es DNI (exacto, con o
 * sin puntos, espacios o guiones) o nombre (parcial, sin distinguir
 * mayúsculas). `fecha_desde` / `fecha_hasta` son días de Argentina, ambos
 * incluidos.
 */
export const FiltrosComprobantesSchema = z
  .object({
    cliente: opcional(z.string().trim().max(100, "El cliente no puede superar los 100 caracteres")),
    fecha_desde: opcional(DiaSchema),
    fecha_hasta: opcional(DiaSchema),
    tipo: opcional(z.enum(TIPOS_COMPROBANTE_REPOSITORIO)),
    canal: opcional(z.enum(CANALES_COMPROBANTE_REPOSITORIO)),
    page: z.coerce.number().int().positive().default(1),
    page_size: z.coerce.number().int().positive().max(100).default(25),
  })
  .refine((f) => !f.fecha_desde || !f.fecha_hasta || f.fecha_desde <= f.fecha_hasta, {
    message: "La fecha desde no puede ser posterior a la fecha hasta",
    path: ["fecha_hasta"],
  });
export type FiltrosComprobantesInput = z.infer<typeof FiltrosComprobantesSchema>;

/** `id` de un `ComprobanteFiscal` recibido por path param. */
export const ComprobanteRepositorioIdSchema = z
  .string()
  .uuid("El identificador del comprobante debe ser un UUID válido");

/** Valores de `?disposicion=` de la descarga del PDF (G3-3). */
export const DISPOSICIONES_PDF_COMPROBANTE = ["inline", "attachment"] as const;

/**
 * Query de `GET /api/tesoreria/comprobantes/[id]/pdf`. `inline` abre el PDF
 * en el navegador ("Ver PDF"); sin el parámetro, o con `attachment`, se
 * descarga. Un valor desconocido es un 400.
 */
export const PdfComprobanteQuerySchema = z.object({
  disposicion: opcional(z.enum(DISPOSICIONES_PDF_COMPROBANTE)),
});
export type PdfComprobanteQueryInput = z.infer<typeof PdfComprobanteQuerySchema>;
