"use client";

/**
 * @component EditarClienteDialog
 * @description HU-C2 — segundo punto de entrada a la edición de contacto: un
 * botón "Editar" por fila del listado `/clientes` que abre un Dialog con
 * `FormularioEditarContactoCliente` precargado con los datos de la fila
 * (`ClienteListado` ya trae nombre/teléfono/email, sin fetch extra). El modo
 * edición de la ficha (`DatosContactoCliente`) es el otro punto de entrada y
 * usa el mismo formulario.
 *
 * Base UI desmonta el `Popup` al cerrar (ver `EditarProductoMaestroDialog`),
 * así que reabrir siempre monta el formulario con los valores actuales de la
 * fila. Al guardar, el formulario hace `router.refresh()` y acá se cierra el
 * Dialog. El permiso `clientes:editar` lo resuelve el padre: este componente
 * solo se renderiza si `puedeEditar`.
 */
import { useState } from "react";
import { Pencil } from "lucide-react";

import { FormularioEditarContactoCliente } from "@/components/clientes/FormularioEditarContactoCliente";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface EditarClienteDialogProps {
  clienteId: string;
  dni: string;
  nombre: string;
  telefono: string | null;
  email: string | null;
}

export function EditarClienteDialog({
  clienteId,
  dni,
  nombre,
  telefono,
  email,
}: EditarClienteDialogProps) {
  const [abierto, setAbierto] = useState(false);

  return (
    <Dialog open={abierto} onOpenChange={setAbierto}>
      <Button
        id={`btn-editar-cliente-${clienteId}`}
        type="button"
        variant="outline"
        size="sm"
        className="gap-1.5 border-blue-200 text-blue-700 hover:bg-blue-50 hover:text-blue-800"
        onClick={() => setAbierto(true)}
      >
        <Pencil className="size-3.5" aria-hidden="true" />
        Editar
      </Button>

      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Editar datos de contacto</DialogTitle>
          <DialogDescription>
            Nombre, teléfono y email del cliente. El DNI no se puede modificar.
          </DialogDescription>
        </DialogHeader>

        <FormularioEditarContactoCliente
          clienteId={clienteId}
          dni={dni}
          nombre={nombre}
          telefono={telefono}
          email={email}
          onSuccess={() => setAbierto(false)}
          onCancel={() => setAbierto(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
