/**
 * HU-E11 — Lectura acotada de un cuerpo `multipart/form-data` (task_relos.md
 * D22). Los Route Handlers de Next 16 no tienen límite de body por defecto y
 * `request.formData()` carga todo en memoria; acá se corta antes:
 * - `Content-Length` mayor que el tope → rechazo sin leer el cuerpo;
 * - sin `Content-Length` (chunked) → se lee el stream y se corta al pasar el tope.
 * El tamaño real del archivo se valida igual después, en el servicio.
 */
import "server-only";

/** Margen para los encabezados y separadores del multipart (D22). */
export const MARGEN_MULTIPART_BYTES = 64 * 1024;

export type LecturaMultipart =
  | { ok: true; form: FormData }
  | { ok: false; motivo: "NO_MULTIPART" | "EXCEDE_TOPE" | "CUERPO_INVALIDO" };

export async function leerMultipartConTope(req: Request, topeBytes: number): Promise<LecturaMultipart> {
  const contentType = req.headers.get("content-type") ?? "";
  if (!/^multipart\/form-data\s*;/i.test(contentType)) return { ok: false, motivo: "NO_MULTIPART" };

  const largo = req.headers.get("content-length");
  if (largo !== null && Number(largo) > topeBytes) return { ok: false, motivo: "EXCEDE_TOPE" };

  const partes: Uint8Array[] = [];
  let total = 0;
  if (req.body) {
    const lector = req.body.getReader();
    for (;;) {
      const { done, value } = await lector.read();
      if (done) break;
      total += value.byteLength;
      if (total > topeBytes) {
        await lector.cancel().catch(() => {});
        return { ok: false, motivo: "EXCEDE_TOPE" };
      }
      partes.push(value);
    }
  }
  const cuerpo = new Uint8Array(total);
  let desde = 0;
  for (const parte of partes) {
    cuerpo.set(parte, desde);
    desde += parte.byteLength;
  }

  try {
    const form = await new Response(cuerpo, { headers: { "content-type": contentType } }).formData();
    return { ok: true, form };
  } catch {
    return { ok: false, motivo: "CUERPO_INVALIDO" };
  }
}

/** FormData → objeto plano; una clave repetida queda como array (el schema la rechaza). */
export function formDataAObjeto(form: FormData): Record<string, unknown> {
  const objeto: Record<string, unknown> = {};
  for (const clave of new Set(form.keys())) {
    const valores = form.getAll(clave);
    objeto[clave] = valores.length === 1 ? valores[0] : valores;
  }
  return objeto;
}
