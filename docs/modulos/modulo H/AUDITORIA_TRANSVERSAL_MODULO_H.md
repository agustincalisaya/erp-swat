# Auditoría transversal — Módulo H (Proveedores y Abastecimiento), HU-H1 a HU-H9

> **Tipo de documento:** auditoría transversal del módulo, no cierre de una HU puntual.
> **Fecha:** 2026-09-26. **Estado del código auditado:** working tree de `feature/UI-cerrar-proveedores` (incluye el trabajo sin commitear de HU-H2/H6/H7 de la misma fecha).
> **Alcance:** diagnóstico puro. No se corrigió ningún hallazgo durante la auditoría.

## Método

| Fase | Qué se hizo | Evidencia |
|---|---|---|
| 1. Código ↔ documentación | Relectura completa de `HU1`…`HU9_MODULO_H.md` contra el código actual (rutas, shapes, permisos, eventos, seed). Inventario de todo evento de H1/H3/H4/H5/H9 que llega al `AuditLog`. | `archivo:línea` citado en cada hallazgo |
| 2. Navegador | 4 roles reales del seed (`comprador.seed`, `supervisor.compras.seed`, `encargado.seed`, `auditor.seed`). Acceso por menú y por URL directa a las 7 pantallas; matriz de 18 endpoints × 4 roles; doble clic en cada acción irreversible. | Respuestas HTTP reales; log del servidor de desarrollo (una invocación de Server Action por acción) |
| 3. Integración punta a punta | Alta de proveedor → homologación → publicación de lista → OC → envío → confirmación → recepción → evaluación → comprobante → cierre → Cuenta por Pagar, con datos reales. | Estado final leído de la base (solo lectura) + `verificarCadenaIntegridad()` |

**Resultado del caso punta a punta (OC-2026-000004):** cada paso dejó el estado que el siguiente esperaba. Precio congelado desde la lista vigente ($21.000), `CONFIRMADA → RECIBIDA_COMPLETA` en una sola recepción, `EvaluacionProveedor` creada, comprobante registrado, `CERRADA`, `CuentaPorPagar` en `DEFINITIVA` por $210.000, y cadena SHA-256 íntegra (68 registros). Los hallazgos de abajo aparecieron **alrededor** de ese camino, no lo rompieron.

---

## 1. Tabla resumen

Clasificación: **(a)** bug real contra regla de negocio o CA · **(b)** inconsistencia documentación ↔ código · **(c)** UI · **(d)** riesgo ya documentado (sección 3).

| # | HU | Hallazgo | Clase | Severidad | Evidencia |
|---|---|---|---|---|---|
| A1 | H2 | No se puede publicar una lista con vigencia **desde hoy**; el formulario la propone por defecto y el backend la rechaza | a | **Bloquea el cierre** | `lista-precios.schema.ts:34-36`; `FormularioNuevaVersionListaPrecio.tsx:54`; caso probado |
| A2 | H5 | Una entrega **el mismo día comprometido** se penaliza como 1 día de atraso | a | **Bloquea el cierre** | `evaluacion.calculo.ts:43-44`; caso probado (plazos = 95) |
| A3 | H2↔H3 | Publicar una versión parcial deja **sin precio de compra** a todas las variantes que no incluye | a | **Bloquea el cierre** (requiere decisión del PO) | `lista-precios.service.ts` (`obtenerVersionVigente`) + `orden-compra.service.ts:216-235`; caso probado |
| B1 | H3 | `HU3_MODULO_H.md` describe `RECEPCION_PARCIAL`, que H4 V2.1 eliminó | b | No bloquea, corregir | `recepcion.service.ts:168,191`; commit `799ad6b` |
| B2 | H3/H4 | El tipo del evento todavía declara `RECEPCION_PARCIAL` | b | No bloquea, corregir | `event-types.ts:344-353` |
| B3 | H4 | El comentario del modelo `Recepcion` promete recepciones múltiples | b | No bloquea, corregir | `schema.prisma:956-962` |
| B4 | H3 | "Camino A" (dependencia de H2 diferida) quedó resuelto sin que el doc lo registre | b | No bloquea, corregir | `orden-compra.service.ts:149-151` |
| B5 | H9 | El doc marca como pendiente una pantalla de Cuentas por Pagar que ya existe | b | No bloquea, corregir | `tesoreria/cuentas-por-pagar/page.tsx` |
| C1 | H3/H4 | Título de pestaña "Create Next App" | c | No bloquea, corregir | `compras/ordenes/[id]/page.tsx`, `compras/recepciones/nueva/page.tsx` (sin `metadata`) |
| C2 | H1/H3 | Texto interno "(Módulo D)" visible al usuario final | c | No bloquea, corregir | `DialogHomologar.tsx:112`, `DialogVolverPendiente.tsx:122`, `ordenes/[id]/page.tsx:477` |
| C3 | H3 | Botón "Nueva orden de compra" visible para quien no puede crear (Auditor) | c | No bloquea, corregir | `compras/ordenes/page.tsx:125-131` |
| C4 | H1 | Ítem "Proveedores" del sidebar visible para Encargado de Depósito, que recibe Acceso Denegado | c | No bloquea, corregir | `Sidebar.tsx:129-132` (sin `permiso`) |
| C5 | H4 | "Volver a órdenes" lleva al Encargado de Depósito a una pantalla que tiene prohibida | c | No bloquea, corregir | `recepciones/nueva/page.tsx:66-67` |
| C6 | Transversal | Un clic hecho apenas carga la página se pierde sin feedback | c | No bloquea, corregir | Observado en "Aprobar" (H2) e "Ingresar" (login); sin invocación en el log del servidor |
| C7 | H2/H7 | El Auditor puede leer el historial de versiones por API pero no tiene pantalla | c | No bloquea — **confirmar con la matriz de roles** | `GET /api/proveedores/[id]/lista-precios` → 200; `/compras/listas-precios` → Acceso Denegado |

**Verificado sin hallazgos** (se deja explícito para que no se re-audite):

- **Doble clic en las 9 acciones irreversibles** probadas (crear proveedor, homologar, publicar lista, crear OC, enviar, confirmar, recepción, comprobante, cerrar): exactamente **una** invocación por acción en el log del servidor.
- **Matriz de acceso por URL directa y por API** (18 endpoints × 4 roles): cada rol recibe `403` o "Acceso Denegado" fuera de su permiso. No hay ninguna ruta de H1/H3/H4/H5/H9 sin gate.
- **Exclusividad de H8:** `proveedores:leer_costo_reposicion` no está asignado a ningún rol humano (`seed.ts:1469-1479`). `GET /api/proveedores/costo-reposicion/*` devuelve `403` a los 4 roles. Ninguna página, componente ni Server Action lo consume.
- **Vigencia única para todos los consumidores:** H3, H7 y H8 pasan por `resolverListaPrecioVigente()` (`publicada: true`, `fecha_inicio_vigencia <= now()`). Ninguna versión pendiente ni futura se filtra a la OC, a la comparativa ni al costo de reposición.
- **Riesgo de precisión del ledger en H1/H3/H4/H5/H9:** ningún evento de estas HU persiste un `number` no entero (ver D1).

---

## 2. Detalle de hallazgos

### A1 — No se puede publicar una lista con vigencia desde hoy (HU-H2)

**Síntoma.** En `/compras/listas-precios`, con la fecha que el formulario propone por defecto (hoy), "Confirmar publicación" responde *"La fecha de vigencia no puede ser anterior al día de hoy"*. Con la fecha de mañana, publica.

**Causa raíz.**

- **El validador compara contra la medianoche local** (`lista-precios.schema.ts:34-36`):
  ```ts
  fecha_inicio_vigencia: z.coerce.date().refine(
    (d) => d >= new Date(new Date().toDateString()), …
  ```
  `z.coerce.date("2026-09-26")` es `2026-09-26T00:00:00Z`. En cambio, `new Date(new Date().toDateString())` es la medianoche **local**: `2026-09-26T03:00:00Z` en UTC-3. La fecha elegida queda 3 horas "antes de hoy" y se rechaza. En Argentina, "desde hoy" es imposible siempre.
- **El default del formulario calcula "hoy" en UTC** (`FormularioNuevaVersionListaPrecio.tsx:54`: `new Date().toISOString().slice(0, 10)`). Desde las 21:00 hora local, el formulario propone **mañana**.

Es la misma clase de bug que el Bug 1 de HU-H3 y que el Bug 1 de la UI de HU-H2 (fecha-solo guardada a medianoche UTC y comparada o mostrada en hora local). El validador vino copiado de la spec y nunca se ejercitó con "hoy", porque las pruebas de la UI de H2 usaron siempre fechas futuras.

**Impacto.** El default del formulario falla siempre, así que el camino normal de publicación está roto hasta que el usuario cambia la fecha. Tampoco se puede corregir una lista para que rija hoy mismo.

**Corrección propuesta (no aplicada).** Comparar fechas-solo como fechas: normalizar las dos al día calendario en UTC, o parsear `YYYY-MM-DD` contra la fecha local de hoy. En el formulario, derivar "hoy" de la fecha local, no de `toISOString()`. Se descarta mover el guardado a hora local, porque cambiaría la semántica de `fecha_inicio_vigencia` que ya usan H3, H7 y H8.

### A2 — Una entrega el mismo día comprometido se penaliza como atraso (HU-H5)

**Síntoma.** OC-2026-000004 tenía entrega comprometida el 26/09/2026 y se recibió el 26/09/2026 a las 15:12 (hora local). `EvaluacionProveedor.puntaje_cumplimiento_plazos = 95`, cuando debería ser 100. Son 5 puntos: exactamente `PENALIZACION_POR_DIA_ATRASO` por 1 día.

**Causa raíz** (`evaluacion.calculo.ts:43-44`):
```ts
const diffMs = fechaRecepcion.getTime() - fechaEntregaComprometida.getTime();
const diasAtraso = Math.max(0, Math.round(diffMs / MS_POR_DIA));
```
`fecha_entrega_comprometida` es una fecha-solo guardada a `00:00Z`, pero `fecha_recepcion` es un **instante** (`18:12Z`). La diferencia es de 18 h, y `Math.round(0.75) = 1`. Cualquier recepción hecha el día comprometido después de las 12:00Z (09:00 hora local) cuenta como un día tarde. Con la misma lógica, una recepción a las 11:59Z del día siguiente cuenta como a tiempo.

**Impacto.** El puntaje de plazos, y con él `puntaje_total`, se deforma contra proveedores que cumplen. Como el puntaje total decide la suspensión automática (umbral 60, `evaluacion.constants.ts`), el error puede empujar a un proveedor hacia una suspensión que no corresponde. Es la regla de negocio central de HU-H5.

**Corrección propuesta (no aplicada).** Calcular el atraso en días calendario: truncar `fecha_recepcion` a su fecha (en la zona de negocio) y restar fechas enteras, sin redondear horas. Se descarta cambiar `Math.round` por `Math.floor` o `Math.ceil`, porque solo corre el error de lugar (`floor` perdona atrasos de hasta 23 h, `ceil` penaliza igual el mismo día). Agregar el caso "mismo día, por la tarde" a los tests de `evaluacion.calculo`.

### A3 — Una versión parcial deja sin precio a las variantes que no incluye (HU-H2 ↔ HU-H3)

**Síntoma (caso probado).** La versión pendiente del seed (1 ítem, Camisa M/Verde) se aprobó y pasó a vigente para InduSur. Después, al crear una OC a InduSur por la Camisa L/Negro, que **sí** tenía precio en la versión anterior, la UI responde *"Estas variantes no tienen precio en la lista vigente del proveedor"*. El mismo efecto aparece en el preview de H2, que marca esas variantes "sin precio previo".

**Causa raíz.** Dos decisiones correctas por separado que, juntas, producen un resultado que ninguna HU documenta:

1. **Vigencia por versión completa.** `obtenerVersionVigente()` (`lista-precios.service.ts`) toma **una** versión por proveedor: la última publicada con fecha ≤ hoy. El paso 4 de `resolverContextoPrecios` (`orden-compra.service.ts:216-235`) busca el ítem **solo dentro de esa versión**, sin caer a una anterior. El diseño es deliberado y es consistente con H7 y H8.
2. **La UI de H2 deja publicar versiones con cualquier subconjunto de variantes**, arrancando con el formulario vacío y sin avisar que las variantes omitidas pierden su precio.

**Impacto.** Una actualización de precio de un solo producto (el caso más común) deja al proveedor sin poder recibir OC por el resto de su catálogo, hasta que alguien republique la lista completa. El seed actual reproduce el problema en la demo.

**Decisión necesaria del PO (no es una corrección técnica unilateral).** ¿Una "nueva versión" es la lista **completa** del proveedor, o un **delta** sobre la vigente?
- **Si es completa:** conviene precargar el formulario con los ítems vigentes y advertir antes de publicar si se quitan variantes. El backend no cambia.
- **Si es un delta:** la resolución de precio tiene que pasar a ser por variante (la última versión vigente **que contenga** esa variante) en `obtenerVersionVigente`, y eso cambia H3, H7 y H8 a la vez.

### B1–B5 — Documentación desactualizada

- **B1 (HU3_MODULO_H.md, líneas 142-156, 618-654 y tabla de CA1).** Describe la interacción con H4 como `CONFIRMADA → RECEPCION_PARCIAL → RECIBIDA_COMPLETA` y cita `recepcion-reglas.ts:15-22`. HU3 se tocó por última vez en `ca333c4` (2026-09-08). Un día después, H4 V2.1 (`799ad6b`, PR #128) eliminó la recepción parcial: `recepcion.service.ts:191` fija `RECIBIDA_COMPLETA` y `:168` rechaza toda OC que no esté `CONFIRMADA`. `HU4_MODULO_H.md` sí refleja V2.1, así que los dos documentos se contradicen.
- **B2 (`event-types.ts:344-353`).** `RecepcionRegistradaPayload` todavía tipa `estado_nuevo_oc: "RECEPCION_PARCIAL" | "RECIBIDA_COMPLETA"`. Es un residuo de tipos: nunca se produce, pero sugiere un flujo que no existe.
- **B3 (`schema.prisma:956-962`).** El comentario del modelo `Recepcion` dice que puede haber varias por OC para recepción parcial. Hoy hay como máximo una.
- **B4 (HU3 §5.4 / §8.3).** Siguen describiendo el "Camino A" (precio desde el seed porque H2 no existía). H3 ya delega en `resolverListaPrecioVigente()` (`orden-compra.service.ts:149-151`), y cualquier proveedor homologado puede tener lista publicada.
- **B5 (HU9 §2.7).** Lista como pendiente la pantalla de Cuentas por Pagar, que ya existe (`src/app/(dashboard)/tesoreria/cuentas-por-pagar/page.tsx`). No le correspondía a H9 actualizarlo, pero el documento induce a error.

**Corrección propuesta:** una adenda con fecha en HU3 y en HU9, que apunte a los commits y archivos citados, y la limpieza del tipo (B2) y del comentario del schema (B3).

### C1–C7 — Interfaz

- **C1.** `compras/ordenes/[id]/page.tsx` y `compras/recepciones/nueva/page.tsx` no exportan `metadata`, así que la pestaña muestra el título por defecto de Next ("Create Next App"). Las demás pantallas del módulo sí lo definen (por ejemplo `compras/ordenes/page.tsx:41`).
- **C2.** Texto de organización interna del proyecto visible al usuario final: *"El cambio queda registrado en la auditoría (Módulo D)"* (`DialogHomologar.tsx:112`, `DialogVolverPendiente.tsx:122`) y *"Leído del ledger de auditoría (Módulo D)."* (`ordenes/[id]/page.tsx:477`). Es la misma clase que el Bug 3 de la UI de HU-H2.
- **C3.** `compras/ordenes/page.tsx:125-131` renderiza el link "Nueva orden de compra" sin chequear `ordenes_compra:crear`. El Auditor (solo lectura) lo ve, y al hacer clic recibe "Acceso Denegado". El gate del servidor funciona; el problema es solo de la interfaz.
- **C4.** El ítem "Proveedores" del sidebar (`Sidebar.tsx:129-132`) no tiene `permiso`, así que se muestra a todo usuario autenticado. El Encargado de Depósito lo ve y recibe "Acceso Denegado" (`proveedores:leer`). El comentario *"Gate por ordenes_compra:leer"* que está encima corresponde al ítem siguiente.
- **C5.** `recepciones/nueva/page.tsx:66-67`: "Volver a órdenes" apunta a `/compras/ordenes`, pero el Encargado de Depósito, único rol operativo de esta pantalla junto con el Administrador, no tiene `ordenes_compra:leer`.
- **C6. Clic perdido antes de la hidratación.** Los botones se renderizan habilitados en el HTML del servidor, antes de que React adjunte los handlers. Un clic en esa ventana no hace nada y no da feedback: en el log no aparece ninguna invocación de Server Action y el estado no cambia. Se observó en "Aprobar" (H2, 2026-09-26) y en "Ingresar" (login, 2026-09-25). Un segundo clic funciona. Es transversal (patrón de Client Components); no está limitado a Módulo H.
- **C7.** El Auditor tiene `proveedores:leer`, y `GET /api/proveedores/[id]/lista-precios` le devuelve 200. Pero la pantalla `/compras/listas-precios` se gatea con `proveedores:publicar_lista`, así que no tiene forma visual de consultar el historial ni la comparativa. **A confirmar con la matriz de roles del Alcance** si el Auditor debe leer listas de precios. Si debe, falta un gate de lectura para la página. Si no, el `GET` de historial está abierto de más.

---

## 3. Riesgos ya documentados (d) — estado actual

| # | Origen | Riesgo | Estado hoy |
|---|---|---|---|
| D1 | HU2 (hallazgo fuera de alcance + Bug 4) | Precisión de `number` en payloads `jsonb` del ledger (Módulo D) | **Sigue abierto** en Módulo D. Mitigado en H2 (`redondearPorcentaje`). Inventario: ningún evento de H1/H3/H4/H5/H9 persiste `number` no entero; H3 serializa precios como string (`orden-compra.service.ts:314, 606-611`), H5 interpola el puntaje en un string (`evaluacion.service.ts:199`), H9 usa `toFixed(2)` (`comprobante-proveedor.service.ts:287`). Riesgo latente de patrón, no activo |
| D2 | HU1 | CUIT de un proveedor dado de baja no se puede reutilizar (`schema.prisma:712`, índice único total) | Vigente |
| D3 | HU1 | El alta no guarda quién creó el proveedor (`Proveedor` sin `creada_por_id`) | Vigente |
| D4 | HU1 | Emisión de eventos fire-and-forget post-commit (sin outbox) | Vigente |
| D5 | HU3 §9.1 | Sin tests de `orden-compra.service.ts` | Vigente |
| D6 | HU3 §9.2 | El evento `stock:recepcion_confirmada` de la spec no existe (H4 escribe stock directo) | Vigente (decisión de diseño de H4) |
| D7 | HU3 §9.3 | TODO obsoleto en `orden-compra.service.ts:65` | Vigente |
| D8 | HU3 §9.4 | `estaEntregaVencida()` compara en UTC (ventana de 3 h) | Vigente. **Misma clase que A1 y A2**: conviene resolverlas juntas |
| D9 | HU3 §9.5 | Gate de lectura con `ordenes_compra:crear` | **Resuelto** (`ordenes_compra:leer` en uso) |
| D10 | HU3 §9.6 | Edición de ítems autorizada con permiso de crear | Vigente |
| D11 | HU3 §9.7 | Formato de `numero_orden` inconsistente (seed de 4 dígitos, generador de 6) | Vigente y **ampliado**: hoy son 3 OC del seed con formato corto (`seed.ts:2374,2500,2533`); se ve en la UI de recepción (`OC-2026-0003` junto a `OC-2026-000004`) |
| D12 | HU3 §6.2/§6.3 | Bifurcación de la cadena SHA-256 por concurrencia | **Resuelto**, `colaLedger` vigente (`audit-log.service.ts:104,121-128`) |
| D13 | HU5 | Handler de auditoría pendiente para `proveedor:estado_cambiado` | **Resuelto** (`audit-log.listener.ts:542-556`) |
| D14 | HU9 §2.7 | La `CuentaPorPagar` pasa a DEFINITIVA recién al cerrar la OC | Vigente (`cuenta-por-pagar.listener.ts:62-68`); comprobado en el caso punta a punta |
| D15 | HU2 | Umbral crítico del 20% como constante no validada por el PO | Vigente |

---

## 4. Recomendación priorizada

**Corregir antes de dar el módulo por cerrado:**

1. **A1 (fecha "desde hoy" en H2).** Rompe el camino por defecto de una HU cuya UI se entrega ahora. La corrección es chica y local (validador + default del formulario).
2. **A2 (puntaje de plazos en H5).** Calcula mal la regla central de la HU y puede disparar suspensiones indebidas. La corrección es una función pura con tests existentes para ampliar. Conviene resolver **A1, A2 y D8 juntas**: es la misma causa (fecha-solo contra instante u hora local), y un helper común de "día calendario de negocio" evita que vuelva a aparecer por cuarta vez.
3. **A3 (versión parcial).** Hace falta primero la decisión del PO (lista completa o delta). Si se elige "lista completa", el cambio es solo de UI (precargar ítems vigentes y advertir) y entra antes del cierre. Si se elige "delta", toca H3/H7/H8 y conviene tratarlo como HU propia; mientras tanto, el seed no debería dejar como demo una versión de 1 ítem.

**Puede quedar como hallazgo abierto documentado, con corrección barata en el mismo PR si hay lugar:**

- **B1–B5.** No afectan el comportamiento. Una adenda en HU3/HU9 y la limpieza de B2/B3 evitan que el próximo que lea el código o los docs saque conclusiones equivocadas.
- **C1–C5.** Son cosméticos o de navegación. El servidor ya bloquea todo acceso indebido (la matriz se verificó rol por rol), así que no hay exposición de datos.
- **C6.** Es transversal a todo el frontend, no propio de Módulo H. Conviene tratarlo como ticket de plataforma (deshabilitar acciones hasta la hidratación o usar formularios con progressive enhancement).
- **C7.** Depende de la matriz de roles; es una pregunta al PO, no un defecto confirmado.
- **D1** sigue siendo un ticket de Módulo D. Ninguna HU de H lo dispara hoy.
