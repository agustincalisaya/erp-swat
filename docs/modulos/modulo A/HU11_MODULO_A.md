# HU-A11 — Wizard de Carga de Movimiento + Historial Operativo de Depósito

**Módulo:** A — Gestión de Inventario y Depósito
**Responsable:** Lautaro Vilte
**Estado:** Implementada (wizard de Ingreso y Transferencia + historial operativo), con el tipo de movimiento "Ajuste" deliberadamente deshabilitado — ver Sección 9.

## 1. Objetivo

Unificar la carga de movimientos de stock (Ingreso y Transferencia) bajo un único flujo de wizard de 3 pasos con orden fijo, y ofrecer una vista de historial operativo por depósito, producto, tipo y fecha, sin depender del log forense de Auditoría (HU-A6).

**Criterios de aceptación:**

1. El flujo de carga presenta los pasos en el orden fijo: Depósito → Tipo de Movimiento (Ingreso / Transferencia / Ajuste) → Producto(s).
2. Según el tipo de movimiento elegido, el wizard invoca el Server Action ya existente correspondiente (`crearIngreso` de HU-A2 o `crearTransferencia` de HU-A4) sin duplicar ni reimplementar su lógica de negocio, validaciones o manejo de transacciones.
3. Se incorpora una vista de historial de movimientos, filtrable por depósito, producto, tipo de movimiento y rango de fechas.
4. El historial de movimientos es de uso operativo (visible para Encargado de Depósito), y es distinto del log de auditoría forense de HU-A6 (acceso exclusivo de Auditor, con verificación de cadena SHA-256).
5. La tabla del historial reutiliza el mismo componente de tabla/filtro/buscador/paginación implementado en la ampliación de HU-A5.

**Nota de coordinación del backlog:** "No reabre HU-A2 ni HU-A4: su lógica de negocio, contratos de API y transacciones atómicas se mantienen intactos. Requiere coordinación con quien implementó A2/A4 en Sprint 1 para reusar los Server Actions sin fricción, y con quien tome HU-A5 ampliada por el componente de tabla compartido."

**Discrepancia de nombres, documentada explícitamente (igual que HU-A1 documentó `ean_qr` vs. `spec_modulo_A.md`):** el backlog y `spec_modulo_A.md §2.10` nombran la función de ingreso como `crearIngreso`. Ese nombre **no existe en el código**. La función de negocio real, ya construida en HU-A2, es `registrarIngresoStock()` (`lib/services/inventario/movimiento.service.ts:304`). `crearTransferencia()` sí coincide literalmente con el nombre del backlog (`lib/services/inventario/transferencia.service.ts:259`). No es un bug de esta HU — es la misma función preexistente de HU-A2, solo que el backlog la referencia con un nombre que nunca se usó en la implementación.

## 2. Modelo del wizard

```
Paso 1                Paso 2                        Paso 3
Depósito       →       Tipo de movimiento     →      Producto(s)
(único <select>)       Ingreso | Transferencia |     PasoIngreso.tsx
                        Ajuste (deshabilitado)        o PasoTransferencia.tsx
```

`MovimientoWizard.tsx` (`src/components/inventario/wizard/MovimientoWizard.tsx`) es el orquestador cliente. Mantiene el estado local `paso` (1-3), `depositoId` y `tipo`, y renderiza condicionalmente cada paso. No hay componentes separados para "selector de depósito" ni "selector de tipo de movimiento": ambos van **inline** dentro de este mismo archivo —

- Paso 1: un `<select>` nativo poblado con `depositos: DepositoActivo[]` (prop, cargada por `page.tsx` vía `listarDepositosActivos()`).
- Paso 2: tres botones tipo tarjeta (Ingreso / Transferencia / Ajuste), cada uno habilitado según el permiso del usuario (`puedeRegistrarIngreso`, `puedeTransferir`) — ver Sección 9 para el caso de "Ajuste".
- Paso 3: delega en `PasoIngreso.tsx` o `PasoTransferencia.tsx` según `tipo`, inyectándoles el depósito elegido en el paso 1 ya resuelto (`depositoDestinoId` / `depositoOrigenId`, según corresponda).

El selector de producto/variante es el mismo componente (`ComboboxFiltrable.tsx`, `src/components/inventario/ComboboxFiltrable.tsx`) reutilizado sin cambios en ambos pasos, sobre el mismo catálogo `variantes: VarianteTransferible[]` cargado una sola vez por `page.tsx` (`listarVariantesTransferibles()`) y pasado como prop a los dos pasos.

## 3. Contrato de no-duplicación

El wizard es exclusivamente una capa de **orquestación de UI**: secuencia la recolección de inputs (depósito → tipo → producto/cantidad) y arma el payload para el Server Action correspondiente. No contiene lógica de negocio propia — ni validación de stock, ni cálculo de SKU, ni manejo de `$transaction`. Esa responsabilidad permanece íntegramente en la capa de servicios preexistente:

- **Ingreso:** `PasoIngreso.tsx` arma un carrito local (multi-ítem) y, al confirmar, llama a `registrarIngresoStockAction()` una única vez con todos los ítems. Esa Server Action (`src/app/(dashboard)/inventario/movimientos/actions.ts:102`) delega en `registrarIngresoStock()` (`movimiento.service.ts:304`), función que ya existía desde HU-A2 y que esta HU **no modifica en su lógica interna** — el único cambio de contrato es que ahora recibe `{ deposito_destino_id, comprobante_referencia, items[] }` en vez de un ítem suelto, para soportar el carrito multi-ítem (ver comentario en `actions.ts`).
- **Transferencia:** `PasoTransferencia.tsx` arma su propio carrito y llama a `crearTransferenciaAction()`, que delega en `crearTransferencia()` (`transferencia.service.ts:259`), también preexistente de HU-A4.
- Ninguno de los dos pasos abre un `prisma.$transaction` propio ni implementa reglas de validación de stock: ambas cosas viven exclusivamente dentro de `registrarIngresoStock()`/`crearTransferencia()`.
- El depósito ya no se elige dentro de cada paso (a diferencia de los paneles originales de HU-A2/HU-A4): llega fijo como prop desde el paso 1 del wizard.

## 4. Historial operativo

`HistorialMovimientos.tsx` (`src/components/inventario/HistorialMovimientos.tsx`), montado desde `movimientos/historial/page.tsx`, expone los siguientes filtros:

| Filtro | Mecanismo en la UI | Parámetro enviado al endpoint |
|---|---|---|
| Depósito | `ComboboxFiltrable` sobre `depositos` (prop) | `deposito_id` |
| Tipo de movimiento | `ComboboxFiltrable` sobre lista fija (`INGRESO`, `EGRESO`, `TRANSFERENCIA`, `AJUSTE`) | `tipo_movimiento` |
| Rango de fechas | `RangoFechasCalendario.tsx` | `fecha_desde`, `fecha_hasta` |
| Producto | Buscador de texto libre integrado en `TablaFiltroPaginada` (por SKU o nombre de producto) | `busqueda` |

**Precisión sobre el filtro de "producto":** el criterio de aceptación #3 pide poder filtrar por producto. La implementación real lo resuelve con el buscador de texto libre (`busqueda`, contra SKU o nombre de producto) que ya trae `TablaFiltroPaginada` de HU-A5, **no** con un selector dedicado de variante. El backend sí soporta un filtro exacto por variante (`variante_sku_id` en `HistorialMovimientosQuerySchema`, `lib/schemas/inventario.schema.ts:417`, resuelto en `listarHistorialMovimientos()`), pero `HistorialMovimientos.tsx` nunca envía ese parámetro — no hay ningún `ComboboxFiltrable` de producto cableado a `variante_sku_id` en esta pantalla. El criterio de aceptación queda cubierto en la práctica (se puede filtrar por producto), pero por un mecanismo distinto al que el nombre "filtro por producto" sugeriría a primera vista.

**Diferencia explícita con HU-A6 (Consola de Auditoría Forense):** ambos endpoints leen la misma tabla base (`MovimientoStock`), pero:

| | Historial operativo (HU-A11) | Auditoría forense (HU-A6) |
|---|---|---|
| Rol de acceso | Encargado de Depósito | Auditor |
| Permiso | `inventario:movimientos:leer_historico` | `auditoria:leer_historico` |
| Verificación de cadena SHA-256 | No | Sí |
| Propósito | Consulta de conveniencia operativa | Trazabilidad forense inmutable |

Esta distinción está codificada tanto en el comentario de cabecera del route handler (`src/app/api/inventario/movimientos/historial/route.ts`) como en `spec_modulo_A.md §2.10`, y no hay ningún punto del código donde ambos endpoints compartan Route Handler o lógica de query.

## 5. Reutilización del componente de HU-A5

`TablaFiltroPaginada.tsx` (`src/components/inventario/TablaFiltroPaginada.tsx`) se usa **tal cual**, sin extender. Confirmado contra el historial de git: el único commit que tocó ese archivo en todo el repositorio es `7c0e97d` ("HU-A5 Completa...") — ningún commit de HU-A11 (`89a4353`, `b248200`) modifica `TablaFiltroPaginada.tsx`. `HistorialMovimientos.tsx` le inyecta:

- `columnas`: definición propia del shape de `MovimientoHistorialItem` (Producto(s), Tipo, Depósito, Cantidad, Registrado por, Fecha, acción "Ver detalle").
- `cargarPagina`: `fetch()` contra `GET /api/inventario/movimientos/historial`.
- `revalidarCuando`: `[depositoId, tipoMovimiento, fechaDesde, fechaHasta]`, para resetear a página 1 cuando cambia alguno de los filtros que viven fuera del componente (depósito/tipo/fecha; el buscador de texto lo resuelve el propio `TablaFiltroPaginada`).

Los dos componentes construidos específicamente para HU-A11 y que no existían en HU-A5 son `RangoFechasCalendario.tsx` (selector de rango de fechas) y `DetalleMovimientoDialog.tsx` (dialog de detalle por movimiento, alimentado por el array `items` que ya trae cada fila sin un segundo fetch).

## 6. Endpoints y Server Actions

| Acción | Invocada desde | Server Action / Route Handler | Función de negocio real |
|---|---|---|---|
| Resolver código de escaneo | `PasoIngreso.tsx` | `resolverCodigoEscaneoAction()` | `resolverCodigoEscaneo()` |
| Registrar ingreso (carrito) | `PasoIngreso.tsx` | `registrarIngresoStockAction()` | `registrarIngresoStock()` (`movimiento.service.ts:304`) |
| Consultar stock disponible en origen | `PasoTransferencia.tsx` | `obtenerStockDisponibleAction()` | `obtenerStockDisponible()` |
| Generar transferencia (carrito) | `PasoTransferencia.tsx` | `crearTransferenciaAction()` | `crearTransferencia()` (`transferencia.service.ts:259`) |
| Confirmar recepción (total/parcial) | `RecepcionesPendientesPanel` (fuera del wizard, paso separado de la pantalla) | `confirmarRecepcionTransferenciaAction()` | `confirmarRecepcionTransferencia()` |
| Consultar historial operativo | `HistorialMovimientos.tsx` | — (no es Server Action) | `GET /api/inventario/movimientos/historial` → `listarHistorialMovimientos()` |

Todas las Server Actions viven en `src/app/(dashboard)/inventario/movimientos/actions.ts` y siguen el shape `ActionResult<T>` (`{ success, data?, error? }`), no el `{ data, error }` de los Route Handlers REST. El endpoint de historial es la única pieza de esta HU implementada como Route Handler REST en lugar de Server Action — `HistorialMovimientos.tsx` hace `fetch()` directo contra `GET /api/inventario/movimientos/historial`, capa delgada que valida `HistorialMovimientosQuerySchema` y delega 100% en `listarHistorialMovimientos()`, sin ninguna llamada a Prisma en el propio route handler.

Cada Server Action repite la misma capa 2 de RBAC (sesión + permiso puntual) antes de tocar el service, documentada en el propio `actions.ts` como el mismo criterio ya usado por `darDeBajaVarianteAction` (HU-A6).

## 7. Eventos de dominio

El wizard no emite ningún evento de dominio propio — delega el 100% de la emisión en las funciones de negocio preexistentes que ya orquestaba antes de esta HU:

| Evento | Disparado por | Preexistente de |
|---|---|---|
| `inventario:ingreso_stock_registrado` | `registrarIngresoStock()` | HU-A2 |
| `stock:transferencia_iniciada` | `crearTransferencia()` | HU-A4 |
| `stock:transferencia_recepcion_confirmada` | `confirmarRecepcionTransferencia()` | HU-A11 (recepción parcial, no forma parte del wizard de 3 pasos) |

`listarHistorialMovimientos()` es una consulta de solo lectura: no abre `$transaction` ni emite eventos.

## 8. Cómo probar

**Flujo manual — Ingreso:**

1. Ir a `/inventario/movimientos`.
2. Paso 1: elegir un depósito activo → "Siguiente".
3. Paso 2: elegir la tarjeta "Ingreso" (deshabilitada si el usuario no tiene el permiso de registrar ingreso).
4. Paso 3 (`PasoIngreso`): escanear un código (o tipearlo manualmente, o buscar por nombre/SKU con el combobox), confirmar cantidad/estado destino en el mini-formulario y "Agregar al carrito". Repetir para varios ítems.
5. Completar "Comprobante / remito" (opcional) y "Confirmar ingreso (N)".
6. Verificar el toast de éxito y que el carrito quede vacío.
7. Ir a `/inventario/movimientos/historial` y confirmar que el movimiento `INGRESO` recién creado aparece primero (orden `created_at DESC`), con el depósito, cantidad total y usuario correctos.

**Flujo manual — Transferencia:**

1. Ir a `/inventario/movimientos` → elegir depósito origen → "Siguiente" → tarjeta "Transferencia".
2. Paso 3 (`PasoTransferencia`): buscar una variante por SKU/nombre, elegir depósito destino (distinto del origen), verificar que se muestre el stock disponible en origen, cargar cantidad ≤ disponible y "Agregar al carrito". Repetir para varios ítems.
3. "Generar transferencia (N)" y verificar el remito `EN_TRANSITO` mostrado en pantalla.
4. Ir a `/inventario/movimientos/historial`, filtrar por el depósito origen o destino, y confirmar que aparece el movimiento `TRANSFERENCIA` con ambos depósitos.
5. (Fuera del wizard, en la misma pantalla `/inventario/movimientos`) usar `RecepcionesPendientesPanel` para confirmar la recepción, total o parcial, y verificar que el historial refleje el segundo `MovimientoStock` generado por `confirmarRecepcionTransferencia()`.

**Historial:**

1. Combinar los cuatro filtros (depósito, tipo, rango de fechas, buscador de texto) y verificar que la paginación se resetea a página 1 al cambiar cualquiera de los tres filtros externos a `TablaFiltroPaginada`.
2. Abrir "Ver detalle" de una fila con más de un ítem y confirmar que el dialog muestra cada línea (`MovimientoHistorialItemDetalle`) sin una segunda request de red.
3. Confirmar que un usuario sin el permiso `inventario:movimientos:leer_historico` es redirigido a `/no-autorizado` al intentar acceder a `/inventario/movimientos/historial`.

## 9. Estado actual y pendientes

**Completo y verificable en código:**
- Wizard de 3 pasos con orden fijo Depósito → Tipo → Producto(s), para los tipos Ingreso y Transferencia.
- Reuso sin modificación de `registrarIngresoStock()` y `crearTransferencia()` (criterio de aceptación #2), salvo el cambio aditivo de contrato a `items[]` para soportar carrito multi-ítem.
- Historial operativo filtrable por depósito, tipo y fecha, con el filtro de producto resuelto vía buscador de texto (Sección 4).
- Historial estructuralmente separado de HU-A6, con permiso propio y sin cálculo de hashes.
- Reutilización literal de `TablaFiltroPaginada.tsx` de HU-A5, sin extenderlo.

**Gap confirmado contra el criterio de aceptación #1 — tipo de movimiento "Ajuste":**

El paso 2 del wizard (`MovimientoWizard.tsx`) muestra la tarjeta "Ajuste" como una tercera opción **visible**, con un badge "Próximamente" superpuesto y el atributo `disabled` fijo (sin ninguna condición de permiso, a diferencia de las tarjetas de Ingreso/Transferencia). Es decir: **no está oculta, pero tampoco es una opción rota** — el botón nunca dispara su `onClick` porque está deshabilitado a nivel HTML, por lo que no hay ningún flujo que falle al hacer clic; simplemente no hay ningún flujo que arrancar. No existe `PasoAjuste.tsx` ni ningún Server Action de creación de ajustes en todo el repositorio.

Esto no es un descuido de esta HU: la funcionalidad de origen — "realizar ajustes manuales de inventario con doble validación cuando superen el umbral crítico" (Módulo A, 8 SP, requiere flujo de aprobación de Supervisor) — está explícitamente diferida según la nota de planificación de Sprint 1 del Product Backlog: *"Quedan fuera de este sprint por alta complejidad o por depender de infraestructura aún no construida: ajustes con doble validación (8 SP — requiere flujo de aprobación de Supervisor)"*. HU-A11 no puede exponer un tipo de movimiento "Ajuste" funcional porque su lógica de negocio de origen todavía no existe en el sistema.

**Pendiente, sin HU asignada todavía:** cuando se implemente esa HU de ajustes, construir `PasoAjuste.tsx` sobre el mismo patrón de `PasoIngreso.tsx`/`PasoTransferencia.tsx` (recibe el depósito del paso 1 como prop, arma su propio carrito, invoca el Server Action de ajustes sin reimplementar su lógica) y quitar el `disabled` fijo de la tarjeta correspondiente en `MovimientoWizard.tsx`, condicionándolo al permiso que esa HU defina.