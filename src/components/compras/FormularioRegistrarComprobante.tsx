"use client";

/**
 * @component FormularioRegistrarComprobante
 * @description Alta de un ComprobanteProveedor contra una OrdenCompra ya
 * recibida (HU-H9, spec_modulo_H.md §2.7). Modal disparado desde la card de
 * comprobantes en el detalle de la OC.
 *
 * Conecta con la Server Action `registrarComprobanteProveedor` — wrapper fino
 * sobre `comprobante-proveedor.service.ts`; la lógica de negocio (precondición
 * de estado de la OC, unicidad, resolución server-side de `proveedor_id`) NO
 * vive acá.
 *
 * Campos: `tipo` (enum cerrado, nunca texto libre), `numero_comprobante`,
 * `fecha_emision`, `monto_total`, y `archivo_adjunto_url` opcional (solo la
 * referencia al archivo ya subido a un storage externo — este formulario no
 * sube el binario). `orden_compra_id` viaja como argumento de la action, no
 * en el payload; `proveedor_id` lo resuelve el servidor.
 */

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FilePlus2, Loader2, AlertTriangle } from "lucide-react";

import { registrarComprobanteProveedor } from "@/app/(dashboard)/compras/comprobantes/actions";
import { TIPOS_COMPROBANTE } from "@/lib/schemas/comprobantes-proveedor.schema";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { toast } from "@/components/ui/toast";

interface FormularioRegistrarComprobanteProps {
  ordenCompraId: string;
  numeroOrden: string;
}

const TIPO_LABEL: Record<(typeof TIPOS_COMPROBANTE)[number], string> = {
  FACTURA_A: "Factura A",
  FACTURA_B: "Factura B",
  FACTURA_C: "Factura C",
  FACTURA_M: "Factura M",
};

const CAMPO_CLASS =
  "w-full rounded-lg border border-input bg-background px-2.5 py-1 h-8 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export function FormularioRegistrarComprobante({
  ordenCompraId,
  numeroOrden,
}: FormularioRegistrarComprobanteProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [tipo, setTipo] = useState<(typeof TIPOS_COMPROBANTE)[number]>("FACTURA_A");
  const [numero, setNumero] = useState("");
  const [fechaEmision, setFechaEmision] = useState("");
  const [montoTotal, setMontoTotal] = useState("");
  const [archivoUrl, setArchivoUrl] = useState("");
  const [errorLocal, setErrorLocal] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const resetear = useCallback(() => {
    setTipo("FACTURA_A");
    setNumero("");
    setFechaEmision("");
    setMontoTotal("");
    setArchivoUrl("");
    setErrorLocal(null);
    setServerError(null);
  }, []);

  const handleOpenChange = (o: boolean) => {
    setOpen(o);
    if (!o) resetear();
  };

  const validarLocal = (): boolean => {
    setErrorLocal(null);
    if (numero.trim().length === 0) {
      setErrorLocal("El número de comprobante es obligatorio.");
      return false;
    }
    if (!fechaEmision) {
      setErrorLocal("La fecha de emisión es obligatoria.");
      return false;
    }
    const monto = Number(montoTotal);
    if (!Number.isFinite(monto) || monto <= 0) {
      setErrorLocal("El monto total debe ser un número mayor a 0.");
      return false;
    }
    return true;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validarLocal()) return;
    setServerError(null);

    startTransition(async () => {
      const resultado = await registrarComprobanteProveedor(ordenCompraId, {
        tipo,
        numero_comprobante: numero.trim(),
        fecha_emision: fechaEmision,
        monto_total: Number(montoTotal),
        ...(archivoUrl.trim().length > 0
          ? { archivo_adjunto_url: archivoUrl.trim() }
          : {}),
      });
      if (resultado.error) {
        setServerError(resultado.error.message);
        return;
      }
      // Refetch del listado ANTES de resetear/cerrar el modal: mismo orden que
      // `PasoTransferencia` (HU-A11) — `router.refresh()` corre con el
      // componente montado y estable, sin teardown del Dialog de por medio.
      router.refresh();
      toast.add({
        title: "Comprobante registrado",
        description: `${TIPO_LABEL[tipo]} N.° ${numero.trim()} — orden ${numeroOrden}.`,
        type: "success",
      });
      handleOpenChange(false);
    });
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button type="button" size="sm" className="gap-1.5" />}>
        <FilePlus2 className="size-3.5" aria-hidden="true" />
        Registrar comprobante
      </DialogTrigger>

      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FilePlus2 className="size-4 text-blue-600" aria-hidden="true" />
            Registrar comprobante — {numeroOrden}
          </DialogTitle>
          <DialogDescription>
            Carga manual del comprobante fiscal que el proveedor envió como
            respaldo de esta orden. No hay integración con AFIP: es un registro
            administrativo. Una vez creado, el comprobante no se edita — solo se
            anula.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {serverError && (
            <Alert variant="destructive">
              <AlertTriangle className="size-4" aria-hidden="true" />
              <AlertDescription>{serverError}</AlertDescription>
            </Alert>
          )}
          {errorLocal && (
            <Alert variant="destructive">
              <AlertDescription>{errorLocal}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="comprobante-tipo">Tipo de comprobante</Label>
            <select
              id="comprobante-tipo"
              value={tipo}
              onChange={(e) =>
                setTipo(e.target.value as (typeof TIPOS_COMPROBANTE)[number])
              }
              className={CAMPO_CLASS}
            >
              {TIPOS_COMPROBANTE.map((t) => (
                <option key={t} value={t}>
                  {TIPO_LABEL[t]}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="comprobante-numero">Número de comprobante</Label>
            <Input
              id="comprobante-numero"
              value={numero}
              onChange={(e) => setNumero(e.target.value)}
              placeholder="0001-00012345"
              maxLength={100}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="comprobante-fecha">Fecha de emisión</Label>
              <Input
                id="comprobante-fecha"
                type="date"
                value={fechaEmision}
                onChange={(e) => setFechaEmision(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="comprobante-monto">Monto total</Label>
              <Input
                id="comprobante-monto"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={montoTotal}
                onChange={(e) => setMontoTotal(e.target.value)}
                placeholder="0.00"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="comprobante-archivo">
              URL del archivo adjunto{" "}
              <span className="font-normal text-muted-foreground">(opcional)</span>
            </Label>
            <Input
              id="comprobante-archivo"
              type="url"
              value={archivoUrl}
              onChange={(e) => setArchivoUrl(e.target.value)}
              placeholder="https://…/comprobante.pdf"
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={isPending}
              onClick={() => handleOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={isPending} className="gap-2">
              {isPending ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  Registrando…
                </>
              ) : (
                <>
                  <FilePlus2 className="size-4" aria-hidden="true" />
                  Registrar
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
