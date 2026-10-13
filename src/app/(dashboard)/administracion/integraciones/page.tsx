/**
 * @component IntegracionesPage
 * @description HU-F1 (spec_modulo_F.md §2.1.1–§2.1.5, task R4.6) — Panel de
 * administración del Conector de Mercado Pago. Server Component: resuelve
 * sesión + permiso `integraciones:administrar_conector`, lista los Conectores
 * con credenciales SIEMPRE enmascaradas (`listarConectores()`), y ofrece alta
 * (form de 5 campos), health-check, bitácora paginada y baja con motivo.
 * Ninguna credencial en claro se renderiza. Paleta azul de Tailwind.
 */
import Link from "next/link";
import { getServerSession } from "@/lib/auth/session";
import { usuarioTienePermiso } from "@/lib/auth/with-permission";
import { BitacoraQuerySchema } from "@/lib/schemas/integraciones.schema";
import {
  listarBitacora,
  listarConectores,
  PERMISO_ADMINISTRAR_CONECTOR,
  type ListadoBitacora,
} from "@/lib/services/integraciones/conector-pago.service";
import {
  crearConectorMercadoPago,
  darDeBajaConectorAction,
  ejecutarHealthCheckAction,
} from "./actions";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const MENSAJES_ERROR: Record<string, string> = {
  UNAUTHORIZED: "Sesión requerida.",
  FORBIDDEN: "No tenés el permiso para administrar el Conector.",
  VALIDATION_ERROR: "Los datos enviados no son válidos.",
  CONECTOR_ACTIVO_EXISTENTE: "Ya existe un Conector ACTIVO en ese entorno.",
  CONECTOR_NO_ENCONTRADO: "El Conector indicado no existe o fue dado de baja.",
  HEALTH_CHECK_FALLIDO: "Mercado Pago rechazó las credenciales del Conector.",
  HEALTH_CHECK_REQUERIDO:
    "En PRODUCCION se requiere un segundo health-check exitoso para activar.",
  INTERNAL_ERROR: "Error interno. Intentá nuevamente.",
};

const MENSAJES_OK: Record<string, string> = {
  creado: "Conector creado (INACTIVO). Ejecutá el health-check para activarlo.",
  health_check: "Health-check exitoso.",
  baja: "Conector dado de baja.",
};

function primerValor(valor: string | string[] | undefined): string | undefined {
  return Array.isArray(valor) ? valor[0] : valor;
}

const INPUT_CLASS =
  "w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none";
const LABEL_CLASS = "block text-xs font-semibold uppercase tracking-wide text-primary";

export default async function IntegracionesPage({ searchParams }: PageProps) {
  const session = await getServerSession();
  const autorizado = session
    ? await usuarioTienePermiso(session.userId, PERMISO_ADMINISTRAR_CONECTOR)
    : false;

  const params = await searchParams;
  const ok = primerValor(params.ok);
  const error = primerValor(params.error);
  const conectorSeleccionado = primerValor(params.conector);
  const pageParam = primerValor(params.page);

  const conectores = autorizado ? await listarConectores() : [];

  let bitacora: ListadoBitacora | null = null;
  if (autorizado && conectorSeleccionado) {
    const query = BitacoraQuerySchema.safeParse({ page: pageParam });
    const filtros = query.success ? query.data : BitacoraQuerySchema.parse({});
    try {
      bitacora = await listarBitacora(conectorSeleccionado, filtros);
    } catch {
      bitacora = null;
    }
  }

  return (
    <main className="mx-auto max-w-5xl space-y-8 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold text-foreground">Conector de Mercado Pago</h1>
        <p className="text-sm text-primary">
          Alta, health-check, bitácora y baja del Conector. Las credenciales se muestran siempre
          enmascaradas.
        </p>
      </header>

      {ok && MENSAJES_OK[ok] && (
        <p
          role="status"
          className="rounded-md border border-border bg-selected px-4 py-2 text-sm text-selected-foreground"
        >
          {MENSAJES_OK[ok]}
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="rounded-md border border-border bg-selected px-4 py-2 text-sm text-selected-foreground"
        >
          {MENSAJES_ERROR[error] ?? `Error: ${error}`}
        </p>
      )}

      {!autorizado ? (
        <p className="rounded-xl border border-border bg-selected p-6 text-sm text-selected-foreground">
          No tenés el permiso <code className="font-mono">integraciones:administrar_conector</code>{" "}
          para ver esta pantalla.
        </p>
      ) : (
        <>
          {/* ── Alta ─────────────────────────────────────────────────────── */}
          <section className="space-y-4 rounded-xl border border-border bg-selected p-6">
            <h2 className="text-lg font-semibold text-foreground">Nuevo Conector</h2>
            <form action={crearConectorMercadoPago} className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <label className={LABEL_CLASS} htmlFor="nombre">
                  Nombre
                </label>
                <input id="nombre" name="nombre" required minLength={2} className={INPUT_CLASS} />
              </div>
              <div className="space-y-1">
                <label className={LABEL_CLASS} htmlFor="entorno">
                  Entorno
                </label>
                <select id="entorno" name="entorno" required className={INPUT_CLASS} defaultValue="SANDBOX">
                  <option value="SANDBOX">SANDBOX</option>
                  <option value="PRODUCCION">PRODUCCION</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className={LABEL_CLASS} htmlFor="access_token">
                  Access token
                </label>
                <input id="access_token" name="access_token" required type="password" className={INPUT_CLASS} />
              </div>
              <div className="space-y-1">
                <label className={LABEL_CLASS} htmlFor="public_key">
                  Public key
                </label>
                <input id="public_key" name="public_key" required type="password" className={INPUT_CLASS} />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <label className={LABEL_CLASS} htmlFor="webhook_secret">
                  Webhook secret
                </label>
                <input id="webhook_secret" name="webhook_secret" required type="password" className={INPUT_CLASS} />
              </div>
              <div className="sm:col-span-2">
                <button
                  type="submit"
                  className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
                >
                  Crear Conector
                </button>
              </div>
            </form>
          </section>

          {/* ── Listado ──────────────────────────────────────────────────── */}
          <section className="space-y-4">
            <h2 className="text-lg font-semibold text-foreground">Conectores</h2>
            {conectores.length === 0 ? (
              <p className="rounded-xl border border-border bg-selected p-6 text-sm text-selected-foreground">
                Todavía no hay Conectores cargados.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-muted text-left text-xs uppercase tracking-wide text-selected-foreground">
                    <tr>
                      <th className="px-4 py-3">Nombre</th>
                      <th className="px-4 py-3">Entorno</th>
                      <th className="px-4 py-3">Estado</th>
                      <th className="px-4 py-3">Credenciales</th>
                      <th className="px-4 py-3">Último health-check</th>
                      <th className="px-4 py-3">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-blue-100">
                    {conectores.map((c) => (
                      <tr key={c.conector_id} className="align-top">
                        <td className="px-4 py-3 font-medium text-foreground">{c.nombre}</td>
                        <td className="px-4 py-3 text-primary">{c.entorno}</td>
                        <td className="px-4 py-3">
                          <span
                            className={
                              c.estado === "ACTIVO"
                                ? "rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground"
                                : "rounded-full bg-selected px-2 py-0.5 text-xs font-semibold text-selected-foreground"
                            }
                          >
                            {c.estado}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-primary">
                          <div>access: {c.access_token_enmascarado}</div>
                          <div>public: {c.public_key_enmascarada}</div>
                          <div>webhook: {c.webhook_secret_enmascarado}</div>
                        </td>
                        <td className="px-4 py-3 text-primary">
                          {c.ultimo_health_check_exitoso_at
                            ? c.ultimo_health_check_exitoso_at.toISOString()
                            : "—"}
                        </td>
                        <td className="space-y-2 px-4 py-3">
                          <form action={ejecutarHealthCheckAction}>
                            <input type="hidden" name="conector_id" value={c.conector_id} />
                            <button
                              type="submit"
                              className="rounded-md border border-border px-3 py-1 text-xs font-medium text-primary hover:bg-accent"
                            >
                              Health-check
                            </button>
                          </form>
                          <form action={darDeBajaConectorAction} className="flex items-center gap-2">
                            <input type="hidden" name="conector_id" value={c.conector_id} />
                            <input
                              name="deletion_reason"
                              required
                              placeholder="Motivo de baja"
                              className="w-32 rounded-md border border-input px-2 py-1 text-xs"
                            />
                            <button
                              type="submit"
                              className="rounded-md border border-border px-3 py-1 text-xs font-medium text-primary hover:bg-accent"
                            >
                              Dar de baja
                            </button>
                          </form>
                          <Link
                            href={`/administracion/integraciones?conector=${c.conector_id}&page=1`}
                            className="inline-block text-xs font-medium text-primary underline"
                          >
                            Ver bitácora
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* ── Bitácora ─────────────────────────────────────────────────── */}
          {conectorSeleccionado && (
            <section className="space-y-4">
              <h2 className="text-lg font-semibold text-foreground">Bitácora de invocaciones</h2>
              {!bitacora || bitacora.items.length === 0 ? (
                <p className="rounded-xl border border-border bg-selected p-6 text-sm text-selected-foreground">
                  Sin invocaciones registradas.
                </p>
              ) : (
                <>
                  <div className="overflow-x-auto rounded-xl border border-border">
                    <table className="w-full text-sm">
                      <thead className="bg-muted text-left text-xs uppercase tracking-wide text-selected-foreground">
                        <tr>
                          <th className="px-4 py-3">Operación</th>
                          <th className="px-4 py-3">Resultado</th>
                          <th className="px-4 py-3">Detalle</th>
                          <th className="px-4 py-3">Fecha</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-blue-100">
                        {bitacora.items.map((item, indice) => (
                          <tr key={`${item.created_at.toISOString()}-${indice}`}>
                            <td className="px-4 py-3 font-mono text-xs text-foreground">{item.operacion}</td>
                            <td className="px-4 py-3 text-primary">{item.exitosa ? "OK" : "FALLO"}</td>
                            <td className="px-4 py-3 text-primary">{item.detalle_error ?? "—"}</td>
                            <td className="px-4 py-3 text-primary">{item.created_at.toISOString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex items-center justify-between text-sm text-primary">
                    <span>
                      Página {bitacora.paginacion.pagina_actual} de {bitacora.paginacion.total_paginas} —{" "}
                      {bitacora.paginacion.total} invocación(es)
                    </span>
                    <div className="flex gap-2">
                      {bitacora.paginacion.pagina_actual > 1 && (
                        <Link
                          href={`/administracion/integraciones?conector=${conectorSeleccionado}&page=${bitacora.paginacion.pagina_actual - 1}`}
                          className="rounded-md border border-border px-3 py-1 text-xs font-medium hover:bg-accent"
                        >
                          Anterior
                        </Link>
                      )}
                      {bitacora.paginacion.pagina_actual < bitacora.paginacion.total_paginas && (
                        <Link
                          href={`/administracion/integraciones?conector=${conectorSeleccionado}&page=${bitacora.paginacion.pagina_actual + 1}`}
                          className="rounded-md border border-border px-3 py-1 text-xs font-medium hover:bg-accent"
                        >
                          Siguiente
                        </Link>
                      )}
                    </div>
                  </div>
                </>
              )}
            </section>
          )}
        </>
      )}
    </main>
  );
}
