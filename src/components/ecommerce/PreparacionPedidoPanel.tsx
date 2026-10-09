"use client";

/**
 * @component PreparacionPedidoPanel
 * @description HU-E12 T09 — vista de preparación de un pedido asignado:
 * líneas requeridas/confirmadas, escáner de cámara (`CameraBarcodeScanner`,
 * Barcode Detection API + fallback ZXing), entrada manual como fallback y
 * acción "Completar preparación" habilitada solo al 100% de progreso.
 *
 * Cada lectura física genera un `scan_id` nuevo vía `ejecutarEscaneo`; los
 * reintentos técnicos de la misma lectura reutilizan ese `scan_id`. El QR de
 * retiro nunca se muestra (pertenece a E9/E3).
 */
import { useCallback, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Keyboard,
  Loader2,
  PackageCheck,
  PartyPopper,
} from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { CameraBarcodeScanner } from "@/components/inventario/escaner/CameraBarcodeScanner";
import { cn } from "@/lib/utils";

import {
  cantidadPendiente,
  completarPreparacionApi,
  describirLinea,
  ejecutarEscaneo,
  formatearEstadoEcommerce,
  formatearPlazoRetiro,
  mensajeErrorPickPack,
  type ItemColaPreparacionJson,
  type LineaPreparacionJson,
  type ResultadoCompletarJson,
  type ResultadoConfirmarJson,
} from "./pick-pack-client";
import { ProgresoBarra } from "./ProgresoBarra";

// ──────────────────────────────────────────────────────────────────────────────
// Subcomponentes presentacionales
// ──────────────────────────────────────────────────────────────────────────────

/** Fila de línea de preparación: requerida / confirmada / pendiente. */
export function LineaPreparacionVista({ linea }: { linea: LineaPreparacionJson }) {
  const pendiente = cantidadPendiente(linea);
  return (
    <li
      className={cn(
        "flex items-center justify-between gap-3 rounded-lg border px-3 py-2",
        linea.completa ? "border-emerald-200 bg-emerald-50/50" : "border-border",
      )}
    >
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{describirLinea(linea)}</p>
        <p className="font-mono text-xs text-muted-foreground">{linea.variante.sku}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2 text-sm">
        <span className="tabular-nums">
          <strong>{linea.cantidad_confirmada}</strong>
          <span className="text-muted-foreground">/{linea.cantidad_requerida}</span>
        </span>
        {linea.completa ? (
          <Badge variant="secondary" className="bg-emerald-100 text-emerald-800">
            <CheckCircle2 className="size-3" aria-hidden="true" />
            Completa
          </Badge>
        ) : (
          <Badge variant="outline">Faltan {pendiente}</Badge>
        )}
      </div>
    </li>
  );
}

/** Botón de finalización — deshabilitado hasta 100% (el backend valida igual). */
export function BotonCompletar({
  completo,
  enviando,
  onCompletar,
}: {
  completo: boolean;
  enviando: boolean;
  onCompletar: () => void;
}) {
  return (
    <Button
      className="w-full bg-emerald-600 text-white hover:bg-emerald-700"
      size="lg"
      disabled={!completo || enviando}
      onClick={onCompletar}
    >
      {enviando ? (
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
      ) : (
        <PackageCheck className="size-4" aria-hidden="true" />
      )}
      {completo ? "Completar preparación" : "Completar preparación (faltan unidades)"}
    </Button>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Panel de preparación
// ──────────────────────────────────────────────────────────────────────────────

export interface PreparacionPedidoPanelProps {
  pedido: ItemColaPreparacionJson;
  /** El contenedor actualiza línea/progreso del ítem en la cola. */
  onScanAcreditado: (resultado: ResultadoConfirmarJson) => void;
  /** Vuelve a la cola (el contenedor siempre refresca al cerrar). */
  onCerrar: () => void;
}

export function PreparacionPedidoPanel({
  pedido,
  onScanAcreditado,
  onCerrar,
}: PreparacionPedidoPanelProps) {
  const [codigoManual, setCodigoManual] = useState("");
  const [escaneando, setEscaneando] = useState(false);
  const [completando, setCompletando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoCompletarJson | null>(null);
  const [ultimoScan, setUltimoScan] = useState<string | null>(null);
  const [errorScan, setErrorScan] = useState<string | null>(null);

  const progreso = pedido.progreso;
  const lineasPorId = useMemo(
    () => new Map(pedido.lineas.map((l) => [l.pedido_venta_item_id, l])),
    [pedido.lineas],
  );

  const procesarLectura = useCallback(
    async (codigo: string) => {
      const codigoLimpio = codigo.trim();
      if (!codigoLimpio || escaneando || resultado) return;

      setEscaneando(true);
      setErrorScan(null);
      try {
        const r = await ejecutarEscaneo(pedido.pedido_venta_id, codigoLimpio);
        if (r.ok && r.data) {
          onScanAcreditado(r.data);
          const linea = lineasPorId.get(r.data.pedido_venta_item_id);
          setUltimoScan(
            `Unidad confirmada: ${linea ? describirLinea(linea) : "ítem"} ` +
              `(${r.data.cantidad_confirmada}/${linea?.cantidad_requerida ?? "?"})`,
          );
          return;
        }
        const mensaje = r.errorRed
          ? mensajeErrorPickPack(0)
          : mensajeErrorPickPack(r.status, r.error?.code);
        setErrorScan(mensaje);
        toast.add({ title: "Escaneo rechazado", description: mensaje, type: "error" });
        if (r.status === 403 || r.status === 404) {
          // El pedido ya no es operable por este usuario — volver a la cola.
          onCerrar();
        }
      } finally {
        setEscaneando(false);
      }
    },
    [escaneando, resultado, pedido.pedido_venta_id, onScanAcreditado, lineasPorId, onCerrar],
  );

  if (pedido.estado_ecommerce !== "EN_PREPARACION" || pedido.operador_asignado_id === null) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <AlertTriangle className="size-10 text-amber-500" aria-hidden="true" />
          <CardTitle>El pedido todavía no está en preparación</CardTitle>
          <CardDescription>Tomá el pedido desde la cola antes de escanear o completar unidades.</CardDescription>
          <Button onClick={onCerrar} variant="outline">
            <ArrowLeft className="size-4" aria-hidden="true" />
            Volver a la cola
          </Button>
        </CardContent>
      </Card>
    );
  }

  function manejarLecturaManual(e: React.FormEvent) {
    e.preventDefault();
    void procesarLectura(codigoManual);
    setCodigoManual("");
  }

  async function manejarCompletar() {
    if (completando || !progreso.completo) return;
    setCompletando(true);
    try {
      const r = await completarPreparacionApi(pedido.pedido_venta_id);
      // 200 incluye el retry idempotente de un LISTO ya finalizado — éxito igual.
      if (r.ok && r.data) {
        setResultado(r.data);
        return;
      }
      toast.add({
        title: "No se pudo completar",
        description: mensajeErrorPickPack(r.status, r.error?.code),
        type: "error",
      });
      if (r.status === 403 || r.status === 404) onCerrar();
    } catch {
      toast.add({ title: "Sin conexión", description: mensajeErrorPickPack(0), type: "error" });
    } finally {
      setCompletando(false);
    }
  }

  // ── Estado final: LISTO_PARA_RETIRO (sin QR — reservado a E9/E3) ──────────
  if (resultado) {
    const plazo = formatearPlazoRetiro(resultado.plazo_retiro_vencimiento);
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <PartyPopper className="size-10 text-emerald-500" aria-hidden="true" />
          <CardTitle>Pedido {formatearEstadoEcommerce(resultado.estado_ecommerce)}</CardTitle>
          <CardDescription>
            El pedido <span className="font-mono">{pedido.numero_venta}</span> quedó listo
            para retiro.
          </CardDescription>
          {plazo && (
            <p className="text-sm">
              Plazo de retiro hasta: <strong>{plazo}</strong>
            </p>
          )}
          {resultado.idempotente && (
            <p className="text-xs text-muted-foreground">
              La preparación ya había sido finalizada previamente.
            </p>
          )}
          <Button onClick={() => onCerrar()} className="mt-2">
            <ArrowLeft className="size-4" aria-hidden="true" />
            Volver a la cola
          </Button>
        </CardContent>
      </Card>
    );
  }

  // ── Vista de preparación activa ─────────────────────────────────────────────
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => onCerrar()}>
          <ArrowLeft className="size-4" aria-hidden="true" />
          Volver a la cola
        </Button>
        <div>
          <h2 className="font-mono text-sm font-semibold">{pedido.numero_venta}</h2>
          <p className="text-xs text-muted-foreground">
            {progreso.total_confirmado} de {progreso.total_requerido} unidades ·{" "}
            {progreso.porcentaje}%
          </p>
        </div>
      </div>

      <ProgresoBarra porcentaje={progreso.porcentaje} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Líneas del pedido */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Ítems del pedido</CardTitle>
            <CardDescription>Unidades requeridas y confirmadas por línea.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {pedido.lineas.map((linea) => (
                <LineaPreparacionVista key={linea.pedido_venta_item_id} linea={linea} />
              ))}
            </ul>
          </CardContent>
        </Card>

        {/* Escáner + entrada manual */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Escaneo de unidades</CardTitle>
            <CardDescription>
              Apuntá la cámara al código del producto o ingresalo manualmente.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <CameraBarcodeScanner
              onDetect={(codigo) => void procesarLectura(codigo)}
              activo={!escaneando && !completando}
            />

            <form onSubmit={manejarLecturaManual} className="flex gap-2">
              <div className="relative flex-1">
                <Keyboard
                  className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />
                <Input
                  value={codigoManual}
                  onChange={(e) => setCodigoManual(e.target.value)}
                  placeholder="SKU o EAN manual…"
                  disabled={escaneando}
                  aria-label="Código manual"
                  className="pl-8 font-mono"
                />
              </div>
              <Button type="submit" variant="secondary" disabled={escaneando || !codigoManual.trim()}>
                {escaneando ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  "Confirmar"
                )}
              </Button>
            </form>

            {escaneando && (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="size-3 animate-spin" aria-hidden="true" />
                Confirmando unidad…
              </p>
            )}
            {ultimoScan && !errorScan && (
              <Alert className="border-emerald-200 bg-emerald-50 text-emerald-900">
                <CheckCircle2 className="size-4" aria-hidden="true" />
                <AlertDescription>{ultimoScan}</AlertDescription>
              </Alert>
            )}
            {errorScan && (
              <Alert variant="destructive">
                <AlertTriangle className="size-4" aria-hidden="true" />
                <AlertDescription>{errorScan}</AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      </div>

      <BotonCompletar
        completo={progreso.completo}
        enviando={completando}
        onCompletar={() => void manejarCompletar()}
      />
    </div>
  );
}
