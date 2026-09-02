"use client";

/**
 * @component PasoIngreso
 * @description HU-A11 — paso 3 del wizard para tipo "Ingreso". Adapta la
 * lógica de la ex `IngresoEscaneoPanel.tsx` (HU-A2): cámara → resolución de
 * código → confirmación → registro transaccional. Reutiliza
 * `CameraBarcodeScanner`/`useBarcodeScanner`, `resolverCodigoEscaneoAction` y
 * `registrarIngresoStockAction` (`movimientos/actions.ts`) sin modificarlos.
 *
 * Multi-ítem (HU-A11): cada escaneo/código manual ya no dispara un submit
 * individual — arma un carrito local (editable/eliminable) y un único botón
 * "Confirmar ingreso" envía TODOS los ítems juntos en un solo llamado a
 * `registrarIngresoStockAction`, que ahora recibe `{ deposito_destino_id,
 * comprobante_referencia, items[] }` en vez de un ítem suelto —
 * `comprobante_referencia` pasa a ser un campo de cabecera del carrito
 * completo, no de cada ítem escaneado.
 *
 * Diferencia con el panel original: el depósito destino ya no se elige acá
 * — viene fijo del paso 1 del wizard (`deposito_destino_id` inyectado como
 * prop), spec_modulo_A.md §2.10.
 *
 * Tercera forma de agregar un ítem (mejora post-HU-A11): además de escaneo
 * QR/código de barras y código manual, un buscador por nombre/SKU con
 * `ComboboxFiltrable` — mismo componente y mismo patrón client-side que ya
 * usa `PasoTransferencia.tsx` sobre el catálogo `variantes` (prop, cargado
 * una sola vez por `movimientos/page.tsx`, compartido entre ambos pasos). Al
 * seleccionar, alimenta el mismo `resuelto`/mini-formulario de confirmación
 * que usan escaneo y manual — no hay una ruta de submit distinta.
 */
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  ScanBarcode,
  PackageCheck,
  PackageSearch,
  Loader2,
  CircleAlert,
  Building2,
  Hash,
  FileText,
  BadgeCheck,
  Keyboard,
  ShoppingCart,
  Trash2,
} from "lucide-react";

import {
  IngresoItemSchema,
  IMPACTO_STOCK_POR_ESTADO_DESTINO,
  type IngresoEstadoDestino,
} from "@/lib/schemas/inventario.schema";
import {
  resolverCodigoEscaneoAction,
  registrarIngresoStockAction,
} from "@/app/(dashboard)/inventario/movimientos/actions";
import type { CodigoResuelto } from "@/lib/services/inventario/movimiento.service";
import type { VarianteTransferible } from "@/lib/services/inventario/transferencia.service";

import { CameraBarcodeScanner } from "@/components/inventario/escaner/CameraBarcodeScanner";
import { ComboboxFiltrable } from "@/components/inventario/ComboboxFiltrable";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from "@/components/ui/form";
import { toast } from "@/components/ui/toast";

type Estado = "escaneando" | "resolviendo" | "confirmando" | "registrando";

type ItemConfirmValues = {
  cantidad: number | string;
  estado_destino: IngresoEstadoDestino;
  numero_serie?: string;
};

interface CarritoItem {
  key: string;
  variante_sku_id: string;
  sku: string;
  producto_nombre: string;
  talle: string;
  color: string;
  cantidad: number;
  estado_destino: IngresoEstadoDestino;
  es_serializado: boolean;
  numero_serie?: string;
}

interface PasoIngresoProps {
  depositoDestinoId: string;
  depositoDestinoNombre: string;
  variantes: VarianteTransferible[];
}

const ESTADOS_DESTINO: IngresoEstadoDestino[] = [
  "DISPONIBLE",
  "RESERVADO",
  "VENDIDO",
  "DEVUELTO",
  "BAJA_MERMA",
];

const selectClassName =
  "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50";

const ItemConfirmSchema = IngresoItemSchema.omit({ variante_sku_id: true });

function avisarSiResta(estadoDestino: IngresoEstadoDestino) {
  if (IMPACTO_STOCK_POR_ESTADO_DESTINO[estadoDestino] === "RESTA") {
    toast.add({
      title: "Este estado resta del stock disponible del depósito.",
      type: "warning",
    });
  }
}

export function PasoIngreso({ depositoDestinoId, depositoDestinoNombre, variantes }: PasoIngresoProps) {
  const [estado, setEstado] = useState<Estado>("escaneando");
  const [resuelto, setResuelto] = useState<CodigoResuelto | null>(null);
  const [errorResolucion, setErrorResolucion] = useState<string | null>(null);
  const [errorRegistro, setErrorRegistro] = useState<string | null>(null);
  const [carrito, setCarrito] = useState<CarritoItem[]>([]);
  const [comprobanteReferencia, setComprobanteReferencia] = useState("");
  const [codigoManual, setCodigoManual] = useState("");
  const [busquedaVarianteId, setBusquedaVarianteId] = useState("");

  const estadoRef = useRef(estado);
  useEffect(() => {
    estadoRef.current = estado;
  }, [estado]);

  const form = useForm<ItemConfirmValues>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(ItemConfirmSchema) as any,
    defaultValues: { cantidad: 1, estado_destino: "DISPONIBLE" },
  });

  /** Punto único de entrada a "confirmando" — lo comparten escaneo, código manual y búsqueda por nombre/SKU. */
  function confirmarVariante(variante: CodigoResuelto) {
    form.reset({
      cantidad: 1,
      estado_destino: "DISPONIBLE",
      numero_serie: variante.numero_serie ?? undefined,
    });
    setResuelto(variante);
    setEstado("confirmando");
  }

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

    confirmarVariante(resultado.data);
  }

  async function handleDetectManual(e: FormEvent) {
    e.preventDefault();
    const codigo = codigoManual.trim();
    if (!codigo || estado !== "escaneando") return;
    setCodigoManual("");
    await handleDetect(codigo);
  }

  /**
   * Tercera forma de resolver un ítem: búsqueda por nombre/SKU sobre el
   * catálogo `variantes` ya cargado (mismo `ComboboxFiltrable` y mismo
   * `items`/prop que `PasoTransferencia.tsx`, sin fetch extra). `detalle`
   * llega fusionado como `"talle · color"` (contrato ya fijado por
   * `listarVariantesTransferibles()`, `transferencia.service.ts`) — se
   * separa para reusar los mismos 2 badges que ya muestra el mini-formulario
   * de confirmación. `es_serializado`/`numero_serie` van en `false`/`null`
   * porque el catálogo no trae ese dato — mismo valor que ya resuelve
   * siempre `resolverCodigoEscaneo()` para cualquier variante, no es un caso
   * especial de la búsqueda.
   */
  function handleSeleccionarBusqueda(variante: VarianteTransferible) {
    if (estado !== "escaneando") return;
    const [talle, color] = variante.detalle.split(" · ");
    setBusquedaVarianteId("");
    confirmarVariante({
      variante_sku_id: variante.id,
      sku: variante.sku,
      producto_nombre: variante.nombre,
      talle,
      color,
      es_serializado: false,
      numero_serie: null,
    });
  }

  function agregarAlCarrito(data: ItemConfirmValues) {
    if (!resuelto) return;
    const cantidadNumerica = typeof data.cantidad === "number" ? data.cantidad : Number(data.cantidad);

    setCarrito((prev) => [
      ...prev,
      {
        key: `${resuelto.variante_sku_id}-${Date.now()}`,
        variante_sku_id: resuelto.variante_sku_id,
        sku: resuelto.sku,
        producto_nombre: resuelto.producto_nombre,
        talle: resuelto.talle,
        color: resuelto.color,
        cantidad: cantidadNumerica,
        estado_destino: data.estado_destino,
        es_serializado: resuelto.es_serializado,
        numero_serie: data.numero_serie,
      },
    ]);
    setResuelto(null);
    setEstado("escaneando");
  }

  function cancelarConfirmacion() {
    setResuelto(null);
    setEstado("escaneando");
  }

  function actualizarCantidadCarrito(key: string, cantidad: number) {
    setCarrito((prev) =>
      prev.map((item) => (item.key === key ? { ...item, cantidad: Math.max(1, Math.trunc(cantidad) || 1) } : item)),
    );
  }

  function actualizarEstadoCarrito(key: string, estadoDestino: IngresoEstadoDestino) {
    avisarSiResta(estadoDestino);
    setCarrito((prev) => prev.map((item) => (item.key === key ? { ...item, estado_destino: estadoDestino } : item)));
  }

  function quitarDelCarrito(key: string) {
    setCarrito((prev) => prev.filter((item) => item.key !== key));
  }

  function vaciarCarrito() {
    setCarrito([]);
    setComprobanteReferencia("");
  }

  async function confirmarCarrito() {
    if (carrito.length === 0) return;
    setEstado("registrando");
    setErrorRegistro(null);

    const resultado = await registrarIngresoStockAction({
      deposito_destino_id: depositoDestinoId,
      comprobante_referencia: comprobanteReferencia,
      items: carrito.map((item) => ({
        variante_sku_id: item.variante_sku_id,
        cantidad: item.cantidad,
        estado_destino: item.estado_destino,
        numero_serie: item.numero_serie,
      })),
    });

    if (!resultado.success || !resultado.data) {
      setErrorRegistro(resultado.error?.message ?? "No se pudo registrar el ingreso.");
      setEstado("escaneando");
      return;
    }

    toast.add({
      title: "Ingreso registrado",
      description: `${resultado.data.items.length} ítem${resultado.data.items.length === 1 ? "" : "s"} cargado${resultado.data.items.length === 1 ? "" : "s"} al depósito.`,
      type: "success",
    });
    setCarrito([]);
    setComprobanteReferencia("");
    setEstado("escaneando");
  }

  const esSerializado = resuelto?.es_serializado ?? false;
  const cantidadCarritoTotal = carrito.reduce((acumulado, item) => acumulado + item.cantidad, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 rounded-lg border border-blue-100 bg-blue-50/50 px-3 py-2 text-sm text-blue-900">
        <Building2 className="size-4 text-blue-600" aria-hidden="true" />
        Depósito destino: <span className="font-semibold">{depositoDestinoNombre}</span>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_1.1fr] lg:items-start">
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

            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <div className="h-px flex-1 bg-border" />
              O buscá el producto por nombre o SKU
              <div className="h-px flex-1 bg-border" />
            </div>
            <ComboboxFiltrable
              items={variantes}
              getId={(variante) => variante.id}
              getLabel={(variante) => `${variante.sku} — ${variante.nombre} (${variante.detalle})`}
              value={busquedaVarianteId}
              onChange={handleSeleccionarBusqueda}
              placeholder="Buscar por SKU, producto, talle o color"
              emptyMessage="No hay SKU que coincidan con la búsqueda."
              disabled={estado !== "escaneando"}
              pageSize={5}
            />

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

            {resuelto && (
              <Form {...form}>
                <form onSubmit={form.handleSubmit(agregarAlCarrito)} className="space-y-4 rounded-xl border border-blue-100 bg-blue-50/50 p-3">
                  <div className="space-y-2">
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
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
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
                              onChange={(e) => field.onChange(e.target.value)}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

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
                                avisarSiResta(e.target.value as IngresoEstadoDestino);
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

                  <div className="flex gap-2">
                    <Button
                      type="button"
                      className="flex-1 bg-red-500 text-white hover:bg-red-600"
                      onClick={cancelarConfirmacion}
                    >
                      Cancelar
                    </Button>
                    <Button type="submit" className="flex-1 gap-2 bg-blue-600 text-white hover:bg-blue-700">
                      <ShoppingCart className="size-4" aria-hidden="true" />
                      Agregar al carrito
                    </Button>
                  </div>
                </form>
              </Form>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b border-border">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              <ShoppingCart className="size-4 text-blue-600" aria-hidden="true" />
              Carrito de ingreso
              {carrito.length > 0 && (
                <Badge className="bg-blue-600 text-white">{carrito.length}</Badge>
              )}
            </CardTitle>
            <CardDescription>
              Escaneá los ítems que quieras cargar y confirmalos todos juntos.
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-4 pt-5">
            {carrito.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-10 text-center text-sm text-muted-foreground">
                <PackageSearch className="size-8 text-blue-200" aria-hidden="true" />
                Sin ítems en el carrito todavía.
              </div>
            ) : (
              <ul className="space-y-2">
                {carrito.map((item) => {
                  const impacto = IMPACTO_STOCK_POR_ESTADO_DESTINO[item.estado_destino];
                  return (
                    <li
                      key={item.key}
                      className="flex flex-wrap items-center gap-2 rounded-lg border border-blue-100 bg-blue-50/50 px-3 py-2 text-sm"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold text-blue-950">{item.producto_nombre}</p>
                        <p className="truncate text-xs text-blue-700">
                          {item.sku} · Talle {item.talle} · {item.color}
                        </p>
                      </div>
                      <Input
                        type="number"
                        min={1}
                        value={item.cantidad}
                        disabled={item.es_serializado}
                        onChange={(e) => actualizarCantidadCarrito(item.key, Number(e.target.value))}
                        className="h-8 w-16 shrink-0"
                        aria-label={`Cantidad de ${item.producto_nombre}`}
                      />
                      <select
                        value={item.estado_destino}
                        onChange={(e) => actualizarEstadoCarrito(item.key, e.target.value as IngresoEstadoDestino)}
                        className={`${selectClassName} w-auto shrink-0`}
                        aria-label={`Estado de ${item.producto_nombre}`}
                      >
                        {ESTADOS_DESTINO.map((estadoDestino) => (
                          <option key={estadoDestino} value={estadoDestino}>
                            {estadoDestino.replaceAll("_", " ")}
                          </option>
                        ))}
                      </select>
                      <Badge
                        variant="outline"
                        className={impacto === "SUMA" ? "shrink-0 border-blue-300 text-blue-700" : "shrink-0 border-amber-300 text-amber-700"}
                      >
                        {impacto === "SUMA" ? "+" : "−"}{item.cantidad}
                      </Badge>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="shrink-0 text-red-500 hover:bg-red-50 hover:text-red-600"
                        onClick={() => quitarDelCarrito(item.key)}
                        aria-label={`Quitar ${item.producto_nombre} del carrito`}
                      >
                        <Trash2 className="size-4" aria-hidden="true" />
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}

            {errorRegistro && (
              <Alert variant="destructive">
                <CircleAlert className="size-4" aria-hidden="true" />
                <AlertDescription>{errorRegistro}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-2">
              <Label htmlFor="ingreso-comprobante" className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-gray-700 uppercase">
                <FileText className="size-3.5" aria-hidden="true" />
                Comprobante / remito
              </Label>
              <Input
                id="ingreso-comprobante"
                value={comprobanteReferencia}
                onChange={(e) => setComprobanteReferencia(e.target.value)}
                placeholder="Ej: REM-2026-001"
                autoComplete="off"
                maxLength={100}
                disabled={estado === "registrando"}
                className="focus-visible:border-blue-500 focus-visible:ring-blue-500/30"
              />
            </div>

            <div className="flex gap-2">
              <Button
                type="button"
                className="flex-1 bg-red-500 text-white hover:bg-red-600"
                onClick={vaciarCarrito}
                disabled={carrito.length === 0 || estado === "registrando"}
              >
                Vaciar carrito
              </Button>
              <Button
                type="button"
                className="flex-1 gap-2 bg-blue-600 text-white hover:bg-blue-700"
                onClick={confirmarCarrito}
                disabled={carrito.length === 0 || estado === "registrando"}
              >
                {estado === "registrando" ? (
                  <>
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    Registrando…
                  </>
                ) : (
                  <>
                    <PackageCheck className="size-4" aria-hidden="true" />
                    Confirmar ingreso ({cantidadCarritoTotal})
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
