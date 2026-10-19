# Handoff para HU-G14 — reporte mensual de Tesorería

**Fecha del relevamiento:** 18/10/2026  
**Propósito:** entregar al responsable de HU-G14 el estado y los contratos de HU-G12/G13. Este documento no reemplaza el Backlog, el Alcance ni `docs/specs/spec_modulo_G.md` §9.4.

## Antes de empezar: base de trabajo

En el checkout revisado, la rama activa es `main` (`c7e876d`) y G12/G13 figuran como **cambios locales sin confirmar**. En la sesión donde se implementaron se informaron los commits `82679a6` y `89cfef7` (G12), `75b094e` y `6e12403` (G13); los objetos Git existen, pero no están en la historia de la rama `main` revisada. Confirmar con el responsable cuál rama/PR contiene esos commits y trabajar sobre una base que incorpore G12/G13. No sobrescribir ni descartar los cambios locales para preparar G14.

La carpeta `docs/tasks/` está ignorada por Git. Si se comparte una task de G14 desde allí, enviarla por separado y verificar su versión; la fuente contractual versionada es `docs/specs/spec_modulo_G.md` §9.4 y el Backlog `Sprint 5`, fila 9.

## Qué entregan G12 y G13

| Componente | Estado/contrato para G14 |
|---|---|
| Persistencia | `CategoriaGasto` y `GastoOperativo` ya están en `prisma/schema.prisma`; su migración es `20261014052506_hu_g12_g13_gastos_operativos`. `GastoOperativo.monto` es `Decimal(12,2)`; `fecha` representa un día calendario a medianoche UTC; ambas entidades usan baja lógica. |
| Categorías | El seed de G12 crea Sueldos, Alquiler, Servicios, Impuestos y Otros con IDs fijos. El nombre sigue disponible si la categoría se da de baja. Mapeo: `docs/testing/Modulo G/hu-g12/identificadores.md`. |
| Gastos | G13 implementa alta, edición, baja lógica y listado. La consulta operativa `listarGastosOperativos()` es **paginada** y requiere permiso de gestión; no usarla como fuente del cálculo global de G14. Consultar `GastoOperativo` desde el servicio de reportes con los filtros y permisos propios de G14. |
| Auditoría y alertas | G13 emite `gasto_operativo:creado`, `:editado` y `:dado_de_baja` después del COMMIT. D.3 registra la transición; D6 escucha los eventos y reevalúa el mes afectado, ambos meses si cambia la fecha. G14 no debe reemitir esos eventos ni duplicar su listener. |
| Pruebas | Evidencia G12: `docs/testing/Modulo G/hu-g12/evidencia.md`. Evidencia G13: `docs/testing/Modulo G/hu-g13/evidencia.md`. La única prueba que G13 dejó bloqueada es su impacto en el reporte real de G14. |

## Contrato directo de G14

- Implementar `obtenerResumenMensual(anio, mes, { incluir_desglose_gastos })` en `src/lib/services/tesoreria/reporte-mensual.service.ts`. **Hoy es un stub que devuelve ceros.** Conservar el contrato `ResumenMensualDto` de `reporte-mensual.types.ts`: campos `snake_case`, importes como strings con dos decimales y `porcentaje_egresos_sobre_ingresos: number | null`.
- La fuente de verdad de criterios es `docs/specs/spec_modulo_G.md` §9.1 y §9.4, G14-1…G14-14. El reporte es de base caja; un mes sin fuentes devuelve la estructura completa en cero. La API y la pantalla deben consumir la misma función, sin recalcular totales en componentes.
- Para gastos, consultar `GastoOperativo` con `is_active = true` y `fecha` dentro de `[desde, hasta)` de `rangoMesFechaSolo(anio, mes)`; sumar con `Prisma.Decimal` o aritmética decimal exacta. No usar `rangoMesNegocio` para esa columna de fecha solo-día. La baja de una categoría **no** excluye sus gastos activos; agruparlos por su `CategoriaGasto` relacionada y conservar el nombre visible. La baja de un gasto sí lo excluye de totales y detalles.
- Para importes con fecha de instante real, §9.1 usa el mes argentino con `rangoMesNegocio`. Hay una salvedad ya documentada por HU-G15: `CuentaPorPagar.fecha_pago` contiene convenciones mixtas (día a medianoche UTC desde UI e instante desde API). Revisar `fechaPagoEnMes()` y `diaDeVigencia()` en `reporte-mensual-extensiones.calculo.ts` antes de fijar el filtro de pagos; G14 y G15 deben atribuir el pago al mismo mes.
- Otras fuentes según G14-3…G14-5: `IngresoTesoreria` por `fecha`, `ContraAsientoIngreso` por `created_at`, y `VentaMedioPago` de ventas de mostrador facturadas por `PedidoVenta.fecha_facturacion`. `CUENTA_CORRIENTE` de mostrador es informativa y queda fuera de los totales. Evitar multiplicaciones al unir ítems o comprobantes.
- Acceso: `tesoreria:leer_reportes` habilita la lectura; **no** usar `tesoreria:gestionar_gastos` para el reporte. `tesoreria:leer_desglose_gastos` controla categorías y filas individuales de gasto. Sin ese permiso, devolver `gastos_por_categoria: null` y omitir conceptos/categorías/filas de gasto del DTO enviado al navegador; queda visible solo el total agregado. No basta ocultar filas con CSS. El permiso de desglose no aparece aún en el `seed.ts` del checkout revisado: G14-11 asigna a G14 el alta/asignación necesaria, incluido Gerente y excluido Cajero POS. Comprobar el estado del seed antes de tocarlo.
- El reporte informa que no discrimina IVA. `ingresos.total`, `egresos.total`, `resultado_neto` y el porcentaje siguen exactamente G14-7; cuando ingresos `<= 0`, el porcentaje es `null` y la UI muestra «—».

## Consumidores que esperan el servicio real

- `reporte-mensual-extensiones.service.ts` (HU-G15) ya importa `obtenerResumenMensual` para la comparación con el mes anterior. Sus tests usan dobles porque G14 aún es stub. Revisar los tests de integración: uno comprueba expresamente la situación actual de ceros y deberá adaptarse cuando G14 sea real.
- `alerta-desvio.service.ts` (HU-D6) también importa `obtenerResumenMensual` para evaluar el porcentaje de egresos. Probar su integración con un mes actual controlado; los eventos de meses históricos no deben crear alertas operativas para meses terminados.
- HU-G16 reutilizará el mismo DTO para gráficos y exportación. Mantener su forma y los controles de desglose.

## Prueba de integración pendiente de G13

En una **base local descartable**, preparar al menos dos gastos activos del mes consultado, uno con categoría que luego se dé de baja, otro gasto dado de baja y un gasto activo de otro mes. Verificar en `obtenerResumenMensual` y en la respuesta autorizada que:

1. Solo los gastos activos del mes suman en `egresos.gastos_operativos`, `egresos.total` y `resultado_neto`, con importes exactos de dos decimales.
2. La categoría inactiva conserva su nombre en el desglose autorizado y sus gastos activos siguen sumando.
3. El gasto dado de baja y el gasto de otro mes no aparecen ni suman.
4. Con `incluir_desglose_gastos: false` el total agregado coincide, `gastos_por_categoria` es `null` y no se serializan conceptos ni filas de gasto; con permiso sí aparece el desglose correcto.
5. Un mes vacío devuelve `0.00` y detalle vacío. Verificar límites de mes con la fecha solo-día, incluida una fecha del último día del mes.

Registrar esta evidencia como cierre del caso bloqueado por G13, sin modificar el cálculo de G13 ni sus eventos. Los históricos de T1 son otra dependencia; para esta prueba alcanza con fixtures aislados y reproducibles.

## Archivos para abrir primero

1. `RULES.md` y `docs/specs/spec_modulo_G.md` §§9.1, 9.3 y 9.4; Backlog `Sprint 5`, fila 9.
2. `src/lib/services/tesoreria/reporte-mensual.types.ts`, `reporte-mensual.service.ts` y su test del stub.
3. `src/lib/utils/fecha-negocio.ts`: `rangoMesNegocio`, `rangoMesFechaSolo`, `diaCalendarioUtc`, `diaDeVigencia`.
4. `prisma/schema.prisma`: `CategoriaGasto`, `GastoOperativo`, `CuentaPorPagar`, `IngresoTesoreria`, `ContraAsientoIngreso`, `PedidoVenta`, `VentaMedioPago`.
5. `src/lib/services/tesoreria/gasto-operativo.service.ts` y evidencia G13 para sus invariantes; `reporte-mensual-extensiones.service.ts`/`.calculo.ts` para la integración G15; `alerta-desvio.service.ts` para D6.

Respetar `AGENTS.md`: antes de escribir código de Next.js, leer la guía pertinente de `node_modules/next/dist/docs/`. No ejecutar seed o migraciones contra una base real.
