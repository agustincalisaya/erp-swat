"use client";

/**
 * @component FormularioVentaMostrador
 * @description Venta de mostrador con cobro multimedio (HU-B1, spec_modulo_B.md
 * §2.1). Conecta con la Server Action `registrarVentaMostradorAction` —
 * wrapper fino sobre `venta-mostrador.service.ts`, la lógica de negocio no
 * vive acá.
 *
 * Mismo patrón visual que `FormularioNuevoPresupuesto.tsx` (`useState`
 * manual con filas dinámicas de ítems, sin react-hook-form) + un bloque
 * nuevo de medios de pago con la misma forma de filas dinámicas. La
 * validación de "la suma de medios de pago = total" corre en el cliente
 * ANTES de habilitar "Confirmar" (UX preventiva) reusando las MISMAS
 * funciones puras que el schema/servicio (`venta-mostrador.calculo.ts`) — la
 * validación real, la que importa, es la del backend (`.refine()` del
 * schema + revalidación en el servicio).
 *
 * Si la venta queda con algún ítem fuera del margen de descuento habilitado
 * (`MARGEN_DESCUENTO_CAJERO_POS`), el backend la persiste igual pero sin
 * comprobante (`comprobante_id: null`) — el panel de resultado muestra un
 * mensaje claro de espera de Supervisor, NUNCA un error genérico (task §5).
 */

import { useId, useMemo, useState, useTransition } from "react";
import { Plus, Trash2, Loader2, Receipt, Info, CheckCircle2, Clock, ShoppingCart, Eye } from "lucide-react";

import { registrarVentaMostradorAction } from "@/app/(dashboard)/ventas/pos/actions";
import { ComboboxFiltrable } from "@/components/inventario/ComboboxFiltrable";
import { ModalComprobanteFiscal } from "@/components/ventas/ModalComprobanteFiscal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { ClienteParaSelector, VarianteParaCotizacion } from "@/lib/services/ventas/presupuesto.service";
import type { DepositoActivo } from "@/lib/services/inventario/deposito.service";
import type { VentaMostradorRegistrada } from "@/lib/services/ventas/venta-mostrador.service";
import { MARGEN_DESCUENTO_CAJERO_POS } from "@/lib/services/ventas/venta-mostrador.constants";
import { calcularTotalVenta, sumarMediosPago, TOLERANCIA_CENTAVOS } from "@/lib/services/ventas/venta-mostrador.calculo";

interface FormularioVentaMostradorProps {
  clientes: ClienteParaSelector[];
  variantes: VarianteParaCotizacion[];
  depositos: DepositoActivo[];
}

interface ItemFila {
  key: string;
  variante_sku_id: string;
  deposito_id: string;
  cantidad: string;
  precio_unitario: string;
  descuento_porcentual: string;
}

interface MedioPagoFila {
  key: string;
  medio: "EFECTIVO" | "TRANSFERENCIA" | "E_CHEQ" | "MERCADO_PAGO" | "TARJETA";
  importe: string;
  referencia: string;
}

const MEDIOS_PAGO_OPCIONES: { value: MedioPagoFila["medio"]; label: string }[] = [
  { value: "EFECTIVO", label: "Efectivo" },
  { value: "TRANSFERENCIA", label: "Transferencia" },
  { value: "E_CHEQ", label: "E-Cheq" },
  { value: "MERCADO_PAGO", label: "Mercado Pago" },
  { value: "TARJETA", label: "Tarjeta" },
];

const TIPO_COMPROBANTE_OPCIONES = [
  { value: "TICKET" as const, label: "Ticket" },
  { value: "FACTURA_B" as const, label: "Factura B" },
  { value: "FACTURA_A" as const, label: "Factura A" },
];

function nuevaFilaItem(depositoIdPorDefecto: string): ItemFila {
  return {
    key: crypto.randomUUID(),
    variante_sku_id: "",
    deposito_id: depositoIdPorDefecto,
    cantidad: "1",
    precio_unitario: "",
    descuento_porcentual: "",
  };
}

function nuevaFilaMedioPago(): MedioPagoFila {
  return { key: crypto.randomUUID(), medio: "EFECTIVO", importe: "", referencia: "" };
}

const formatearMoneda = (valor: number) =>
  valor.toLocaleString("es-AR", { style: "currency", currency: "ARS" });

export function FormularioVentaMostrador({ clientes, variantes, depositos }: FormularioVentaMostradorProps) {
  const [isPending, startTransition] = useTransition();
  const formId = useId();

  const depositoPorDefecto = depositos[0]?.id ?? "";

  const [clienteId, setClienteId] = useState("");
  const [items, setItems] = useState<ItemFila[]>(() => [nuevaFilaItem(depositoPorDefecto)]);
  const [mediosPago, setMediosPago] = useState<MedioPagoFila[]>(() => [nuevaFilaMedioPago()]);
  const [tipoComprobante, setTipoComprobante] = useState<(typeof TIPO_COMPROBANTE_OPCIONES)[number]["value"]>("TICKET");

  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [errorItems, setErrorItems] = useState<string | null>(null);
  const [errorMediosPago, setErrorMediosPago] = useState<string | null>(null);
  const [resultado, setResultado] = useState<VentaMostradorRegistrada | null>(null);
  const [comprobanteAVer, setComprobanteAVer] = useState<string | null>(null);

  const skuPorId = useMemo(() => new Map(variantes.map((v) => [v.id, v.sku])), [variantes]);

  // ── Ítems ─────────────────────────────────────────────────────────────
  const setFilaItem = (key: string, cambios: Partial<ItemFila>) => {
    setItems((prev) => prev.map((f) => (f.key === key ? { ...f, ...cambios } : f)));
  };
  const agregarFilaItem = () => setItems((prev) => [...prev, nuevaFilaItem(depositoPorDefecto)]);
  const quitarFilaItem = (key: string) =>
    setItems((prev) => (prev.length === 1 ? prev : prev.filter((f) => f.key !== key)));

  // ── Medios de pago ───────────────────────────────────────────────────
  const setFilaMedioPago = (key: string, cambios: Partial<MedioPagoFila>) => {
    setMediosPago((prev) => prev.map((f) => (f.key === key ? { ...f, ...cambios } : f)));
  };
  const agregarFilaMedioPago = () => setMediosPago((prev) => [...prev, nuevaFilaMedioPago()]);
  const quitarFilaMedioPago = (key: string) =>
    setMediosPago((prev) => (prev.length === 1 ? prev : prev.filter((f) => f.key !== key)));

  // ── Totales (mismas funciones puras que el schema/servicio) ─────────
  const itemsCargados = items.filter((f) => f.variante_sku_id);
  const totalItems = calcularTotalVenta(
    itemsCargados.map((f) => ({
      precio_unitario: Number(f.precio_unitario) || 0,
      cantidad: Number(f.cantidad) || 0,
      descuento_porcentual: f.descuento_porcentual ? Number(f.descuento_porcentual) : null,
    })),
  );
  const mediosCargados = mediosPago.filter((m) => m.importe);
  const totalPagos = sumarMediosPago(mediosCargados.map((m) => ({ importe: Number(m.importe) || 0 })));
  const sumaCoincide = Math.abs(totalItems - totalPagos) < TOLERANCIA_CENTAVOS;

  const hayItemFueraDeMargen = itemsCargados.some(
    (f) => Number(f.descuento_porcentual || 0) > MARGEN_DESCUENTO_CAJERO_POS,
  );

  const validarLocal = (): boolean => {
    setErrorGeneral(null);
    setErrorItems(null);
    setErrorMediosPago(null);

    if (itemsCargados.length === 0) {
      setErrorItems("Agregá al menos un ítem a la venta.");
      return false;
    }
    for (const fila of itemsCargados) {
      const cantidad = Number(fila.cantidad);
      const precio = Number(fila.precio_unitario);
      const descuento = fila.descuento_porcentual ? Number(fila.descuento_porcentual) : 0;
      if (!Number.isInteger(cantidad) || cantidad <= 0) {
        setErrorItems(`La cantidad de ${skuPorId.get(fila.variante_sku_id) ?? "la variante"} debe ser un entero mayor a 0.`);
        return false;
      }
      if (!Number.isFinite(precio) || precio <= 0) {
        setErrorItems(`El precio de ${skuPorId.get(fila.variante_sku_id) ?? "la variante"} debe ser mayor a 0.`);
        return false;
      }
      if (descuento < 0 || descuento > 100) {
        setErrorItems(`El descuento de ${skuPorId.get(fila.variante_sku_id) ?? "la variante"} debe estar entre 0 y 100.`);
        return false;
      }
      if (!fila.deposito_id) {
        setErrorItems(`Elegí el depósito de origen de ${skuPorId.get(fila.variante_sku_id) ?? "la variante"}.`);
        return false;
      }
    }
    if (mediosCargados.length === 0) {
      setErrorMediosPago("Indicá al menos un medio de pago.");
      return false;
    }
    for (const medio of mediosCargados) {
      const importe = Number(medio.importe);
      if (!Number.isFinite(importe) || importe <= 0) {
        setErrorMediosPago("Cada medio de pago debe tener un importe mayor a 0.");
        return false;
      }
    }
    if (!sumaCoincide) {
      setErrorMediosPago(
        `La suma de los medios de pago (${formatearMoneda(totalPagos)}) debe igualar el total de la venta (${formatearMoneda(totalItems)}).`,
      );
      return false;
    }
    return true;
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validarLocal()) return;

    const payload = {
      ...(clienteId ? { cliente_id: clienteId } : {}),
      items: itemsCargados.map((f) => ({
        variante_sku_id: f.variante_sku_id,
        deposito_id: f.deposito_id,
        cantidad: Number(f.cantidad),
        precio_unitario: Number(f.precio_unitario),
        ...(f.descuento_porcentual ? { descuento_porcentual: Number(f.descuento_porcentual) } : {}),
      })),
      medios_pago: mediosCargados.map((m) => ({
        medio: m.medio,
        importe: Number(m.importe),
        ...(m.referencia.trim() ? { referencia: m.referencia.trim() } : {}),
      })),
      tipo_comprobante: tipoComprobante,
    };

    startTransition(async () => {
      const res = await registrarVentaMostradorAction(payload);
      if (res.error) {
        const { code, message } = res.error;
        if (code === "CLIENTE_NO_ENCONTRADO") {
          setErrorGeneral(message);
          return;
        }
        if (code === "VARIANTE_NO_ENCONTRADA" || code === "DEPOSITO_NO_ENCONTRADO" || code === "STOCK_INSUFICIENTE") {
          setErrorItems(message);
          return;
        }
        setErrorGeneral(message);
        return;
      }
      setResultado(res.data);
    });
  };

  const nuevaVenta = () => {
    setResultado(null);
    setClienteId("");
    setItems([nuevaFilaItem(depositoPorDefecto)]);
    setMediosPago([nuevaFilaMedioPago()]);
    setTipoComprobante("TICKET");
    setErrorGeneral(null);
    setErrorItems(null);
    setErrorMediosPago(null);
  };

  // ── Panel de resultado ───────────────────────────────────────────────
  if (resultado) {
    const pendienteAutorizacion = resultado.comprobante_id === null;
    return (
      <div className="space-y-5">
        {pendienteAutorizacion ? (
          <Alert className="border-amber-300 bg-amber-50">
            <Clock className="size-4 text-amber-600" aria-hidden="true" />
            <AlertDescription className="text-amber-900">
              <p className="font-semibold">Venta registrada — a la espera de un Supervisor</p>
              <p className="mt-1">
                Al menos un ítem superó el margen de descuento habilitado
                ({MARGEN_DESCUENTO_CAJERO_POS}%) y quedó pendiente de
                autorización. El cobro ya fue recibido y quedó asentado, pero
                el comprobante fiscal recién se emite cuando un Supervisor de
                Ventas autorice el/los ítem(s) pendiente(s).
              </p>
            </AlertDescription>
          </Alert>
        ) : (
          <Alert className="border-green-300 bg-green-50">
            <CheckCircle2 className="size-4 text-green-600" aria-hidden="true" />
            <AlertDescription className="text-green-900">
              <p className="font-semibold">Venta registrada y facturada correctamente</p>
              <p className="mt-1">El comprobante fiscal ya fue emitido (simulado, sin AFIP real).</p>
            </AlertDescription>
          </Alert>
        )}

        <dl className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-muted/20 p-4 text-sm">
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">N° de venta</dt>
            <dd className="font-semibold text-gray-900">{resultado.numero_venta}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">Total</dt>
            <dd className="font-semibold text-gray-900">{formatearMoneda(resultado.total)}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">Tipo de comprobante</dt>
            <dd className="font-semibold text-gray-900">{resultado.tipo_comprobante}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">Comprobante</dt>
            <dd className="font-semibold text-gray-900">
              {resultado.comprobante_id ?? "Pendiente de autorización"}
            </dd>
          </div>
        </dl>

        <div className="flex items-center gap-2">
          <Button onClick={nuevaVenta} className="gap-2 bg-blue-600 hover:bg-blue-700 text-white">
            <ShoppingCart className="size-4" />
            Registrar otra venta
          </Button>
          {resultado.comprobante_id !== null && (
            <Button
              type="button"
              variant="outline"
              className="gap-2"
              onClick={() => setComprobanteAVer(resultado.comprobante_id)}
            >
              <Eye className="size-4" />
              Ver comprobante
            </Button>
          )}
        </div>

        <ModalComprobanteFiscal comprobanteId={comprobanteAVer} onClose={() => setComprobanteAVer(null)} />
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6" noValidate>
      {errorGeneral && (
        <Alert variant="destructive">
          <AlertDescription>{errorGeneral}</AlertDescription>
        </Alert>
      )}

      {/* ── Cliente (opcional) ──────────────────────────────────────────── */}
      <div className="space-y-1.5">
        <Label htmlFor="pos-cliente" className="text-xs font-semibold uppercase tracking-wide text-gray-700">
          Cliente <span className="font-normal text-muted-foreground">(opcional)</span>
        </Label>
        <ComboboxFiltrable
          id="pos-cliente"
          items={clientes}
          getId={(c) => c.id}
          getLabel={(c) => `${c.nombre} (DNI ${c.dni})`}
          value={clienteId}
          onChange={(c) => setClienteId(c.id)}
          placeholder="Buscar cliente… (dejar vacío para venta sin identificar)"
          emptyMessage="No hay clientes activos."
          pageSize={8}
        />
      </div>

      {/* ── Ítems ───────────────────────────────────────────────────────── */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-semibold uppercase tracking-wide text-gray-700">Ítems</Label>
          <Button type="button" variant="outline" size="sm" onClick={agregarFilaItem} className="gap-1.5">
            <Plus className="size-3.5" />
            Agregar ítem
          </Button>
        </div>

        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Info className="size-3.5 shrink-0" />
          Descuentos mayores a {MARGEN_DESCUENTO_CAJERO_POS}% quedan pendientes de
          autorización de un Supervisor de Ventas — la venta igual se
          registra y el cobro se recibe, pero el comprobante se emite recién
          después de la autorización.
        </p>

        <div className="space-y-2">
          {items.map((fila, indice) => {
            const varId = `${formId}-var-${indice}`;
            const depId = `${formId}-dep-${indice}`;
            const cantId = `${formId}-cant-${indice}`;
            const precioId = `${formId}-precio-${indice}`;
            const descId = `${formId}-desc-${indice}`;
            const descuentoNum = Number(fila.descuento_porcentual || 0);
            const excedeMargen = descuentoNum > MARGEN_DESCUENTO_CAJERO_POS;
            return (
              <div key={fila.key} className="flex flex-col gap-2 rounded-lg border border-border bg-muted/20 p-3">
                <div className="flex-1 space-y-1">
                  <Label htmlFor={varId} className="text-xs">
                    Variante
                  </Label>
                  <ComboboxFiltrable
                    id={varId}
                    items={variantes}
                    getId={(v) => v.id}
                    getLabel={(v) => `${v.sku} — ${v.descripcion}`}
                    value={fila.variante_sku_id}
                    onChange={(v) => setFilaItem(fila.key, { variante_sku_id: v.id })}
                    placeholder="Buscar SKU o producto…"
                    emptyMessage="Sin coincidencias."
                    pageSize={8}
                  />
                </div>
                <div className="flex flex-col sm:flex-row sm:items-end gap-2">
                  <div className="flex-1 space-y-1">
                    <Label htmlFor={depId} className="text-xs">
                      Depósito
                    </Label>
                    <select
                      id={depId}
                      value={fila.deposito_id}
                      onChange={(e) => setFilaItem(fila.key, { deposito_id: e.target.value })}
                      className="flex h-9 w-full rounded-md border border-input bg-background px-2.5 py-1 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                    >
                      <option value="">Elegí un depósito…</option>
                      {depositos.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.nombre}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="w-full sm:w-24 space-y-1">
                    <Label htmlFor={cantId} className="text-xs">
                      Cantidad
                    </Label>
                    <Input
                      id={cantId}
                      type="number"
                      min={1}
                      step={1}
                      value={fila.cantidad}
                      onChange={(e) => setFilaItem(fila.key, { cantidad: e.target.value })}
                      className="text-sm"
                    />
                  </div>
                  <div className="w-full sm:w-32 space-y-1">
                    <Label htmlFor={precioId} className="text-xs">
                      Precio unitario
                    </Label>
                    <Input
                      id={precioId}
                      type="number"
                      min={0.01}
                      step="0.01"
                      value={fila.precio_unitario}
                      onChange={(e) => setFilaItem(fila.key, { precio_unitario: e.target.value })}
                      className="text-sm"
                    />
                  </div>
                  <div className="w-full sm:w-28 space-y-1">
                    <Label htmlFor={descId} className="text-xs">
                      Descuento %
                    </Label>
                    <Input
                      id={descId}
                      type="number"
                      min={0}
                      max={100}
                      step="0.01"
                      value={fila.descuento_porcentual}
                      onChange={(e) => setFilaItem(fila.key, { descuento_porcentual: e.target.value })}
                      className={`text-sm ${excedeMargen ? "border-amber-400" : ""}`}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => quitarFilaItem(fila.key)}
                    disabled={items.length === 1}
                    aria-label="Quitar ítem"
                    className="text-muted-foreground hover:text-destructive shrink-0"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
                {excedeMargen && (
                  <p className="flex items-center gap-1.5 text-xs text-amber-700">
                    <Clock className="size-3.5 shrink-0" />
                    Este ítem quedará pendiente de autorización de un Supervisor.
                  </p>
                )}
              </div>
            );
          })}
        </div>

        {errorItems && <p className="text-xs text-destructive">{errorItems}</p>}
      </div>

      {/* ── Medios de pago ──────────────────────────────────────────────── */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-semibold uppercase tracking-wide text-gray-700">Medios de pago</Label>
          <Button type="button" variant="outline" size="sm" onClick={agregarFilaMedioPago} className="gap-1.5">
            <Plus className="size-3.5" />
            Agregar medio de pago
          </Button>
        </div>

        <div className="space-y-2">
          {mediosPago.map((fila, indice) => {
            const medioId = `${formId}-medio-${indice}`;
            const importeId = `${formId}-importe-${indice}`;
            const refId = `${formId}-ref-${indice}`;
            return (
              <div key={fila.key} className="flex flex-col sm:flex-row sm:items-end gap-2 rounded-lg border border-border bg-muted/20 p-3">
                <div className="flex-1 space-y-1">
                  <Label htmlFor={medioId} className="text-xs">
                    Medio
                  </Label>
                  <select
                    id={medioId}
                    value={fila.medio}
                    onChange={(e) => setFilaMedioPago(fila.key, { medio: e.target.value as MedioPagoFila["medio"] })}
                    className="flex h-9 w-full rounded-md border border-input bg-background px-2.5 py-1 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                  >
                    {MEDIOS_PAGO_OPCIONES.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="w-full sm:w-36 space-y-1">
                  <Label htmlFor={importeId} className="text-xs">
                    Importe
                  </Label>
                  <Input
                    id={importeId}
                    type="number"
                    min={0.01}
                    step="0.01"
                    value={fila.importe}
                    onChange={(e) => setFilaMedioPago(fila.key, { importe: e.target.value })}
                    className="text-sm"
                  />
                </div>
                <div className="flex-1 space-y-1">
                  <Label htmlFor={refId} className="text-xs">
                    Referencia <span className="font-normal text-muted-foreground">(opcional)</span>
                  </Label>
                  <Input
                    id={refId}
                    type="text"
                    value={fila.referencia}
                    onChange={(e) => setFilaMedioPago(fila.key, { referencia: e.target.value })}
                    placeholder="N° de operación, lote, etc."
                    className="text-sm"
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => quitarFilaMedioPago(fila.key)}
                  disabled={mediosPago.length === 1}
                  aria-label="Quitar medio de pago"
                  className="text-muted-foreground hover:text-destructive shrink-0"
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            );
          })}
        </div>

        {errorMediosPago && <p className="text-xs text-destructive">{errorMediosPago}</p>}
      </div>

      {/* ── Tipo de comprobante ─────────────────────────────────────────── */}
      <div className="space-y-1.5">
        <Label htmlFor="pos-comprobante" className="text-xs font-semibold uppercase tracking-wide text-gray-700">
          Tipo de comprobante
        </Label>
        <select
          id="pos-comprobante"
          value={tipoComprobante}
          onChange={(e) => setTipoComprobante(e.target.value as typeof tipoComprobante)}
          className="flex h-9 w-full max-w-xs rounded-md border border-input bg-background px-2.5 py-1 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
        >
          {TIPO_COMPROBANTE_OPCIONES.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      {/* ── Totales ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between rounded-lg border border-border bg-muted/20 p-3 text-sm">
        <span className="text-muted-foreground">Total ítems: {formatearMoneda(totalItems)}</span>
        <span className={sumaCoincide ? "text-green-700" : "text-destructive"}>
          Total medios de pago: {formatearMoneda(totalPagos)}
        </span>
      </div>
      {hayItemFueraDeMargen && (
        <p className="flex items-center gap-1.5 text-xs text-amber-700">
          <Clock className="size-3.5 shrink-0" />
          Esta venta tiene al menos un ítem pendiente de autorización — se
          registrará igual, pero sin comprobante hasta que un Supervisor lo
          resuelva.
        </p>
      )}

      <div className="flex items-center justify-end gap-2 pt-2">
        <Button
          type="submit"
          disabled={isPending || !sumaCoincide || itemsCargados.length === 0}
          className="bg-blue-600 hover:bg-blue-700 text-white gap-2"
        >
          {isPending ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Registrando…
            </>
          ) : (
            <>
              <Receipt className="size-4" />
              Confirmar venta
            </>
          )}
        </Button>
      </div>
    </form>
  );
}
