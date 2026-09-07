"use client";

/**
 * @component FormularioNuevoProveedor
 * @description Alta de proveedor en estado PENDIENTE (HU-H1, spec §2.1) y
 * edición del legajo comercial (PATCH [id]). Conecta con las Server Actions
 * `crearProveedor` / `editarProveedor` — wrappers finos sobre
 * `proveedor.service.ts`, la lógica de negocio no vive acá.
 *
 * Doble modo según la prop `proveedor`:
 *  - `proveedor` ausente → ALTA: captura `cuit` (formato NN-NNNNNNNN-N) y
 *    `datos_bancarios` opcionales.
 *  - `proveedor` presente → EDICIÓN: el CUIT se muestra como solo lectura
 *    (no editable — 422 CAMPOS_NO_EDITABLES si se intenta); los datos
 *    bancarios se pueden REEMPLAZAR (re-cifrado server-side con IV nuevo).
 *
 * Regla de privacidad (Ley N.° 25.326): este formulario NUNCA recibe ni
 * muestra un CBU descifrado — el servicio no expone el dato bancario en
 * ninguna proyección de listado ni edición.
 */

import { useMemo, useState, useTransition } from "react";
import { Loader2, Save, UserPlus, AlertTriangle } from "lucide-react";

import {
  crearProveedor,
  editarProveedor,
} from "@/app/(dashboard)/compras/proveedores/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { ProveedorListado } from "@/lib/services/proveedores/proveedor.service";

interface FormularioNuevoProveedorProps {
  /** Presente → modo edición del legajo; ausente → alta. */
  proveedor?: ProveedorListado | null;
  /** Se invoca tras un alta/edición exitosa (cierre de diálogo + refresh). */
  onExito?: () => void;
}

const CUIT_REGEX = /^\d{2}-\d{8}-\d{1}$/;

export function FormularioNuevoProveedor({
  proveedor,
  onExito,
}: FormularioNuevoProveedorProps) {
  const esEdicion = Boolean(proveedor);

  const [razonSocial, setRazonSocial] = useState(proveedor?.razon_social ?? "");
  const [nombreFantasia, setNombreFantasia] = useState(proveedor?.nombre_fantasia ?? "");
  const [cuit, setCuit] = useState(proveedor?.cuit ?? "");
  const [condicionesPago, setCondicionesPago] = useState(proveedor?.condiciones_pago ?? "");
  const [categorias, setCategorias] = useState(proveedor?.categorias.join(", ") ?? "");
  const [contactoNombre, setContactoNombre] = useState(proveedor?.contacto_nombre ?? "");
  const [contactoEmail, setContactoEmail] = useState(proveedor?.contacto_email ?? "");
  const [contactoTelefono, setContactoTelefono] = useState(proveedor?.contacto_telefono ?? "");
  const [cbu, setCbu] = useState("");
  const [alias, setAlias] = useState("");
  const [banco, setBanco] = useState("");

  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [errorCuit, setErrorCuit] = useState<string | null>(null);
  const [errorCategorias, setErrorCategorias] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const categoriasLista = useMemo(
    () =>
      categorias
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean),
    [categorias],
  );

  const validarLocal = (): boolean => {
    setErrorGeneral(null);
    setErrorCuit(null);
    setErrorCategorias(null);

    if (razonSocial.trim().length < 2) {
      setErrorGeneral("La razón social debe tener al menos 2 caracteres.");
      return false;
    }
    if (!esEdicion) {
      if (!CUIT_REGEX.test(cuit.trim())) {
        setErrorCuit("El CUIT debe tener el formato NN-NNNNNNNN-N.");
        return false;
      }
    }
    if (categoriasLista.length === 0) {
      setErrorCategorias("Indicá al menos una categoría de producto.");
      return false;
    }
    if (categoriasLista.some((c) => c.length > 50)) {
      setErrorCategorias("Cada categoría admite hasta 50 caracteres.");
      return false;
    }
    return true;
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validarLocal()) return;

    // Solo se incluyen las claves con contenido (los campos `.optional()` no
    // viajan como claves vacías — mismo criterio de wire que H3).
    const textoSegunValor = (valor: string) =>
      valor.trim().length > 0 ? valor.trim() : undefined;

    const comunes = {
      razon_social: razonSocial.trim(),
      ...(textoSegunValor(nombreFantasia) !== undefined
        ? { nombre_fantasia: textoSegunValor(nombreFantasia) }
        : {}),
      ...(textoSegunValor(condicionesPago) !== undefined
        ? { condiciones_pago: textoSegunValor(condicionesPago) }
        : {}),
      categorias: categoriasLista,
      ...(textoSegunValor(contactoNombre) !== undefined
        ? { contacto_nombre: textoSegunValor(contactoNombre) }
        : {}),
      ...(textoSegunValor(contactoEmail) !== undefined
        ? { contacto_email: textoSegunValor(contactoEmail) }
        : {}),
      ...(textoSegunValor(contactoTelefono) !== undefined
        ? { contacto_telefono: textoSegunValor(contactoTelefono) }
        : {}),
    };

    // Datos bancarios: en edición, solo se envían si el usuario los reemplaza
    // (nunca se muestran los valores cifrados existentes). En alta, opcionales.
    const bancariosCompletos =
      textoSegunValor(cbu) !== undefined && textoSegunValor(banco) !== undefined;
    const payload = esEdicion
      ? {
          ...comunes,
          ...(bancariosCompletos
            ? {
                datos_bancarios: {
                  cbu: cbu.trim(),
                  alias: textoSegunValor(alias),
                  banco: banco.trim(),
                },
              }
            : {}),
        }
      : {
          cuit: cuit.trim(),
          ...comunes,
          ...(bancariosCompletos
            ? {
                datos_bancarios: {
                  cbu: cbu.trim(),
                  alias: textoSegunValor(alias),
                  banco: banco.trim(),
                },
              }
            : {}),
        };

    startTransition(async () => {
      const resultado = esEdicion
        ? await editarProveedor(proveedor!.id, payload)
        : await crearProveedor(payload);

      if (resultado.error) {
        const { code, message } = resultado.error;
        if (code === "CUIT_DUPLICADO") {
          setErrorCuit(message);
          return;
        }
        if (code === "CAMPOS_NO_EDITABLES") {
          setErrorGeneral(message);
          return;
        }
        setErrorGeneral(message);
        return;
      }

      onExito?.();
    });
  };

  return (
    <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col space-y-4" noValidate>
      <div className="flex-1 overflow-y-auto space-y-4">
      {errorGeneral && (
        <Alert variant="destructive">
          <AlertTriangle className="size-4" aria-hidden="true" />
          <AlertDescription>{errorGeneral}</AlertDescription>
        </Alert>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="prov-razon-social" className="text-xs font-semibold uppercase tracking-wide text-gray-700">
          Razón social
        </Label>
        <Input
          id="prov-razon-social"
          value={razonSocial}
          onChange={(e) => setRazonSocial(e.target.value)}
          placeholder="Ej: Textil Los Andes S.A."
          className="text-sm"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="prov-nombre-fantasia" className="text-xs font-semibold uppercase tracking-wide text-gray-700">
          Nombre de fantasía <span className="font-normal text-muted-foreground">(opcional)</span>
        </Label>
        <Input
          id="prov-nombre-fantasia"
          value={nombreFantasia}
          onChange={(e) => setNombreFantasia(e.target.value)}
          placeholder="Ej: Los Andes Outlet"
          className="text-sm"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="prov-cuit" className="text-xs font-semibold uppercase tracking-wide text-gray-700">
          CUIT
        </Label>
        <Input
          id="prov-cuit"
          value={cuit}
          onChange={(e) => setCuit(e.target.value)}
          placeholder="NN-NNNNNNNN-N"
          disabled={esEdicion}
          readOnly={esEdicion}
          className="text-sm font-mono disabled:opacity-70"
        />
        {esEdicion && (
          <p className="text-xs text-muted-foreground">
            El CUIT no se puede editar en el legajo.
          </p>
        )}
        {errorCuit && <p className="text-xs text-destructive">{errorCuit}</p>}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="prov-categorias" className="text-xs font-semibold uppercase tracking-wide text-gray-700">
          Categorías de producto
        </Label>
        <Input
          id="prov-categorias"
          value={categorias}
          onChange={(e) => setCategorias(e.target.value)}
          placeholder="Ej: Calzado, Textil Táctico"
          className="text-sm"
        />
        <p className="text-xs text-muted-foreground">
          Separadas por coma. Máximo 20 categorías.
        </p>
        {errorCategorias && <p className="text-xs text-destructive">{errorCategorias}</p>}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="prov-condiciones" className="text-xs font-semibold uppercase tracking-wide text-gray-700">
          Condiciones de pago <span className="font-normal text-muted-foreground">(opcional)</span>
        </Label>
        <Input
          id="prov-condiciones"
          value={condicionesPago}
          onChange={(e) => setCondicionesPago(e.target.value)}
          placeholder="Ej: 30 días FF"
          className="text-sm"
        />
      </div>

      <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-700">
          Contacto <span className="font-normal text-muted-foreground">(opcional)</span>
        </p>
        <div className="space-y-1.5">
          <Label htmlFor="prov-contacto-nombre" className="text-xs">Nombre</Label>
          <Input
            id="prov-contacto-nombre"
            value={contactoNombre}
            onChange={(e) => setContactoNombre(e.target.value)}
            className="text-sm"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="prov-contacto-email" className="text-xs">Email</Label>
          <Input
            id="prov-contacto-email"
            type="email"
            value={contactoEmail}
            onChange={(e) => setContactoEmail(e.target.value)}
            className="text-sm"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="prov-contacto-tel" className="text-xs">Teléfono</Label>
          <Input
            id="prov-contacto-tel"
            value={contactoTelefono}
            onChange={(e) => setContactoTelefono(e.target.value)}
            className="text-sm"
          />
        </div>
      </div>

      <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-3 space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">
          Datos bancarios{" "}
          <span className="font-normal text-muted-foreground">
            {esEdicion ? "(reemplazo — opcional)" : "(opcional)"}
          </span>
        </p>
        {esEdicion && (
          <p className="text-xs text-muted-foreground">
            Si completás CBU y banco, los datos bancarios vigentes se
            reemplazan (se re-cifran con una clave nueva). Los valores
            actuales no se muestran por protección de datos.
          </p>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="prov-cbu" className="text-xs">CBU (22 dígitos)</Label>
          <Input
            id="prov-cbu"
            value={cbu}
            onChange={(e) => setCbu(e.target.value)}
            placeholder="0000000000000000000000"
            inputMode="numeric"
            className="text-sm font-mono"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="prov-alias" className="text-xs">Alias <span className="font-normal text-muted-foreground">(opcional)</span></Label>
          <Input
            id="prov-alias"
            value={alias}
            onChange={(e) => setAlias(e.target.value)}
            className="text-sm"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="prov-banco" className="text-xs">Banco</Label>
          <Input
            id="prov-banco"
            value={banco}
            onChange={(e) => setBanco(e.target.value)}
            className="text-sm"
          />
        </div>
      </div>

      </div>

      <div className="flex shrink-0 items-center justify-end gap-2 pt-1">
        <Button
          type="submit"
          disabled={isPending}
          className="bg-blue-600 hover:bg-blue-700 text-white gap-2"
        >
          {isPending ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Guardando…
            </>
          ) : esEdicion ? (
            <>
              <Save className="size-4" />
              Guardar cambios
            </>
          ) : (
            <>
              <UserPlus className="size-4" />
              Crear proveedor
            </>
          )}
        </Button>
      </div>
    </form>
  );
}