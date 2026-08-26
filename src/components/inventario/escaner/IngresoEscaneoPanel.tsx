"use client";

/**
 * @component IngresoEscaneoPanel
 * @description Orquestador del flujo de ingreso de mercadería por escaneo
 * (HU-2): cámara → resolución de código → confirmación → registro
 * transaccional. Pensado para escaneo en lote (recepción de un remito con
 * múltiples ítems): tras cada ingreso exitoso, vuelve automáticamente al
 * estado de escaneo.
 */
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  ScanBarcode,
  PackageCheck,
  PackageSearch,
  Loader2,
  CircleAlert,
  CheckCircle2,
  Building2,
  Hash,
  FileText,
  BadgeCheck,
  Keyboard,
} from "lucide-react";

import {
  RegistrarIngresoPorEscaneoSchema,
  IMPACTO_STOCK_POR_ESTADO_DESTINO,
  type IngresoEstadoDestino,
} from "@/lib/schemas/inventario.schema";
import {
  resolverCodigoEscaneoAction,
  registrarIngresoStockAction,
} from "@/app/(dashboard)/inventario/movimientos/actions";
import type { CodigoResuelto, IngresoRegistrado } from "@/lib/services/inventario/movimiento.service";
import type { DepositoActivo } from "@/lib/services/inventario/deposito.service";

import { CameraBarcodeScanner } from "@/components/inventario/escaner/CameraBarcodeScanner";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from "@/components/ui/form";
import { toast } from "@/components/ui/toast";

// ──────────────────────────────────────────────────────────────────────────────
// Tipos
// ──────────────────────────────────────────────────────────────────────────────

type Estado = "escaneando" | "resolviendo" | "confirmando" | "registrando" | "exito";

type IngresoFormValues = {
  variante_sku_id: string;
  deposito_destino_id: string;
  /**
   * `number` en los valores por defecto/reset; `string` mientras el usuario
   * edita el input (ver `onChange` del campo Cantidad) — así el campo nunca
   * queda controlado por un `NaN` a mitad de tipeo (ej. al escribir "." o
   * "-"). La conversión final a entero la hace el `preprocess` de
   * `RegistrarIngresoPorEscaneoSchema` al validar/enviar.
   */
  cantidad: number | string;
  comprobante_referencia: string;
  estado_destino:
    | "DISPONIBLE"
    | "RESERVADO"
    | "VENDIDO"
    | "DEVUELTO"
    | "BAJA_MERMA";
  es_serializado: boolean;
  numero_serie?: string;
};

interface ItemHistorial {
  id: string;
  sku: string;
  producto_nombre: string;
  cantidad: number;
  estado_destino: string;
  impacto_stock: "SUMA" | "RESTA";
  stock_resultante: number;
  ts: number;
}

interface IngresoEscaneoPanelProps {
  depositos: DepositoActivo[];
}

const ESTADOS_DESTINO: IngresoFormValues["estado_destino"][] = [
  "DISPONIBLE",
  "RESERVADO",
  "VENDIDO",
  "DEVUELTO",
  "BAJA_MERMA",
];

const selectClassName =
  "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50";

// ──────────────────────────────────────────────────────────────────────────────
// Componente
// ──────────────────────────────────────────────────────────────────────────────

export function IngresoEscaneoPanel({ depositos }: IngresoEscaneoPanelProps) {
  const [estado, setEstado] = useState<Estado>("escaneando");
  const [resuelto, setResuelto] = useState<CodigoResuelto | null>(null);
  const [errorResolucion, setErrorResolucion] = useState<string | null>(null);
  const [errorRegistro, setErrorRegistro] = useState<string | null>(null);
  const [ultimoResultado, setUltimoResultado] = useState<IngresoRegistrado | null>(null);
  const [historial, setHistorial] = useState<ItemHistorial[]>([]);
  const [codigoManual, setCodigoManual] = useState("");

  const estadoRef = useRef(estado);
  useEffect(() => {
    estadoRef.current = estado;
  }, [estado]);

  // Tras un ingreso exitoso, vuelve automáticamente al escaneo (flujo en lote).
  useEffect(() => {
    if (estado !== "exito") return;
    const id = setTimeout(() => {
      setUltimoResultado(null);
      setEstado("escaneando");
    }, 1600);
    return () => clearTimeout(id);
  }, [estado]);

  const form = useForm<IngresoFormValues>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(RegistrarIngresoPorEscaneoSchema) as any,
    defaultValues: {
      deposito_destino_id: depositos[0]?.id ?? "",
      cantidad: 1,
      comprobante_referencia: "",
      estado_destino: "DISPONIBLE",
      es_serializado: false,
    },
  });

  // ── Paso 1: código detectado por la cámara ──────────────────────────────
  async function handleDetect(codigo: string) {
    if (estadoRef.current !== "escaneando") return;

    setEstado("resolviendo");
    setErrorResolucion(null);

    const resultado = await resolverCodigoEscaneoAction(codigo);

    if (!resultado.success || !resultado.data) {
      setErrorResolucion(resultado.error?.message ?? "Código no reconocido.");
      setEstado("escaneando");
      return;
    }

    const variante = resultado.data;
    const depositoPrevio = form.getValues("deposito_destino_id");
    const comprobantePrevio = form.getValues("comprobante_referencia");

    form.reset({
      variante_sku_id: variante.variante_sku_id,
      deposito_destino_id: depositoPrevio || depositos[0]?.id || "",
      cantidad: 1,
      comprobante_referencia: comprobantePrevio,
      estado_destino: "DISPONIBLE",
      es_serializado: variante.es_serializado,
      numero_serie: variante.numero_serie ?? undefined,
    });

    setResuelto(variante);
    setEstado("confirmando");
  }

  // ── Ingreso manual de código — fallback cuando la cámara no está
  // disponible (sin cámara en el dispositivo, permiso denegado, etiqueta
  // dañada/ilegible). Reutiliza el mismo flujo de resolución que la cámara.
  async function handleDetectManual(e: FormEvent) {
    e.preventDefault();
    const codigo = codigoManual.trim();
    if (!codigo || estado !== "escaneando") return;
    setCodigoManual("");
    await handleDetect(codigo);
  }

  // ── Paso 2: confirmación y registro transaccional ───────────────────────
  async function onSubmit(data: IngresoFormValues) {
    setEstado("registrando");
    setErrorRegistro(null);

    const resultado = await registrarIngresoStockAction(data);

    if (!resultado.success || !resultado.data) {
      setErrorRegistro(resultado.error?.message ?? "No se pudo registrar el ingreso.");
      setEstado("confirmando");
      return;
    }

    setUltimoResultado(resultado.data);
    setHistorial((prev) =>
      [
        {
          id: resultado.data!.movimiento_id,
          sku: resuelto?.sku ?? "",
          producto_nombre: resuelto?.producto_nombre ?? "",
          cantidad: resultado.data!.cantidad,
          estado_destino: resultado.data!.estado_destino,
          impacto_stock: resultado.data!.impacto_stock,
          stock_resultante: resultado.data!.stock_resultante.cantidad,
          ts: Date.now(),
        },
        ...prev,
      ].slice(0, 8),
    );
    setResuelto(null);
    setEstado("exito");
  }

  function cancelarConfirmacion() {
    setResuelto(null);
    setErrorRegistro(null);
    setEstado("escaneando");
  }

  const cantidad = useWatch({ control: form.control, name: "cantidad" });
  const esSerializado = resuelto?.es_serializado ?? false;
  // El botón solo debe mostrar cantidades válidas — `cantidad` puede ser
  // string (mientras se edita), negativa, decimal o vacía.
  const cantidadNumerica = typeof cantidad === "number" ? cantidad : Number(cantidad);
  const cantidadMostrada =
    Number.isInteger(cantidadNumerica) && cantidadNumerica > 0 ? cantidadNumerica : 1;

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.05fr_1fr] lg:items-start">
      {/* ── Columna cámara ──────────────────────────────────────────────── */}
      <Card className="overflow-hidden">
        <CardHeader className="border-b border-border">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <ScanBarcode className="size-4 text-blue-600" aria-hidden="true" />
            Escaneo de mercadería
          </CardTitle>
          <CardDescription>
            Apuntá al código EAN-13, Code128 o QR impreso en la etiqueta.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 pt-5">
          <CameraBarcodeScanner onDetect={handleDetect} activo={estado === "escaneando"} />

          {/* Alta manual — fallback cuando la cámara no está disponible o el
              código está dañado/ilegible. */}
          <form onSubmit={handleDetectManual} className="flex items-center gap-2">
            <div className="relative flex-1">
              <Keyboard
                className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                value={codigoManual}
                onChange={(e) => setCodigoManual(e.target.value)}
                placeholder="O ingresá el código manualmente"
                aria-label="Código manual de la variante"
                disabled={estado !== "escaneando"}
                className="pl-8 focus-visible:border-blue-500 focus-visible:ring-blue-500/30"
              />
            </div>
            <Button
              type="submit"
              variant="outline"
              disabled={estado !== "escaneando" || !codigoManual.trim()}
            >
              Buscar
            </Button>
          </form>

          {estado === "resolviendo" && (
            <div className="flex items-center justify-center gap-2 rounded-lg bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Resolviendo código…
            </div>
          )}

          {errorResolucion && estado === "escaneando" && (
            <Alert variant="destructive">
              <CircleAlert className="size-4" aria-hidden="true" />
              <AlertDescription>{errorResolucion}</AlertDescription>
            </Alert>
          )}

          {estado === "exito" && ultimoResultado && (
            <Alert
              className={
                ultimoResultado.impacto_stock === "SUMA"
                  ? "border-blue-200 bg-blue-50"
                  : "border-amber-200 bg-amber-50"
              }
            >
              {ultimoResultado.impacto_stock === "SUMA" ? (
                <CheckCircle2 className="size-4 text-blue-600" aria-hidden="true" />
              ) : (
                <CircleAlert className="size-4 text-amber-600" aria-hidden="true" />
              )}
              <AlertDescription
                className={
                  ultimoResultado.impacto_stock === "SUMA" ? "text-blue-800" : "text-amber-800"
                }
              >
                {ultimoResultado.impacto_stock === "SUMA" ? (
                  <>
                    Ingreso registrado. Stock disponible en depósito:{" "}
                    <span className="font-semibold">{ultimoResultado.stock_resultante.cantidad}</span>{" "}
                    unidades.
                  </>
                ) : (
                  <>
                    Movimiento registrado como{" "}
                    <span className="font-semibold">
                      {ultimoResultado.estado_destino.replaceAll("_", " ")}
                    </span>
                    . Se restaron {ultimoResultado.cantidad} unidades del stock disponible (queda en{" "}
                    <span className="font-semibold">{ultimoResultado.stock_resultante.cantidad}</span>{" "}
                    unidades).
                  </>
                )}
              </AlertDescription>
            </Alert>
          )}

          {/* Historial de la sesión */}
          {historial.length > 0 && (
            <div className="space-y-1.5 pt-1">
              <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                Ingresados en esta sesión
              </p>
              <ul className="space-y-1">
                {historial.map((item) => (
                  <li
                    key={`${item.id}-${item.ts}`}
                    className="flex items-center justify-between gap-2 rounded-lg bg-blue-50/60 px-3 py-1.5 text-xs text-blue-900"
                  >
                    <span className="flex items-center gap-1.5 truncate">
                      <PackageCheck className="size-3.5 shrink-0 text-blue-600" aria-hidden="true" />
                      <span className="truncate">{item.producto_nombre || item.sku}</span>
                    </span>
                    {item.impacto_stock === "SUMA" ? (
                      <Badge className="shrink-0 bg-blue-600 text-white">+{item.cantidad}</Badge>
                    ) : (
                      <Badge
                        variant="outline"
                        className="shrink-0 border-amber-300 text-amber-700"
                      >
                        {item.estado_destino.replaceAll("_", " ")} −{item.cantidad}
                      </Badge>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Columna confirmación ────────────────────────────────────────── */}
      <Card>
        <CardHeader className="border-b border-border">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <PackageSearch className="size-4 text-blue-600" aria-hidden="true" />
            Confirmar ingreso
          </CardTitle>
          <CardDescription>
            {estado === "confirmando" || estado === "registrando"
              ? "Revisá los datos resueltos por el escáner antes de registrar."
              : "Escaneá un código para ver el detalle de la variante aquí."}
          </CardDescription>
        </CardHeader>

        <CardContent className="pt-5">
          {!resuelto && estado !== "registrando" && (
            <div className="flex flex-col items-center justify-center gap-2 py-10 text-center text-sm text-muted-foreground">
              <ScanBarcode className="size-8 text-blue-200" aria-hidden="true" />
              Sin código resuelto todavía.
            </div>
          )}

          {resuelto && (
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5" noValidate>
                {/* Resumen de la variante resuelta */}
                <div className="space-y-2 rounded-xl border border-blue-100 bg-blue-50/50 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-bold text-blue-950">{resuelto.producto_nombre}</p>
                    {esSerializado ? (
                      <Badge className="gap-1 bg-blue-600 text-white">
                        <BadgeCheck className="size-3" aria-hidden="true" />
                        Serializado
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="border-blue-200 text-blue-700">
                        Estándar
                      </Badge>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1.5 text-xs">
                    <span className="rounded-md bg-white px-2 py-0.5 font-mono text-blue-700 ring-1 ring-blue-200">
                      {resuelto.sku}
                    </span>
                    <span className="rounded-md bg-white px-2 py-0.5 text-blue-700 ring-1 ring-blue-200">
                      Talle {resuelto.talle}
                    </span>
                    <span className="rounded-md bg-white px-2 py-0.5 text-blue-700 ring-1 ring-blue-200">
                      {resuelto.color}
                    </span>
                    {esSerializado && resuelto.numero_serie && (
                      <span className="rounded-md bg-white px-2 py-0.5 font-mono text-blue-700 ring-1 ring-blue-200">
                        Serie: {resuelto.numero_serie}
                      </span>
                    )}
                  </div>
                </div>

                {errorRegistro && (
                  <Alert variant="destructive">
                    <CircleAlert className="size-4" aria-hidden="true" />
                    <AlertDescription>{errorRegistro}</AlertDescription>
                  </Alert>
                )}

                <div className="grid grid-cols-2 gap-4">
                  {/* Cantidad */}
                  <FormField
                    control={form.control}
                    name="cantidad"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-gray-700 uppercase">
                          <Hash className="size-3.5" aria-hidden="true" />
                          Cantidad
                        </FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            type="number"
                            min={1}
                            disabled={esSerializado}
                            className="focus-visible:border-blue-500 focus-visible:ring-blue-500/30"
                            // Se pasa el string crudo, NUNCA `valueAsNumber`: para un
                            // input controlado, un valor intermedio inválido (ej. "."
                            // o "-" solos) hace que `valueAsNumber` sea NaN, y asignarle
                            // NaN al `value` de un <input type="number"> controlado hace
                            // que el navegador borre todo lo tipeado. El string se
                            // conserva tal cual el usuario lo escribe; la conversión a
                            // entero la hace el `preprocess` del schema al validar.
                            onChange={(e) => field.onChange(e.target.value)}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* Estado destino */}
                  <FormField
                    control={form.control}
                    name="estado_destino"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs font-semibold tracking-wide text-gray-700 uppercase">
                          Estado
                        </FormLabel>
                        <FormControl>
                          <select
                            {...field}
                            className={selectClassName}
                            onChange={(e) => {
                              field.onChange(e);
                              const nuevoImpacto =
                                IMPACTO_STOCK_POR_ESTADO_DESTINO[
                                  e.target.value as IngresoEstadoDestino
                                ];
                              if (nuevoImpacto === "RESTA") {
                                toast.add({
                                  title: "Este estado resta del stock disponible del depósito.",
                                  type: "warning",
                                });
                              }
                            }}
                          >
                            {ESTADOS_DESTINO.map((estadoDestino) => (
                              <option key={estadoDestino} value={estadoDestino}>
                                {estadoDestino.replaceAll("_", " ")}
                              </option>
                            ))}
                          </select>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                {/* Depósito destino */}
                <FormField
                  control={form.control}
                  name="deposito_destino_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-gray-700 uppercase">
                        <Building2 className="size-3.5" aria-hidden="true" />
                        Depósito destino
                      </FormLabel>
                      <FormControl>
                        <select {...field} className={selectClassName}>
                          {depositos.length === 0 && <option value="">Sin depósitos activos</option>}
                          {depositos.map((deposito) => (
                            <option key={deposito.id} value={deposito.id}>
                              {deposito.nombre} — {deposito.tipo}
                            </option>
                          ))}
                        </select>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Comprobante */}
                <FormField
                  control={form.control}
                  name="comprobante_referencia"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-gray-700 uppercase">
                        <FileText className="size-3.5" aria-hidden="true" />
                        Comprobante / remito
                      </FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          placeholder="Ej: REM-2026-001"
                          autoComplete="off"
                          maxLength={100}
                          className="focus-visible:border-blue-500 focus-visible:ring-blue-500/30"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="flex gap-2 pt-1">
                  <Button
                    type="button"
                    variant="outline"
                    className="flex-1"
                    onClick={cancelarConfirmacion}
                    disabled={estado === "registrando"}
                  >
                    Cancelar
                  </Button>
                  <Button
                    type="submit"
                    className="flex-1 gap-2 bg-blue-600 text-white hover:bg-blue-700"
                    disabled={estado === "registrando" || depositos.length === 0}
                  >
                    {estado === "registrando" ? (
                      <>
                        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                        Registrando…
                      </>
                    ) : (
                      <>
                        <PackageCheck className="size-4" aria-hidden="true" />
                        Confirmar ingreso ({cantidadMostrada})
                      </>
                    )}
                  </Button>
                </div>
              </form>
            </Form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
