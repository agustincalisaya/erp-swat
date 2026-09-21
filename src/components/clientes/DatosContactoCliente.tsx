"use client";

/**
 * @component DatosContactoCliente
 * @description HU-C2 — datos de contacto de la ficha de un cliente, con modo
 * edición (nombre, teléfono, email). Client Component; el Server Component
 * padre (`/clientes/[id]`) ya trajo los valores y el permiso de lectura.
 *
 * El formulario vive en `FormularioEditarContactoCliente`, compartido con el
 * Dialog de edición del listado (`EditarClienteDialog`). Acá solo se alterna
 * entre la vista de lectura y el formulario; al guardar o cancelar se vuelve a
 * la vista de lectura. El DNI se muestra de solo lectura y nunca se edita.
 */

import { useState } from "react";
import { Pencil, UserRound } from "lucide-react";

import { FormularioEditarContactoCliente } from "@/components/clientes/FormularioEditarContactoCliente";

import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export interface DatosContactoClienteProps {
  clienteId: string;
  dni: string;
  nombre: string;
  telefono: string | null;
  email: string | null;
  /** Solo quien tiene `clientes:editar` ve el botón de edición. */
  puedeEditar: boolean;
}

export function DatosContactoCliente({
  clienteId,
  dni,
  nombre,
  telefono,
  email,
  puedeEditar,
}: DatosContactoClienteProps) {
  const [editando, setEditando] = useState(false);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              <UserRound className="size-4 text-blue-500" aria-hidden="true" />
              Datos de contacto
            </CardTitle>
            <CardDescription>
              Nombre, teléfono y email del cliente. El DNI no se puede modificar.
            </CardDescription>
          </div>
          {puedeEditar && !editando && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setEditando(true)}
              className="gap-2"
            >
              <Pencil className="size-4" aria-hidden="true" />
              Editar
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent>
        {editando ? (
          <FormularioEditarContactoCliente
            clienteId={clienteId}
            dni={dni}
            nombre={nombre}
            telefono={telefono}
            email={email}
            onSuccess={() => setEditando(false)}
            onCancel={() => setEditando(false)}
          />
        ) : (
          <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-muted-foreground">Nombre</dt>
              <dd className="font-medium text-gray-900">{nombre}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Teléfono</dt>
              <dd className="font-medium text-gray-900">{telefono ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Email</dt>
              <dd className="font-medium text-gray-900 break-all">{email ?? "—"}</dd>
            </div>
          </dl>
        )}
      </CardContent>
    </Card>
  );
}
