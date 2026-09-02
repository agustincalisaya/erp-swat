"use client";

/**
 * @component MovimientoWizard
 * @description HU-A11 (spec_modulo_A.md §2.10) — wizard de carga de
 * movimiento: orquesta 3 pasos fijos (Depósito → Tipo de movimiento →
 * Producto/s). Es una capa de orquestación de UI: secuencia la recolección
 * de inputs y delega en `PasoIngreso`/`PasoTransferencia`, que a su vez
 * invocan los Server Actions ya existentes de `movimientos/actions.ts`
 * (`registrarIngresoStockAction`, `crearTransferenciaAction`) sin duplicar ni
 * reimplementar su lógica de negocio, validaciones ni transacciones.
 *
 * "Ajuste" aparece como tercera opción del paso 2 pero deshabilitada: no
 * existe todavía un Server Action de creación de ajustes (spec §3.8 es una
 * HU distinta, no implementada).
 */
import { useState } from "react";
import { ArrowLeft, ArrowRightLeft, Building2, PackagePlus, Sparkles } from "lucide-react";

import type { DepositoActivo } from "@/lib/services/inventario/deposito.service";
import type { VarianteTransferible } from "@/lib/services/inventario/transferencia.service";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { PasoIngreso } from "@/components/inventario/wizard/PasoIngreso";
import { PasoTransferencia } from "@/components/inventario/wizard/PasoTransferencia";

type TipoWizard = "INGRESO" | "TRANSFERENCIA";
type Paso = 1 | 2 | 3;

interface Props {
  depositos: DepositoActivo[];
  variantes: VarianteTransferible[];
  puedeRegistrarIngreso: boolean;
  puedeTransferir: boolean;
}

const PASOS = ["Depósito", "Tipo de movimiento", "Producto(s)"];

export function MovimientoWizard({ depositos, variantes, puedeRegistrarIngreso, puedeTransferir }: Props) {
  const [paso, setPaso] = useState<Paso>(1);
  const [depositoId, setDepositoId] = useState(depositos[0]?.id ?? "");
  const [tipo, setTipo] = useState<TipoWizard | null>(null);

  const depositoSeleccionado = depositos.find((d) => d.id === depositoId);

  function reiniciar() {
    setPaso(1);
    setTipo(null);
  }

  if (depositos.length === 0) {
    return (
      <Alert variant="destructive">
        <AlertDescription>No hay depósitos activos disponibles para registrar movimientos.</AlertDescription>
      </Alert>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle>Registrar movimiento</CardTitle>
            <CardDescription>Depósito → Tipo de movimiento → Producto(s).</CardDescription>
          </div>
          <ol className="flex items-center gap-2 text-xs text-muted-foreground">
            {PASOS.map((etiqueta, i) => (
              <li key={etiqueta} className="flex items-center gap-2">
                <Badge variant={paso === i + 1 ? "default" : "outline"} className={paso === i + 1 ? "bg-blue-600 text-white" : ""}>
                  {i + 1}
                </Badge>
                <span className={paso === i + 1 ? "font-semibold text-foreground" : ""}>{etiqueta}</span>
                {i < PASOS.length - 1 && <span className="text-muted-foreground/50">›</span>}
              </li>
            ))}
          </ol>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {paso === 1 && (
          <div className="max-w-sm space-y-3">
            <label htmlFor="wizard-deposito" className="flex items-center gap-1.5 text-sm font-medium">
              <Building2 className="size-4 text-blue-600" aria-hidden="true" />
              Depósito
            </label>
            <select
              id="wizard-deposito"
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              value={depositoId}
              onChange={(e) => setDepositoId(e.target.value)}
            >
              {depositos.map((d) => <option key={d.id} value={d.id}>{d.nombre}</option>)}
            </select>
            <Button onClick={() => setPaso(2)} disabled={!depositoId} className="bg-blue-600 text-white hover:bg-blue-700">Siguiente</Button>
          </div>
        )}

        {paso === 2 && (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <button
                type="button"
                disabled={!puedeRegistrarIngreso}
                onClick={() => { setTipo("INGRESO"); setPaso(3); }}
                className="flex flex-col items-center gap-2 rounded-xl border p-5 text-center transition-colors enabled:hover:border-blue-400 enabled:hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <PackagePlus className="size-6 text-blue-600" aria-hidden="true" />
                <span className="font-semibold">Ingreso</span>
                <span className="text-xs text-muted-foreground">Escaneo de mercadería entrante</span>
              </button>
              <button
                type="button"
                disabled={!puedeTransferir}
                onClick={() => { setTipo("TRANSFERENCIA"); setPaso(3); }}
                className="flex flex-col items-center gap-2 rounded-xl border p-5 text-center transition-colors enabled:hover:border-blue-400 enabled:hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <ArrowRightLeft className="size-6 text-blue-600" aria-hidden="true" />
                <span className="font-semibold">Transferencia</span>
                <span className="text-xs text-muted-foreground">Despacho entre depósitos</span>
              </button>
              <button
                type="button"
                disabled
                className="relative flex flex-col items-center gap-2 rounded-xl border p-5 text-center opacity-50"
              >
                <Badge variant="outline" className="absolute top-2 right-2">Próximamente</Badge>
                <Sparkles className="size-6 text-muted-foreground" aria-hidden="true" />
                <span className="font-semibold">Ajuste</span>
                <span className="text-xs text-muted-foreground">Corrección manual de stock</span>
              </button>
            </div>
            <Button variant="outline" onClick={() => setPaso(1)}>
              <ArrowLeft className="size-4" /> Atrás
            </Button>
          </div>
        )}

        {paso === 3 && tipo && depositoSeleccionado && (
          <div className="space-y-4">
            {tipo === "INGRESO" ? (
              <PasoIngreso
                depositoDestinoId={depositoSeleccionado.id}
                depositoDestinoNombre={depositoSeleccionado.nombre}
                variantes={variantes}
              />
            ) : (
              <PasoTransferencia
                depositoOrigenId={depositoSeleccionado.id}
                depositoOrigenNombre={depositoSeleccionado.nombre}
                depositos={depositos}
                variantes={variantes}
              />
            )}
            <Button variant="outline" onClick={reiniciar}>
              <ArrowLeft className="size-4" /> Registrar otro movimiento
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
