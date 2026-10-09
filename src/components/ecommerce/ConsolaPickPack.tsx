"use client";

/**
 * @component ConsolaPickPack
 * @description HU-E12 T09 — consola operativa de Pick & Pack / Click &
 * Collect. Lista la cola desde `GET /api/ecommerce/preparacion` respetando
 * el orden del backend (sin reordenar en cliente), pagina server-side y
 * ofrece las acciones habilitadas por permiso real:
 *  - Admin Ecommerce (`puedePriorizar`): cambiar/quitar prioridad.
 *  - Operador Pick&Pack (`puedePreparar`): tomar pedido y abrir preparación.
 *
 * No renderiza PII, QR, payment ids ni códigos escaneados — solo los campos
 * seguros del DTO de cola.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Loader2,
  PackageCheck,
  RefreshCw,
  ScanBarcode,
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
import { cn } from "@/lib/utils";

import {
  aplicarResultadoScan,
  cambiarPrioridadApi,
  formatearEstadoEcommerce,
  formatearFechaPagoConfirmado,
  mensajeErrorPickPack,
  obtenerColaPreparacion,
  tomarPedidoApi,
  type ColaPreparacionJson,
  type ItemColaPreparacionJson,
  type ResultadoConfirmarJson,
} from "./pick-pack-client";
import { PreparacionPedidoPanel } from "./PreparacionPedidoPanel";
import { ProgresoBarra } from "./ProgresoBarra";
import { RetiroPedidoPanel } from "./RetiroPedidoPanel";

const PAGE_SIZE = 20;

// ──────────────────────────────────────────────────────────────────────────────
// Subcomponentes presentacionales (exportados para tests de markup estático)
// ──────────────────────────────────────────────────────────────────────────────

/** Control de prioridad para Admin Ecommerce — solo pedidos no tomados. */
export function ControlPrioridad({
  prioridadActual,
  deshabilitado,
  onAplicar,
}: {
  prioridadActual: number | null;
  deshabilitado: boolean;
  onAplicar: (prioridad: number | null) => void;
}) {
  const [valor, setValor] = useState(prioridadActual?.toString() ?? "");
  const valido =
    valor === "" || (/^\d+$/.test(valor) && Number(valor) >= 1 && Number(valor) <= 100);

  return (
    <div className="flex items-end gap-2">
      <div className="space-y-1">
        <label htmlFor={`prioridad-input`} className="text-xs text-muted-foreground">
          Prioridad (1–100)
        </label>
        <Input
          id="prioridad-input"
          type="number"
          min={1}
          max={100}
          inputMode="numeric"
          placeholder="—"
          value={valor}
          disabled={deshabilitado}
          onChange={(e) => setValor(e.target.value)}
          className="h-8 w-24"
          aria-label="Prioridad manual"
        />
      </div>
      <Button
        size="sm"
        variant="secondary"
        disabled={deshabilitado || !valido || (valor === "" && prioridadActual === null)}
        onClick={() => onAplicar(valor === "" ? null : Number(valor))}
      >
        {valor === "" ? "Quitar" : "Aplicar"}
      </Button>
    </div>
  );
}

/** Tarjeta de un pedido de la cola. */
export function TarjetaPedidoCola({
  pedido,
  puedePriorizar,
  puedePreparar,
  esPropio,
  accionEnCurso,
  onTomar,
  onPreparar,
  onPrioridad,
}: {
  pedido: ItemColaPreparacionJson;
  puedePriorizar: boolean;
  puedePreparar: boolean;
  /** `operador_asignado_id === usuarioId` de la sesión actual. */
  esPropio: boolean;
  accionEnCurso: boolean;
  onTomar: () => void;
  onPreparar: () => void;
  onPrioridad: (prioridad: number | null) => void;
}) {
  const libre = pedido.operador_asignado_id === null;
  const pendienteDeToma = pedido.estado_ecommerce === "PAGO_CONFIRMADO" && libre;
  const enPreparacion = pedido.estado_ecommerce === "EN_PREPARACION";

  return (
    <Card className="flex flex-col gap-3 py-4">
      <CardHeader className="px-4 pb-0">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="font-mono text-sm">{pedido.numero_venta}</CardTitle>
          <div className="flex items-center gap-2">
            {pedido.prioridad_manual !== null && (
              <Badge variant="destructive">Prioridad {pedido.prioridad_manual}</Badge>
            )}
            <Badge variant={enPreparacion ? "secondary" : "outline"}>
              {formatearEstadoEcommerce(pedido.estado_ecommerce)}
            </Badge>
          </div>
        </div>
        <CardDescription>
          {formatearFechaPagoConfirmado(pedido.fecha_pago_confirmado)}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3 px-4">
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>
              {pedido.progreso.total_confirmado} de {pedido.progreso.total_requerido} unidades
            </span>
            <span>{pedido.progreso.porcentaje}%</span>
          </div>
          <ProgresoBarra porcentaje={pedido.progreso.porcentaje} />
        </div>

        <p className="text-xs text-muted-foreground">
          {pendienteDeToma
            ? "Disponible para tomar · Sin operador asignado"
            : enPreparacion && libre
              ? "Registro anterior · Sin operador asignado"
              : esPropio && enPreparacion
                ? "Asignado a vos"
                : enPreparacion
                  ? "Asignado a otro operador"
                  : "Estado no operable"}
        </p>

        {puedePriorizar && libre && enPreparacion && (
          <ControlPrioridad
            prioridadActual={pedido.prioridad_manual}
            deshabilitado={accionEnCurso}
            onAplicar={onPrioridad}
          />
        )}

        {puedePreparar && (
          <div className="mt-auto pt-1">
            {pendienteDeToma ? (
              <Button
                className="w-full bg-blue-600 text-white hover:bg-blue-700"
                disabled={accionEnCurso}
                onClick={onTomar}
              >
                <PackageCheck className="size-4" aria-hidden="true" />
                Tomar pedido
              </Button>
            ) : esPropio && enPreparacion ? (
              <Button
                className="w-full"
                disabled={accionEnCurso}
                onClick={onPreparar}
              >
                <ScanBarcode className="size-4" aria-hidden="true" />
                Continuar preparación
              </Button>
            ) : (
              <p className="text-center text-xs text-muted-foreground">
                Asignado a otro operador
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Consola principal
// ──────────────────────────────────────────────────────────────────────────────

export interface ConsolaPickPackProps {
  /** Permiso `ecommerce:preparar_pedido` del usuario actual. */
  puedePreparar: boolean;
  /** Permiso `ecommerce:priorizar_cola` del usuario actual. */
  puedePriorizar: boolean;
  /** Permiso `ecommerce:validar_retiro_qr` del usuario actual. */
  puedeValidarRetiro: boolean;
  /** `userId` de sesión — para saber qué pedidos están asignados al operador. */
  usuarioId: string;
}

export function ConsolaPickPack({
  puedePreparar,
  puedePriorizar,
  puedeValidarRetiro,
  usuarioId,
}: ConsolaPickPackProps) {
  const [seccion, setSeccion] = useState<"preparacion" | "retiro">("preparacion");
  const [page, setPage] = useState(1);
  const [cola, setCola] = useState<ColaPreparacionJson | null>(null);
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [accionEnCurso, setAccionEnCurso] = useState<string | null>(null);
  const accionEnCursoRef = useRef<string | null>(null);
  const [pedidoActivo, setPedidoActivo] = useState<ItemColaPreparacionJson | null>(null);

  const aplicarRespuestaCola = useCallback((r: Awaited<ReturnType<typeof obtenerColaPreparacion>>) => {
    if (r.ok && r.data) {
      setCola(r.data);
      setErrorCarga(null);
    } else {
      setCola(null);
      setErrorCarga(mensajeErrorPickPack(r.status, r.error?.code));
    }
    setCargando(false);
  }, []);

  const cargarCola = useCallback(
    async (pagina: number) => {
      setCargando(true);
      setErrorCarga(null);
      try {
        aplicarRespuestaCola(await obtenerColaPreparacion(pagina, PAGE_SIZE));
      } catch {
        setCola(null);
        setErrorCarga(mensajeErrorPickPack(0));
        setCargando(false);
      }
    },
    [aplicarRespuestaCola],
  );

  useEffect(() => {
    let cancelado = false;
    obtenerColaPreparacion(page, PAGE_SIZE)
      .then((r) => {
        if (!cancelado) aplicarRespuestaCola(r);
      })
      .catch(() => {
        if (cancelado) return;
        setCola(null);
        setErrorCarga(mensajeErrorPickPack(0));
        setCargando(false);
      });
    return () => {
      cancelado = true;
    };
  }, [page, aplicarRespuestaCola]);

  const refrescar = useCallback(() => void cargarCola(page), [cargarCola, page]);

  const cambiarPagina = useCallback((pagina: number) => {
    setCargando(true);
    setPage(pagina);
  }, []);

  async function manejarTomar(pedido: ItemColaPreparacionJson) {
    if (accionEnCursoRef.current) return;
    accionEnCursoRef.current = pedido.pedido_venta_id;
    setAccionEnCurso(pedido.pedido_venta_id);
    try {
      const r = await tomarPedidoApi(pedido.pedido_venta_id);
      if (r.ok && r.data) {
        refrescar();
        setPedidoActivo({
          ...pedido,
          estado_ecommerce: "EN_PREPARACION",
          operador_asignado_id: r.data.operador_asignado_id,
        });
        return;
      }
      toast.add({
        title: "No se pudo tomar el pedido",
        description: mensajeErrorPickPack(r.status, r.error?.code),
        type: "error",
      });
      // 409 → otro operador lo tomó: refrescar la cola para reflejar el estado real.
      if (r.status === 409 || r.status === 404) refrescar();
    } catch {
      toast.add({ title: "Sin conexión", description: mensajeErrorPickPack(0), type: "error" });
    } finally {
      accionEnCursoRef.current = null;
      setAccionEnCurso(null);
    }
  }

  async function manejarPrioridad(pedido: ItemColaPreparacionJson, prioridad: number | null) {
    if (accionEnCurso) return;
    setAccionEnCurso(pedido.pedido_venta_id);
    try {
      const r = await cambiarPrioridadApi(pedido.pedido_venta_id, prioridad);
      if (r.ok && r.data) {
        toast.add({
          title:
            r.data.prioridad_manual === null
              ? "Prioridad quitada"
              : `Prioridad ${r.data.prioridad_manual} aplicada`,
          type: "success",
        });
        refrescar();
        return;
      }
      toast.add({
        title: "No se pudo cambiar la prioridad",
        description: mensajeErrorPickPack(r.status, r.error?.code),
        type: "error",
      });
      if (r.status === 409 || r.status === 404) refrescar();
    } catch {
      toast.add({ title: "Sin conexión", description: mensajeErrorPickPack(0), type: "error" });
    } finally {
      setAccionEnCurso(null);
    }
  }

  function manejarScanAcreditado(resultado: ResultadoConfirmarJson) {
    setPedidoActivo((actual) => (actual ? aplicarResultadoScan(actual, resultado) : actual));
  }

  // ── Vista de preparación de un pedido ──────────────────────────────────────
  if (pedidoActivo) {
    return (
      <PreparacionPedidoPanel
        pedido={pedidoActivo}
        onScanAcreditado={manejarScanAcreditado}
        onCerrar={() => {
          setPedidoActivo(null);
          refrescar();
        }}
      />
    );
  }

  if (seccion === "retiro" && puedeValidarRetiro) {
    return (
      <div className="space-y-4">
        <SelectorOperacion seccion={seccion} puedeValidarRetiro={puedeValidarRetiro} onCambiar={setSeccion} />
        <RetiroPedidoPanel />
      </div>
    );
  }

  // ── Vista de cola ──────────────────────────────────────────────────────────
  const totalPaginas = cola ? Math.max(1, Math.ceil(cola.total / cola.page_size)) : 1;

  return (
    <div className="space-y-4">
      <SelectorOperacion seccion="preparacion" puedeValidarRetiro={puedeValidarRetiro} onCambiar={setSeccion} />
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {cola ? `${cola.total} pedido(s) en cola` : "Cola de preparación"}
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={refrescar}
          disabled={cargando}
          aria-label="Refrescar cola"
        >
          <RefreshCw className={cn("size-4", cargando && "animate-spin")} aria-hidden="true" />
          Actualizar
        </Button>
      </div>

      {errorCarga && (
        <Alert variant="destructive">
          <AlertTriangle className="size-4" aria-hidden="true" />
          <AlertDescription>{errorCarga}</AlertDescription>
        </Alert>
      )}

      {cargando && !cola && (
        <div className="flex items-center justify-center gap-3 py-16 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Cargando cola de preparación…
        </div>
      )}

      {!cargando && !errorCarga && cola && cola.items.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
          <CheckCircle2 className="size-10 text-emerald-500" aria-hidden="true" />
          <p className="text-sm font-medium">No hay pedidos pendientes de preparación.</p>
          <p className="text-xs text-muted-foreground">
            Los pedidos pagados ingresan automáticamente a esta cola.
          </p>
        </div>
      )}

      {cola && cola.items.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {cola.items.map((pedido) => (
            <TarjetaPedidoCola
              key={pedido.pedido_venta_id}
              pedido={pedido}
              puedePriorizar={puedePriorizar}
              puedePreparar={puedePreparar}
              esPropio={pedido.operador_asignado_id === usuarioId}
              accionEnCurso={accionEnCurso === pedido.pedido_venta_id}
              onTomar={() => void manejarTomar(pedido)}
              onPreparar={() => setPedidoActivo(pedido)}
              onPrioridad={(p) => void manejarPrioridad(pedido, p)}
            />
          ))}
        </div>
      )}

      {cola && totalPaginas > 1 && (
        <div className="flex items-center justify-center gap-3 pt-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1 || cargando}
            onClick={() => cambiarPagina(Math.max(1, page - 1))}
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            Anterior
          </Button>
          <span className="text-sm text-muted-foreground">
            Página {cola.page} de {totalPaginas}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPaginas || cargando}
            onClick={() => cambiarPagina(page + 1)}
          >
            Siguiente
            <ArrowLeft className="size-4 rotate-180" aria-hidden="true" />
          </Button>
        </div>
      )}
    </div>
  );
}

export function SelectorOperacion({ seccion, puedeValidarRetiro, onCambiar }: {
  seccion: "preparacion" | "retiro";
  puedeValidarRetiro: boolean;
  onCambiar: (seccion: "preparacion" | "retiro") => void;
}) {
  if (!puedeValidarRetiro) return null;
  return (
    <div className="flex w-full gap-2 rounded-lg border bg-white p-1 sm:w-fit" aria-label="Operaciones Click & Collect">
      <Button type="button" variant={seccion === "preparacion" ? "default" : "ghost"}
        className="min-w-0 flex-1 sm:flex-none" onClick={() => onCambiar("preparacion")}>
        Preparación
      </Button>
      <Button type="button" variant={seccion === "retiro" ? "default" : "ghost"}
        className="min-w-0 flex-1 sm:flex-none" onClick={() => onCambiar("retiro")}>
        Retiro
      </Button>
    </div>
  );
}
