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
 * a mitad de apertura ni compiten dos overlays por el foco. Diferencia con ese
 * precedente: los diálogos de proveedores NO son controlados — manejan su
 * propio `open` y renderizan su propio botón trigger. Para no modificar sus
 * internals, se montan dentro de un wrapper `hidden` y el ítem del menú abre
 * el diálogo disparando un `.click()` programático sobre ese trigger oculto
 * (el único mecanismo de apertura que expone el diálogo sin tocarlo).
 *
 * Restricción de spec §2.2 respetada: PENDIENTE NO ofrece "Suspender" (la
 * transición P→S no es válida) — solo HOMOLOGADO lo hace.
 */

import { useRef, type RefObject } from "react";
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

export function AccionesProveedorMenu({
  proveedor,
  permisos,
}: AccionesProveedorMenuProps) {
  const homologarRef = useRef<HTMLDivElement>(null);
  const suspenderRef = useRef<HTMLDivElement>(null);
  const volverPendienteRef = useRef<HTMLDivElement>(null);
  const bajaRef = useRef<HTMLDivElement>(null);

  const estado = proveedor.estado;

  const abrirDialogo = (ref: RefObject<HTMLDivElement | null>) => () => {
    ref.current?.querySelector<HTMLButtonElement>("button")?.click();
  };

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
              <DropdownMenuItem onClick={() => abrirDialogo(homologarRef)}>
                <BadgeCheck className="size-3.5" aria-hidden="true" />
                Homologar
              </DropdownMenuItem>
            )}

            {permisos.homologar && estado === "HOMOLOGADO" && (
              <DropdownMenuItem onClick={() => abrirDialogo(suspenderRef)}>
                <Ban className="size-3.5" aria-hidden="true" />
                Suspender
              </DropdownMenuItem>
            )}

            {permisos.homologar &&
              (estado === "HOMOLOGADO" || estado === "SUSPENDIDO") && (
                <DropdownMenuItem onClick={() => abrirDialogo(volverPendienteRef)}>
                  <RotateCcw className="size-3.5" aria-hidden="true" />
                  Volver a PENDIENTE
                </DropdownMenuItem>
              )}

            {permisos.baja && (
              <>
                {hayAccionesDeEstado && <DropdownMenuSeparator />}
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => abrirDialogo(bajaRef)}
                >
                  <Trash2 className="size-3.5" aria-hidden="true" />
                  Dar de baja
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {/* Diálogos como hermanos del menú, con su trigger oculto: el ítem del
          menú los abre con un click programático (ver docblock). */}
      <div ref={homologarRef} className="hidden">
        {permisos.homologar && (estado === "PENDIENTE" || estado === "SUSPENDIDO") && (
          <DialogHomologar
            proveedorId={proveedor.id}
            razonSocial={proveedor.razon_social}
            estadoActual={estado}
          />
        )}
      </div>

      <div ref={suspenderRef} className="hidden">
        {permisos.homologar && estado === "HOMOLOGADO" && (
          <DialogSuspender proveedorId={proveedor.id} razonSocial={proveedor.razon_social} />
        )}
      </div>

      <div ref={volverPendienteRef} className="hidden">
        {permisos.homologar && (estado === "HOMOLOGADO" || estado === "SUSPENDIDO") && (
          <DialogVolverPendiente
            proveedorId={proveedor.id}
            razonSocial={proveedor.razon_social}
            estadoActual={estado}
          />
        )}
      </div>

      <div ref={bajaRef} className="hidden">
        {permisos.baja && (
          <DialogBaja proveedorId={proveedor.id} razonSocial={proveedor.razon_social} />
        )}
      </div>
    </>
  );
}