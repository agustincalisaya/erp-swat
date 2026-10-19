/**
 * @component PosicionDiariaPanel
 * @description HU-G7 §9.8 (G7-2/G7-5/G7-7/G7-8) — presentación de la posición
 * diaria consolidada de Tesorería. SEPARA explícitamente dos cortes temporales:
 *
 *  - LIQUIDEZ del día consultado (`corte.liquido`): saldo vigente de cada
 *    cuenta propia activa (con la fecha del asiento) + caja virtual de Mercado
 *    Pago + total líquido. Una cuenta sin saldo registrado NO se presume cero:
 *    se muestra «sin saldo registrado» y queda fuera del total.
 *  - PROYECCIONES a ESTADO ACTUAL (`corte.proyecciones`): egresos proyectados
 *    (DEFINITIVA/PROVISORIO en DOS bloques que NO se suman) e ingresos
 *    proyectados (saldo de cuentas corrientes + hitos informativos, aparte).
 *
 * Solo presentación: el DTO ya llega calculado y sin CBU/alias. El dinero ya
 * viaja como `string` con 2 decimales.
 */

import type {
  GrupoEgresoDto,
  PosicionDiariaDto,
} from "@/lib/services/tesoreria/posicion-diaria.service";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const TIPO_LABEL: Record<PosicionDiariaDto["cuentas"][number]["tipo"], string> = {
  BANCARIA: "Bancaria",
  CAJA: "Caja",
};

const FORMATO_MONTO = new Intl.NumberFormat("es-AR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Presentación es-AR de un monto `string` de 2 decimales (solo lectura). */
function monto(valor: string): string {
  return FORMATO_MONTO.format(Number(valor));
}

interface PosicionDiariaPanelProps {
  posicion: PosicionDiariaDto;
}

export function PosicionDiariaPanel({ posicion }: PosicionDiariaPanelProps) {
  const { corte } = posicion;

  return (
    <div className="space-y-5">
      {/* ── LIQUIDEZ — día consultado ─────────────────────────────────────── */}
      <Card>
        <CardHeader className="border-b border-border">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-sm font-semibold">
              Liquidez del día consultado
            </CardTitle>
            <Badge className="bg-selected text-selected-foreground">
              Corte: {corte.liquido}
            </Badge>
          </div>
          <CardDescription>
            Saldos de cuentas propias y caja virtual vigentes al día elegido. Una cuenta sin saldo
            registrado queda fuera del total (no se presume cero).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 pt-5">
          <ul className="divide-y divide-border rounded-lg border border-border">
            {posicion.cuentas.map((cuenta) => (
              <li
                key={cuenta.cuenta_id}
                className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{cuenta.nombre}</p>
                  <p className="text-xs text-muted-foreground">
                    {TIPO_LABEL[cuenta.tipo]}
                    {cuenta.fecha_saldo ? ` · asiento del ${cuenta.fecha_saldo}` : ""}
                  </p>
                </div>
                <p
                  className={
                    cuenta.sin_saldo_registrado
                      ? "text-sm italic text-muted-foreground"
                      : "font-mono text-sm text-foreground"
                  }
                >
                  {cuenta.sin_saldo_registrado ? "Sin saldo registrado" : `$ ${monto(cuenta.saldo!)}`}
                </p>
              </li>
            ))}
            <li className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">
                  Caja virtual Mercado Pago
                </p>
                <p className="text-xs text-muted-foreground">
                  Canal web ({posicion.caja_virtual.id}). {posicion.caja_virtual.nota_retiros}
                </p>
              </div>
              <p className="font-mono text-sm text-foreground">
                $ {monto(posicion.caja_virtual.saldo)}
              </p>
            </li>
          </ul>

          <div className="flex items-center justify-between rounded-lg bg-selected px-3 py-3">
            <span className="text-sm font-semibold text-selected-foreground">
              Total líquido consolidado
            </span>
            <span className="font-mono text-base font-bold text-selected-foreground">
              $ {monto(posicion.total_liquido)}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* ── PROYECCIONES — estado actual ──────────────────────────────────── */}
      <Card>
        <CardHeader className="border-b border-border">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-sm font-semibold">Proyecciones</CardTitle>
            <Badge variant="outline">Estado actual</Badge>
          </div>
          <CardDescription>
            Deudas y cuentas corrientes al día de hoy (no al día elegido). Los bloques DEFINITIVA y
            PROVISORIO se muestran por separado y NO se suman entre sí.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6 pt-5">
          {/* Egresos proyectados — dos bloques separados */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground">Egresos proyectados</h3>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <BloqueEgresos titulo="DEFINITIVA — deuda exigible" grupos={posicion.proyeccion_egresos.definitivas} />
              <BloqueEgresos
                titulo="PROVISORIO — compromiso estimado"
                grupos={posicion.proyeccion_egresos.provisorias}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Total de egresos proyectados (solo DEFINITIVA):{" "}
              <span className="font-mono text-foreground">
                $ {monto(posicion.proyeccion_egresos.total_definitivas)}
              </span>
            </p>
            <p className="text-xs text-muted-foreground">{posicion.proyeccion_egresos.nota}</p>
          </section>

          {/* Ingresos proyectados — cuenta corriente + hitos informativos */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground">Ingresos proyectados</h3>
            {posicion.proyeccion_ingresos.cuentas_corrientes.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Sin cuentas corrientes de clientes activas.
              </p>
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {posicion.proyeccion_ingresos.cuentas_corrientes.map((cuenta) => (
                  <li
                    key={cuenta.cuenta_corriente_id}
                    className="flex items-center justify-between gap-2 px-3 py-2"
                  >
                    <span className="truncate text-sm text-foreground">{cuenta.cliente}</span>
                    <span className="font-mono text-sm text-foreground">
                      $ {monto(cuenta.saldo_actual)}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {posicion.proyeccion_ingresos.hitos.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">
                  Hitos del plan de pagos (informativos, no se suman al total)
                </p>
                <ul className="divide-y divide-border rounded-lg border border-dashed border-border">
                  {posicion.proyeccion_ingresos.hitos.map((hito, indice) => (
                    <li
                      key={`${hito.cuenta_corriente_id}-${indice}`}
                      className="flex items-center justify-between gap-2 px-3 py-2"
                    >
                      <span className="truncate text-sm text-foreground">
                        {hito.hito} ({hito.porcentaje}%) · {hito.fecha_estimada}
                      </span>
                      <span className="font-mono text-sm text-muted-foreground">
                        $ {monto(hito.importe)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              {posicion.proyeccion_ingresos.nota_cobranzas_externas}
            </p>
          </section>
        </CardContent>
      </Card>
    </div>
  );
}

interface BloqueEgresosProps {
  titulo: string;
  grupos: GrupoEgresoDto[];
}

/** Un bloque (DEFINITIVA o PROVISORIO) agrupado por fecha de vencimiento. */
function BloqueEgresos({ titulo, grupos }: BloqueEgresosProps) {
  const total = grupos.reduce((acc, grupo) => acc + Number(grupo.total), 0);
  return (
    <div className="space-y-2 rounded-lg border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-foreground">{titulo}</p>
        <span className="font-mono text-xs text-muted-foreground">$ {FORMATO_MONTO.format(total)}</span>
      </div>
      {grupos.length === 0 ? (
        <p className="text-xs text-muted-foreground">Sin cuentas.</p>
      ) : (
        <ul className="space-y-1.5">
          {grupos.map((grupo) => (
            <li key={grupo.fecha_vencimiento ?? "sin-fecha"} className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">
                {grupo.fecha_vencimiento ?? "Sin fecha de vencimiento"} ({grupo.cuentas.length})
              </span>
              <span className="font-mono text-xs text-foreground">$ {monto(grupo.total)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
