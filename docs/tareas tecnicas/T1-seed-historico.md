# T1 — Seed histórico para el Sprint 5

**Estimación:** 5 SP. **Tipo:** tarea técnica transversal. **Dependencias:** HU-G12 y HU-G13 para las categorías y gastos; modelos y servicios existentes de B, E, G y H. **Consumidores:** HU-G3, G4, G14, G15 y G16; D6 reutiliza los históricos solo para verificar el cálculo de G14. **Fuente:** `sprint_5_swat_indumentarias_erp.md`, T1 y criterios de esas HU.

## Objetivo y límite

Preparar en una base de demostración un historial coherente de 3 a 6 meses anteriores a octubre de 2026: fechas absolutas entre abril y julio de 2026, repartidas en varios meses y reproducibles. El seed aporta datos para filtros, reportes, gráficos, Libro de IVA y PDF. También permite comprobar el cálculo histórico de G14 consumido por D6, pero no dispara alertas operativas de un mes ya terminado: D6 debe probar su creación, cambio de nivel y resolución con fixtures propios del mes bajo evaluación y reloj controlado, conforme a `spec_modulo_D.md` §8.2. No implementa reglas de cálculo de las HU ni crea las cuentas propias o los saldos diarios, que corresponden a G5 y G7.

## Datos mínimos verificables

| ID | Condición de cierre |
|---|---|
| T1-1 | Sembrar ventas de mostrador facturadas en al menos dos meses y con más de un medio de pago. Incluir una venta en cuenta corriente identificable, que G14 muestre fuera del total de ingresos. |
| T1-2 | Sembrar cobros web confirmados con su `IngresoTesoreria`, algunos pendientes de conciliación y otros conciliados. Incluir un reintegro web con su contra-asiento en un mes identificable, de modo que G14 reste el reintegro en el mes del contra-asiento. |
| T1-3 | Sembrar cuentas por pagar `PAGADA` con `fecha_pago` en al menos dos meses, de al menos dos proveedores distintos. Cada proveedor/comprobante fiscal de compra usado en G4/G15 debe tener su vínculo válido con la orden de compra y la cuenta por pagar. Incluir al menos un pago asociado a más de un comprobante para verificar que G15 no multiplica el importe y sí cuenta comprobantes distintos. |
| T1-4 | Sembrar gastos operativos activos en varios meses y categorías, más al menos un gasto dado de baja. Este último permanece en el histórico, pero no integra totales de G13/G14. |
| T1-5 | Sembrar comprobantes fiscales de mostrador y web con CAE simulado, QR local válido y relación de Nota de Crédito con original cuando corresponda. La visualización y descarga PDF de G3 deben poder abrirse con estos datos. |
| T1-6 | Mantener numeración continua de las ventas creadas por el seed, sin saltos ni colisiones con los datos que ya existan. No renumerar ventas existentes. |
| T1-7 | Usar identificadores estables y `upsert` o equivalentes idempotentes. Dos ejecuciones consecutivas producen la misma cantidad, importes, relaciones y fechas de registros históricos; no duplican cobros, comprobantes, notas, gastos ni pagos. |
| T1-8 | El seed no escribe `AuditLog` ni emite eventos operativos hacia D.3. El volumen y último hash del log permanecen iguales antes y después de una ejecución de T1. |

## Integridad y seguridad

- Fechas absolutas dentro del intervalo histórico acordado; evitar `hoy - N días` para que la demostración no cambie con el tiempo.
- Importes y medios de pago coherentes entre venta, comprobante, cobro y contra-asiento. No crear ingresos web duplicados desde ventas de mostrador.
- Respetar claves foráneas, bajas lógicas y la regla de no borrar físicamente. Usar solo datos ficticios; no incorporar credenciales ni datos personales reales.
- Registrar en la documentación del seed los identificadores de los fixtures y el mes de cada caso. No registrar secretos en la salida de ejecución.

## Verificación y evidencia

1. Ejecutar el seed dos veces sobre una base aislada. Comparar conteos y sumas de cada entidad de T1 y constatar que no crecieron en la segunda ejecución.
2. Consultar dos meses con G14: comprobar ingresos de mostrador y web, reintegro, cuenta corriente informativa, pagos, gastos activos y exclusión del gasto dado de baja. Un mes sin movimientos debe conservar ceros.
3. Abrir y descargar en G3 un comprobante de cada canal y una Nota de Crédito; verificar QR legible y vínculo bidireccional. Exportar G4 y comprobar que los documentos sembrados aparecen una sola vez.
4. Consultar G15 con dos proveedores y el pago de varios comprobantes: total de pagos sin multiplicación y conteo de comprobantes distintos. Comprobar que G16 muestra meses con y sin actividad.
5. Comparar cantidad y hash final de `AuditLog` antes/después. Guardar en la evidencia del PR las consultas y resultados, sin datos sensibles.

**Cierre:** T1 termina cuando los fixtures existen, son repetibles y G3/G4/G14/G15/G16 pueden verificar sus casos históricos. La prueba de alertas operativas pertenece a D6; no se declara cubierta por T1. Los fallos de cálculo de una HU se corrigen en esa HU, sin alterar el seed para ocultarlos.
