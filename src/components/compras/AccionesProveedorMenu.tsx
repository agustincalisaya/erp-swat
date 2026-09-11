"use client";

/**
 * @component AccionesProveedorMenu
 * @description Contenedor puramente visual del menú de acciones secundarias
 * de una fila de `TablaProveedores` (HU-H1). Replica el patrón de
 * `UsuarioAccionesMenu` (auditoría): un `DropdownMenu` de shadcn/ui activado
 * por un botón ⋮ (`align="end"`) que agrupa las acciones de estado
 * (Homologar / Suspender / Volver a PENDIENTE) y la baja lógica en vez de
 * mostrarlas como botones inline que desbordan la columna. "Editar" queda
 * fuera de acá, como botón visible en la fila.
 *
 * No agrega lógica de negocio: cada ítem dispara exactamente el mismo
 * diálogo / Server Action / validación que disparaba su botón equivalente
 * antes del refactor — solo cambia el contenedor visual.
 *
 * Los diálogos (`DialogHomologar`, `DialogSuspender`, `DialogVolverPendiente`,
 * `DialogBaja`) se renderizan como HERMANOS del `DropdownMenu` (nunca
 * anidados en `DropdownMenuContent`), mismo criterio que el precedente de
 * auditoría: cerrar el menú al hacer click en un ítem no desmonta un diálogo
 * a mitad de apertura ni compiten dos overlays por el foco. A diferencia del
 * precedente (que abría el diálogo con un click programático sobre un trigger
 * oculto — mecanismo que Base UI bloquea), acá los diálogos se usan en MODO
 * CONTROLADO: un único estado `accionAbierta` selecciona cuál renderiza su
 * `open`, y `onOpenChange` lo limpia al cerrar.
 *
 * Restricción de spec §2.2 respetada: PENDIENTE NO ofrece "Suspender" (la
 * transición P→S no es válida) — solo HOMOLOGADO lo hace.
 */

import { useState } from "react";
import { BadgeCheck, Ban, MoreVertical, RotateCcw, Trash2 } from "lucide-react";

import { DialogBaja } from "@/components/compras/DialogBaja";
import { DialogHomologar } from "@/components/compras/DialogHomologar";
import { DialogSuspender } from "@/components/compras/DialogSuspender";
import { DialogVolverPendiente } from "@/components/compras/DialogVolverPendiente";
import type { PermisosProveedores } from "@/components/compras/TablaProveedores";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ProveedorListado } from "@/lib/services/proveedores/proveedor.service";

interface AccionesProveedorMenuProps {
  proveedor: ProveedorListado;
  permisos: PermisosProveedores;
}

/** Acciones con diálogo propio que ofrece el menú según estado y permisos. */
type AccionDialogo = "homologar" | "suspender" | "volverPendiente" | "baja";

export function AccionesProveedorMenu({
  proveedor,
  permisos,
}: AccionesProveedorMenuProps) {
  const [accionAbierta, setAccionAbierta] = useState<null | AccionDialogo>(null);

  const estado = proveedor.estado;

  const hayAccionesDeEstado =
    permisos.homologar &&
    (estado === "PENDIENTE" || estado === "HOMOLOGADO" || estado === "SUSPENDIDO");

  const hayAcciones = hayAccionesDeEstado || permisos.baja;

  return (
    <>
      {hayAcciones && (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Más acciones"
                title="Más acciones"
              />
            }
          >
            <MoreVertical className="size-4" aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {permisos.homologar && estado === "PENDIENTE" && (
              <DropdownMenuItem onClick={() => setAccionAbierta("homologar")}>
                <BadgeCheck className="size-3.5" aria-hidden="true" />
                Homologar
              </DropdownMenuItem>
            )}

            {permisos.homologar && estado === "HOMOLOGADO" && (
              <DropdownMenuItem onClick={() => setAccionAbierta("suspender")}>
                <Ban className="size-3.5" aria-hidden="true" />
                Suspender
              </DropdownMenuItem>
            )}

            {permisos.homologar &&
              (estado === "HOMOLOGADO" || estado === "SUSPENDIDO") && (
                <DropdownMenuItem onClick={() => setAccionAbierta("volverPendiente")}>
                  <RotateCcw className="size-3.5" aria-hidden="true" />
                  Volver a PENDIENTE
                </DropdownMenuItem>
              )}

            {permisos.baja && (
              <>
                {hayAccionesDeEstado && <DropdownMenuSeparator />}
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => setAccionAbierta("baja")}
                >
                  <Trash2 className="size-3.5" aria-hidden="true" />
                  Dar de baja
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {/* Diálogos como hermanos del menú, controlados: el ítem del menú
          selecciona cuál abrir y `onOpenChange` limpia el estado al cerrar. */}
      {permisos.homologar && (estado === "PENDIENTE" || estado === "SUSPENDIDO") && (
        <DialogHomologar
          proveedorId={proveedor.id}
          razonSocial={proveedor.razon_social}
          estadoActual={estado}
          open={accionAbierta === "homologar"}
          onOpenChange={(open) => {
            if (!open) setAccionAbierta(null);
          }}
        />
      )}

      {permisos.homologar && estado === "HOMOLOGADO" && (
        <DialogSuspender
          proveedorId={proveedor.id}
          razonSocial={proveedor.razon_social}
          open={accionAbierta === "suspender"}
          onOpenChange={(open) => {
            if (!open) setAccionAbierta(null);
          }}
        />
      )}

      {permisos.homologar && (estado === "HOMOLOGADO" || estado === "SUSPENDIDO") && (
        <DialogVolverPendiente
          proveedorId={proveedor.id}
          razonSocial={proveedor.razon_social}
          estadoActual={estado}
          open={accionAbierta === "volverPendiente"}
          onOpenChange={(open) => {
            if (!open) setAccionAbierta(null);
          }}
        />
      )}

      {permisos.baja && (
        <DialogBaja
          proveedorId={proveedor.id}
          razonSocial={proveedor.razon_social}
          open={accionAbierta === "baja"}
          onOpenChange={(open) => {
            if (!open) setAccionAbierta(null);
          }}
        />
      )}
    </>
  );
}