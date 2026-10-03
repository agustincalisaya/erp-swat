/**
 * @page NotificacionesPage
 * @route /notificaciones
 *
 * Bandeja de notificaciones del personal interno (HU-F3, spec_modulo_F.md
 * §2.3, task §6). RSC: resuelve la sesión y lee `listarNotificaciones()` con
 * el destinatario de la sesión (mismo servicio y mismo Zod que
 * `GET /api/notificaciones`). Sin permiso granular: cada usuario ve solo lo
 * suyo. Filtros por prioridad y "solo no leídas" vía query string; el
 * parámetro `solo_no_leidas` solo se envía cuando es `true` (Punto abierto 6).
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle, Bell, ChevronLeft, ChevronRight } from "lucide-react";

import { getServerSession } from "@/lib/auth/session";
import {
  ListarNotificacionesQuerySchema,
  type ListarNotificacionesQuery,
} from "@/lib/schemas/notificaciones.schema";
import {
  listarNotificaciones,
  type BandejaNotificaciones as Bandeja,
} from "@/lib/services/notificaciones/notificacion.service";
import { BandejaNotificaciones } from "@/components/notificaciones/BandejaNotificaciones";
import { Alert, AlertDescription } from "@/components/ui/alert";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Notificaciones — ERP SWAT",
  description: "Bandeja de notificaciones internas del usuario.",
};

const FILTROS_PRIORIDAD = [
  { valor: undefined, etiqueta: "Todas" },
  { valor: "CRITICA", etiqueta: "Críticas" },
  { valor: "ADVERTENCIA", etiqueta: "Advertencias" },
  { valor: "INFORMATIVA", etiqueta: "Informativas" },
] as const;

function hrefBandeja(query: Partial<ListarNotificacionesQuery>): string {
  const params = new URLSearchParams();
  if (query.solo_no_leidas) params.set("solo_no_leidas", "true");
  if (query.prioridad) params.set("prioridad", query.prioridad);
  if (query.page && query.page > 1) params.set("page", String(query.page));
  const qs = params.toString();
  return qs ? `/notificaciones?${qs}` : "/notificaciones";
}

interface NotificacionesPageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function NotificacionesPage({ searchParams }: NotificacionesPageProps) {
  const session = await getServerSession();
  if (!session) redirect("/login");

  const rawParams = await searchParams;
  const parsed = ListarNotificacionesQuerySchema.safeParse(
    Object.fromEntries(
      Object.entries(rawParams).filter((entrada): entrada is [string, string] => typeof entrada[1] === "string"),
    ),
  );
  const query: ListarNotificacionesQuery = parsed.success
    ? parsed.data
    : ListarNotificacionesQuerySchema.parse({});

  let bandeja: Bandeja | null = null;
  try {
    bandeja = await listarNotificaciones({ tipo: "USUARIO", usuario_id: session.userId }, query);
  } catch (err) {
    console.error("[NotificacionesPage] Error al cargar la bandeja:", err);
  }

  const chip = (activo: boolean) =>
    `rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
      activo
        ? "border-blue-600 bg-blue-600 text-white"
        : "border-border bg-white text-gray-700 hover:bg-gray-100"
    }`;

  return (
    <main className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
      <div className="max-w-4xl mx-auto space-y-5">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-blue-100 text-blue-600 shrink-0">
            <Bell className="size-5" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900 tracking-tight">Notificaciones</h1>
            <p className="text-sm text-muted-foreground">
              Alertas y avisos del sistema dirigidos a vos o a tus roles. Las críticas aparecen primero.
            </p>
          </div>
        </div>

        <nav className="flex flex-wrap items-center gap-2" aria-label="Filtros de la bandeja">
          {FILTROS_PRIORIDAD.map((filtro) => (
            <Link
              key={filtro.etiqueta}
              href={hrefBandeja({ ...query, prioridad: filtro.valor, page: 1 })}
              className={chip(query.prioridad === filtro.valor)}
            >
              {filtro.etiqueta}
            </Link>
          ))}
          <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
          <Link
            href={hrefBandeja({ ...query, solo_no_leidas: !query.solo_no_leidas, page: 1 })}
            className={chip(query.solo_no_leidas)}
            aria-pressed={query.solo_no_leidas}
          >
            Solo no leídas
          </Link>
        </nav>

        {bandeja === null ? (
          <Alert variant="destructive">
            <AlertTriangle className="size-4" aria-hidden="true" />
            <AlertDescription>
              No se pudieron cargar las notificaciones. Intentá de nuevo en unos instantes.
            </AlertDescription>
          </Alert>
        ) : (
          <>
            <BandejaNotificaciones items={bandeja.items} noLeidas={bandeja.no_leidas} />

            {bandeja.paginacion.total_paginas > 1 && (
              <nav className="flex items-center justify-between text-sm" aria-label="Paginación">
                {query.page > 1 ? (
                  <Link href={hrefBandeja({ ...query, page: query.page - 1 })} className="flex items-center gap-1 text-blue-700 hover:underline">
                    <ChevronLeft className="size-4" aria-hidden="true" /> Anterior
                  </Link>
                ) : (
                  <span />
                )}
                <span className="text-muted-foreground">
                  Página {bandeja.paginacion.pagina_actual} de {bandeja.paginacion.total_paginas}
                </span>
                {query.page < bandeja.paginacion.total_paginas ? (
                  <Link href={hrefBandeja({ ...query, page: query.page + 1 })} className="flex items-center gap-1 text-blue-700 hover:underline">
                    Siguiente <ChevronRight className="size-4" aria-hidden="true" />
                  </Link>
                ) : (
                  <span />
                )}
              </nav>
            )}
          </>
        )}
      </div>
    </main>
  );
}
