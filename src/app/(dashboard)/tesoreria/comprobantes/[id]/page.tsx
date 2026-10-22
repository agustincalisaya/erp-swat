/**
 * @page DetalleComprobanteFiscalPage
 * @route /tesoreria/comprobantes/[id]
 *
 * HU-G3 (spec_modulo_G.md §9.5) — vista de un comprobante del repositorio.
 * React Server Component, mismo patrón que `/ventas/pedidos/[id]`: resuelve
 * sesión + permiso y llama directo a `obtenerDetalleComprobante()` (el mismo
 * servicio que `GET /api/tesoreria/comprobantes/[id]`), sin fetch HTTP.
 *
 * - G3-3: "Ver PDF" abre el PDF en el navegador (`?disposicion=inline`) y
 *   "Descargar PDF" lo baja; los dos usan la ruta gateada del repositorio.
 * - G3-4: una Nota de Crédito enlaza el detalle de su original y un original
 *   lista sus Notas de Crédito con link. El vínculo sale de
 *   `comprobante_original_id`, nunca del número.
 * - G3-5: solo lectura, sin acciones de edición ni baja.
 *
 * Gate: `tesoreria:leer_comprobantes` (redirect a `/no-autorizado`), igual que
 * el listado. Id mal formado o inexistente ⇒ `notFound()`. Los parámetros del
 * listado que llegan en el query se conservan en "Volver al listado" y en los
 * links entre comprobantes.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Download, ExternalLink, Link2, Receipt } from "lucide-react";

import { getServerSession } from "@/lib/auth/session";
import { usuarioTienePermiso } from "@/lib/auth/with-permission";
import { ServiceError } from "@/lib/errors/service-error";
import { ComprobanteRepositorioIdSchema } from "@/lib/schemas/comprobantes-repositorio.schema";
import {
  obtenerDetalleComprobante,
  PERMISO_LEER_COMPROBANTES,
  type ComprobanteDetalle,
} from "@/lib/services/tesoreria/comprobantes-repositorio.service";
import { formatearFechaNegocio } from "@/lib/utils/fecha-negocio";
import {
  enlacesVinculados,
  ETIQUETAS_CANAL_COMPROBANTE,
  ETIQUETAS_TIPO_COMPROBANTE,
  formatearTotalComprobante,
  hrefListadoComprobantes,
  hrefPdfComprobante,
  queryListadoComprobantes,
} from "@/components/tesoreria/comprobantes-presentacion";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Comprobante fiscal — ERP SWAT",
  description: "Vista de un comprobante fiscal del repositorio (Módulo G).",
};

interface DetalleComprobantePageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

/** `null` cuando el id no es un UUID o no existe: la página responde 404. */
async function buscarDetalle(id: string): Promise<ComprobanteDetalle | null> {
  const parsedId = ComprobanteRepositorioIdSchema.safeParse(id);
  if (!parsedId.success) return null;
  try {
    return await obtenerDetalleComprobante(parsedId.data);
  } catch (err) {
    if (err instanceof ServiceError && err.code === "COMPROBANTE_NO_ENCONTRADO") return null;
    throw err;
  }
}

const claseLink = "font-mono text-primary underline underline-offset-4 hover:text-primary-hover";
const claseDato = "text-xs text-muted-foreground uppercase tracking-wide";

export default async function DetalleComprobanteFiscalPage({ params, searchParams }: DetalleComprobantePageProps) {
  const session = await getServerSession();
  if (!session) redirect("/login");

  const autorizado = await usuarioTienePermiso(session.userId, PERMISO_LEER_COMPROBANTES);
  if (!autorizado) redirect("/no-autorizado");

  const [{ id }, rawParams] = await Promise.all([params, searchParams]);
  const comprobante = await buscarDetalle(id);
  if (!comprobante) notFound();

  const query = queryListadoComprobantes(rawParams);
  const { original, notas_credito } = enlacesVinculados(comprobante, query);
  const { cliente } = comprobante;

  return (
    <main className="min-h-screen bg-background p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-4xl space-y-5">
        <Link
          href={hrefListadoComprobantes(query)}
          className={`${buttonVariants({ variant: "ghost" })} gap-2 text-muted-foreground`}
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Volver al listado
        </Link>

        {/* ── Encabezado ──────────────────────────────────────────────── */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-xl bg-selected text-selected-foreground shrink-0">
              <Receipt className="size-5" aria-hidden="true" />
            </div>
            <div className="space-y-1.5">
              <h1 className="text-xl font-bold text-foreground tracking-tight font-mono">{comprobante.numero}</h1>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">{ETIQUETAS_TIPO_COMPROBANTE[comprobante.tipo_comprobante]}</Badge>
                <Badge className="bg-warning text-warning-foreground">Simulado · sin validez ante ARCA</Badge>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <a
              href={hrefPdfComprobante(comprobante.comprobante_id, "inline")}
              target="_blank"
              rel="noopener noreferrer"
              className={`${buttonVariants({ variant: "outline" })} gap-2`}
            >
              <ExternalLink className="size-4" aria-hidden="true" />
              Ver PDF
            </a>
            <a
              href={hrefPdfComprobante(comprobante.comprobante_id, "attachment")}
              className={`${buttonVariants()} gap-2`}
            >
              <Download className="size-4" aria-hidden="true" />
              Descargar PDF
            </a>
          </div>
        </div>

        {/* ── Datos del comprobante ───────────────────────────────────── */}
        <Card>
          <CardHeader className="border-b border-border">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              <Receipt className="size-4 text-primary" aria-hidden="true" />
              Datos del comprobante
            </CardTitle>
            <CardDescription>
              Comprobante archivado por HU-B7. No se puede modificar ni eliminar: su reversión es una Nota de Crédito.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-5">
            <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <dt className={claseDato}>Tipo</dt>
                <dd className="mt-0.5 font-medium text-foreground">
                  {ETIQUETAS_TIPO_COMPROBANTE[comprobante.tipo_comprobante]}
                </dd>
              </div>
              <div>
                <dt className={claseDato}>Canal</dt>
                <dd className="mt-0.5 font-medium text-foreground">{ETIQUETAS_CANAL_COMPROBANTE[comprobante.canal]}</dd>
              </div>
              <div>
                <dt className={claseDato}>Cliente</dt>
                <dd className="mt-0.5 font-medium text-foreground">
                  {cliente.nombre}
                  {cliente.dni && <span className="text-muted-foreground"> · DNI {cliente.dni}</span>}
                </dd>
              </div>
              <div>
                <dt className={claseDato}>Emisión (hora de Argentina)</dt>
                <dd className="mt-0.5 font-medium text-foreground tabular-nums">
                  {formatearFechaNegocio(comprobante.fecha_emision)}
                </dd>
              </div>
              <div>
                <dt className={claseDato}>Total</dt>
                <dd className="mt-0.5 font-medium text-foreground tabular-nums">{formatearTotalComprobante(comprobante)}</dd>
              </div>
              <div>
                <dt className={claseDato}>CAE simulado</dt>
                <dd className="mt-0.5 font-mono font-medium text-foreground">{comprobante.cae_simulado}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        {/* ── Vínculo NC ↔ original (G3-4) ────────────────────────────── */}
        <Card>
          <CardHeader className="border-b border-border">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              <Link2 className="size-4 text-primary" aria-hidden="true" />
              Comprobantes vinculados
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-5 space-y-4 text-sm">
            {original && (
              <p className="text-foreground">
                Anula a{" "}
                <Link href={original.href} className={claseLink}>
                  {original.numero}
                </Link>
              </p>
            )}
            {notas_credito.length > 0 && (
              <div className="space-y-2">
                <p className={claseDato}>Notas de crédito</p>
                <ul className="space-y-1">
                  {notas_credito.map((nc) => (
                    <li key={nc.comprobante_id}>
                      <Link href={nc.href} className={claseLink}>
                        {nc.numero}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {!original && notas_credito.length === 0 && (
              <p className="text-muted-foreground">Este comprobante no tiene comprobantes vinculados.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
