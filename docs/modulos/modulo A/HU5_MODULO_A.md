# HU-A5 — Configuración de Umbrales de Stock + Consola de Depósito (Módulo A)

**Estado:** Implementado y verificado en dos etapas — Sprint 1 (configuración de umbrales, incluida la fórmula de cálculo de sugerencia, confirmada con datos de fixture) y Sprint 2 (ampliación: Consola de Depósito con tabla paginada/buscador, y modal de configuración de umbrales, ambos verificados en navegador real). Ver sección 1.7 para el detalle exacto de qué está confirmado, qué está fuera de alcance por depender de trabajo de otro integrante del equipo, y qué queda como limitación conocida.
**Metodología:** Specification-Driven Development (SDD) con Claude Code.
**Documentos fuente:** `RULES.md`, `spec_modulo_A.md`, `contexto_sprint_1.md`, `task_HU-A5-ampliacion.md`, `task_UI_modal_umbrales_deposito.md`

---

# PARTE 1 — Referencia Técnica (estado actual, verificado)

> Esta sección describe **cómo funciona la funcionalidad hoy**, confirmado con pruebas reales (Postman + Prisma Studio + navegador headless), no solo por lectura de código. Para el proceso de cómo se llegó a este estado, ver la Parte 2 — Historial de Desarrollo.

## 1.1. Alcance funcional

**Actor:** Encargado de Depósito.

**Objetivo:** configurar `punto_pedido` (umbral de alerta temprana) y `stock_seguridad` (piso crítico) para una combinación específica `VarianteSKU` + `Deposito`, con dos capacidades adicionales:

1. Cálculo dinámico **opcional** de umbrales sugeridos, basado en el promedio móvil de egresos de los últimos N meses.
2. Alerta en tiempo real (evento de dominio) cuando un movimiento de stock deja la cantidad en o por debajo del `punto_pedido` configurado.

## 1.2. Semántica de dominio

```
stock_seguridad (piso crítico, nunca debería tocarse)
        <
punto_pedido (umbral de alerta temprana — dispara la reposición)
        <
stock_actual (situación ideal)
```

`punto_pedido` debe ser mayor o igual a `stock_seguridad`. Verificado con `.refine()` en el schema Zod correspondiente, con validación tanto server-side como client-side (react-hook-form) en el formulario del dashboard.

## 1.3. Modelo de datos

Sin migraciones — la entidad objetivo, `StockDeposito`, ya contaba con los campos `punto_pedido` (Int) y `stock_seguridad` (Int) desde el schema de Sprint 1.

## 1.4. Endpoints implementados y verificados

| Endpoint | Método | Estado | Verificación |
|---|---|---|---|
| `/api/inventario/stock/umbrales` | `PATCH` | ✅ Implementado | Configuración válida (`200`, persistido en Postgres), violación de regla semántica (`400`, tanto en creación como en actualización), sin sesión (`401`) |
| `/api/inventario/stock/umbrales/sugerencia` | `POST` | ✅ Implementado | Caso sin histórico (`null`/`null` + warning) y caso con histórico (datos de fixture) ambos verificados |

Ambos endpoints delegan en `actualizarUmbrales()` y `calcularPromedioMovilEgresos()` de `stock.service.ts` — sin lógica de negocio duplicada entre el Route Handler y el Server Action equivalente que consume el dashboard.

**Cambio de comportamiento (posterior a la verificación inicial):** `actualizarUmbrales()` originalmente rechazaba con `404 STOCK_DEPOSITO_NO_ENCONTRADO` cualquier combinación variante/depósito sin `StockDeposito` previo. Reemplazado por un `upsert` sobre la clave compuesta `[variante_sku_id, deposito_id]` (mismo patrón que `registrarIngresoStock()`), habilitando configurar umbrales de forma anticipada para variantes que todavía no tienen stock físico cargado — caso de uso de negocio explícito (planificar reposición antes de que llegue mercadería nueva). La rama de creación (`create`) inicializa `cantidad: 0` y toma `punto_pedido`/`stock_seguridad` del input recibido, no de un default vacío — verificado en runtime que el primer guardado de una combinación nueva persiste los umbrales reales, no ceros.

## 1.5. Fuente de datos para el cálculo dinámico

El promedio móvil se calcula sobre `MovimientoStock`, filtrando:
- `tipo_movimiento IN (EGRESO, TRANSFERENCIA)`
- `deposito_origen_id = deposito_id`
- `created_at >= fechaLimite` (calculada en TypeScript antes del query)
- `is_active = true`

**Fórmula confirmada correcta con datos de fixture** (ver 2.7 para el detalle del proceso): con 3 movimientos de `EGRESO` de 10, 15 y 5 unidades distribuidos en 3 meses, el endpoint devolvió `promedio_egreso_mensual: 10`, `punto_pedido_sugerido: 5` (`ceil(10 × 0.5)`), `stock_seguridad_sugerido: 3` (`ceil(10 × 0.25)`) — coincidiendo exactamente con el cálculo esperado a mano.

**Limitación conocida:** `movimiento.service.ts` implementa únicamente `registrarIngresoStock()` — no existe `registrarEgresoStock()` ni `registrarTransferenciaStock()`. En consecuencia, si bien la **fórmula de cálculo está verificada como correcta**, la **integración end-to-end con el flujo real de negocio no puede confirmarse todavía**, porque no hay ningún camino del sistema que genere estos movimientos de forma orgánica — los datos usados para la verificación fueron insertados directamente por SQL como fixture de prueba, no generados por un flujo real.

## 1.6. Alerta automática al cruzar el umbral — no conectada, pendiente de coordinación de equipo

`decrementarStockConAlerta()` en `stock.service.ts` está completamente implementada: decremento atómico condicionado + comparación de `cantidad_resultante` contra `punto_pedido` + emisión del evento `stock:umbral_critico_alcanzado` fuera de la transacción. **Sin embargo, no tiene ningún caller en el proyecto.**

El único flujo que decrementa stock real hoy (`legajo-prueba.service.ts`, propiedad de otro integrante del equipo) lo hace con su propio `updateMany` inline, sin pasar por esta función — por lo tanto, **la alerta de umbral crítico nunca se dispara en la práctica actualmente**, a pesar de que la lógica para emitirla está completa y correcta.

Adicionalmente, `event-types.ts` define el evento `stock:umbral_critico_alcanzado`, pero no existe ningún listener suscripto a él en todo el proyecto — mismo patrón que se detectó y corrigió en el Módulo D con los eventos de usuario (ver `MODULO_D.md`, sección 2.4), pero aquí todavía sin resolver.

**Esta pieza requiere coordinación explícita con el compañero de equipo dueño de `legajo-prueba.service.ts` antes de conectarse** — no se resuelve unilateralmente, porque implica modificar código de otra Historia de Usuario ya asignada.

## 1.7. Resumen de verificación

| Pieza | Estado |
|---|---|
| Configuración manual de umbrales (validación, persistencia, permisos) | ✅ Verificado en runtime |
| Cálculo de sugerencia — caso sin histórico | ✅ Verificado en runtime |
| Cálculo de sugerencia — fórmula matemática (con datos de fixture) | ✅ Verificado en runtime |
| Cálculo de sugerencia — integración con flujo real de EGRESO/TRANSFERENCIA | ⛔ No verificable actualmente (bloqueado por ausencia de esos flujos en `movimiento.service.ts`) |
| Alerta automática al cruzar umbral | ⛔ Lógica completa pero desconectada — requiere coordinación de equipo, fuera de este alcance |
| UI de configuración desde el dashboard | ✅ Verificado con navegador real (sesión auténtica, sin mocks) |
| Selector jerárquico Depósito → Producto → Variante | ✅ Verificado en navegador real (Chrome), 7/7 casos del plan de prueba, incluida creación de `StockDeposito` con umbrales reales (no ceros) para combinaciones sin stock previo |
| Consola de Depósito — endpoint paginado + buscador (Sprint 2) | ✅ Verificado en runtime, ver 1.10.1 |
| Componente compartido `TablaFiltroPaginada` (Sprint 2) | ✅ Construido, montado y verificado en esta HU, ver 1.10.2 |
| Modal de configuración de umbrales, ambas entradas (Sprint 2) | ✅ Verificado en navegador real, ver 1.10.3 |

## 1.8. Ubicación de la UI

El formulario de configuración de umbrales vive en `inventario/depositos/`, no en `inventario/variantes/`. Justificación: `punto_pedido`/`stock_seguridad` son propiedades de la combinación variante+depósito, no de la variante en sí — la misma variante puede tener umbrales distintos en depósitos distintos. El rol dueño de la HU (Encargado de Depósito) opera pensando en términos de "mi depósito".

**Actualización Sprint 2 (ver 1.10.3):** dentro de esa misma ruta, el formulario dejó de estar fijo en pantalla y pasó a vivir en un modal, con la Consola de Depósito (tabla) como contenido principal visible por defecto. La justificación de ubicación de ruta no cambia — solo cambió la disposición visual dentro de ella.

## 1.9. Selector jerárquico Depósito → Producto → Variante

Ampliación posterior a la verificación inicial: el formulario ya no opera sobre una combinación fija — un componente cliente (`SelectorJerarquicoStock`) resuelve una cascada de 3 niveles antes de habilitar el formulario de umbrales.

**Orden de selección:** Depósito → Producto Maestro → Variante — decisión de negocio explícita, priorizando la unidad mental de trabajo del Encargado de Depósito ("mi depósito") sobre el catálogo completo de la empresa.

**Alcance de cada nivel:**
- Depósito: lista depósitos activos.
- Producto Maestro: lista todos los productos activos con al menos una variante — sin filtrar por si ya tienen stock en el depósito elegido.
- Variante: lista todas las variantes activas del producto elegido — tampoco filtrado por `StockDeposito` existente. Decisión de negocio confirmada: permite configurar umbrales de reposición antes de que llegue mercadería nueva.

Cambiar la selección de un nivel resetea automáticamente los niveles posteriores (verificado: cambiar el depósito con producto y variante ya elegidos hace desaparecer el formulario, no deja una selección obsoleta visible).

**Doble validación de la regla semántica** (`punto_pedido >= stock_seguridad`): verificado tanto client-side (react-hook-form, bloquea antes del submit) como server-side (rechazo real del endpoint REST vía fetch directo, esquivando la UI) — el backend nunca crea una fila espuria aunque se evada la validación del formulario.

## 1.10. Consola de Depósito y modal de configuración de umbrales (ampliación, Sprint 2)

Ampliación de la HU-A5 original, confirmada por Product Backlog Consolidado y Sprint 2 planning sheet. Cubre dos entregables construidos en secuencia: primero una tabla de consulta paginada por depósito, luego una reestructuración de UI que mueve la configuración de umbrales a un modal.

**Objetivo funcional:** permitir al Encargado de Depósito ubicar rápidamente cualquier producto dentro de un depósito específico (buscador + paginación), y configurar umbrales sin que el formulario compita permanentemente por espacio en pantalla con la tabla de consulta.

### 1.10.1. Endpoint de consulta paginada

| Endpoint | Método | Estado | Verificación |
|---|---|---|---|
| `/api/inventario/depositos/[id]/productos` | `GET` | ✅ Implementado | Filtro por texto libre (SKU y nombre, `ILIKE`/`insensitive`), paginación server-side (tope 20/vista), metadatos de paginación completos |

Lógica de negocio en `listarProductosPorDeposito()` (`stock.service.ts`), Route Handler como capa delgada (Zod → service → `{ data, error }`). Filtra `is_active: true` en `StockDeposito` y en `variante_sku` (Regla N.° 1, soft delete). Sin `$transaction` ni eventos de dominio — operación de solo lectura.

**Contrato de respuesta:**
```json
{
  "items": [ /* ProductoPorDepositoItem[] */ ],
  "paginacion": { "total": 137, "pagina_actual": 1, "total_paginas": 7, "por_pagina": 20 }
}
```

Contrato estable por diseño: es el mismo shape que consumirá HU-A11 (historial de movimientos) desde el componente compartido descrito en 1.10.2 — coordinado explícitamente entre ambos responsables antes de implementar, para evitar dos implementaciones divergentes del mismo patrón de tabla/filtro/paginación.

### 1.10.2. Componente compartido `TablaFiltroPaginada`

Componente genérico (`<T>`), sin conocimiento de ningún endpoint específico — recibe columnas y función de fetch (`cargarPagina`) inyectadas por props. Resuelve, de forma reutilizable entre HU-A5 y HU-A11: debounce del buscador (350ms), paginación dibujada solo con los metadatos ya incluidos en la respuesta (sin segunda request de tipo `COUNT`), guarda contra respuestas obsoletas por `requestId`, y `revalidarCuando?` para forzar recarga desde página 1 cuando cambia una dependencia externa.

Montado en esta HU dentro de `ConsolaDepositoProductos.tsx`, que resuelve la selección de depósito y arma el `cargarPagina` específico contra `GET /api/inventario/depositos/[id]/productos`.

### 1.10.3. Modal de configuración de umbrales

Reestructuración de UI posterior: el formulario de umbrales (`FormularioUmbralesStock` + `SelectorJerarquicoStock`), antes fijo en la parte superior de la pantalla, pasa a vivir dentro de un modal (`ModalConfigurarUmbrales`, sobre `Dialog` sin componente base de UI existente) con fondo desenfocado. La Consola de Depósito pasa a ser el contenido visible por defecto de la pantalla.

**Dos puntos de entrada al modal:**
- Botón "Configurar umbrales" en la cabecera → cascada vacía (Depósito → Producto Maestro → Variante), mismo flujo que 1.9.
- Acción de edición por fila en la tabla → modal precargado con esa variante puntual, sin pasar por la cascada manual.

Ambas entradas convergen en el mismo `FormularioUmbralesStock`, con el mismo patrón de `key` ya usado en 1.9 para forzar remount entre combinaciones — no existen dos implementaciones de formulario, solo dos formas de inicializarlo.

Tras un guardado exitoso, la tabla se revalida automáticamente (contador de revalidación incluido en `revalidarCuando`) sin recarga manual de página. **Limitación conocida, documentada en código:** la revalidación reinicia la paginación a la página 1 — no se extendió `TablaFiltroPaginada` para preservar la página actual, por decisión explícita de no reescribir su lógica interna ya validada por HU-A5 original.

**Verificación:** confirmada en navegador real — ambos puntos de entrada, cierre del modal por los tres caminos (botón "x", "Cancelar", guardado exitoso), y reflejo de los valores actualizados en la tabla tras guardar.

### 1.10.4. Resumen de verificación — ampliación Sprint 2

| Pieza | Estado |
|---|---|
| Endpoint de consulta paginada por depósito | ✅ Verificado — filtro server-side, paginación, tope 20 |
| Componente compartido `TablaFiltroPaginada` | ✅ Construido y montado en esta HU; consumo por HU-A11 pendiente de esa HU, no de esta |
| Modal de configuración de umbrales (ambas entradas) | ✅ Verificado en navegador real |
| Revalidación de la tabla tras guardado exitoso | ✅ Verificado, con limitación conocida (reinicia a página 1) |
| Filtros en cascada Depósito → Producto → Variante (dentro del modal) | ✅ Reutilizados sin cambios de 1.9 |

---

# PARTE 2 — Historial de Desarrollo (proceso SDD)

## 2.1. Contexto de la tarea original

Primera Historia de Usuario trabajada bajo esta metodología SDD en el proyecto, a partir de una fila de planificación (Módulo A, HU-5, Encargado de Depósito, 3 puntos de historia) que definía el criterio de aceptación en términos generales.

## 2.2. Ambigüedades identificadas y resueltas en la especificación original

- **Semántica de umbrales:** definida y documentada explícitamente (`stock_seguridad < punto_pedido < stock_actual`) antes de escribir el contrato Zod.
- **Alcance real más amplio que el aparente:** se identificó que el criterio de aceptación de la alerta en tiempo real requería modificar el flujo de decremento de stock existente, no solo crear un endpoint de configuración — marcado explícitamente como "impacto cruzado" en la especificación original.
- **Cálculo de fechas relativas:** resuelto en TypeScript antes del query (Prisma no soporta aritmética de intervalos en el `where`).
- **Retorno de la transacción, no evento dentro de ella:** definido explícitamente para no acoplar el commit de base de datos a la latencia de un listener.
- **Ubicación de la UI:** resuelta con justificación de negocio explícita, no preferencia arbitraria.

## 2.3. Pérdida de trazabilidad del documento de tarea original

El archivo `task_cali.md` de esta HU, que sirvió de base para la implementación original, **ya no existe en el repositorio** — excluido por `.gitignore` en `docs/tasks/`. El alcance real de la tarea tuvo que reconstruirse a partir de comentarios en el código (`stock.service.ts`, `event-types.ts`) que referencian secciones de ese documento. **Acción recomendada, pendiente:** revisar la política de `.gitignore` sobre `docs/tasks/` para no perder la trazabilidad entre especificación y código en tareas futuras — es la misma disciplina que sí se mantuvo consistentemente en el desarrollo del Módulo D.

## 2.4. Relevamiento de estado real (previo a esta verificación)

Antes de iniciar la verificación formal de esta HU, un intento de prueba directo (`PATCH /api/inventario/stock/umbrales`) devolvió `404`. En vez de asumir un bug puntual, se realizó un relevamiento completo de todo Módulo A (Route Handlers y Services), revelando:

- 6 Route Handlers de Módulo A son stubs idénticos (158 bytes, `501 En construcción`), incluyendo lo que aparentaba ser el endpoint de configuración manual de umbrales.
- `producto.service.ts` y `variante.service.ts` están completamente vacíos.
- La funcionalidad de configuración manual de umbrales **sí existía**, pero únicamente accesible vía Server Action desde el dashboard — el Route Handler REST especificado originalmente nunca se había construido.
- `decrementarStockConAlerta()` existía completa pero sin ningún caller — la alerta de umbral crítico, a pesar de tener la lógica lista, nunca se ejecutaba en la práctica.

Este relevamiento evitó continuar un plan de prueba a ciegas contra piezas que en algunos casos no existían y en otros existían por un camino distinto al esperado.

## 2.5. Corrección de alcance acotado — endpoint REST faltante

Con el alcance de trabajo restringido explícitamente a evitar tocar `movimiento.service.ts`, `legajo-prueba.service.ts` y `event-types.ts` (código de otra Historia de Usuario en desarrollo por un compañero de equipo), se completó únicamente el `Route Handler` REST faltante de configuración manual de umbrales, delegando en la lógica de servicio ya existente y probada (`actualizarUmbrales()`).

Como parte de esta corrección, se detectó y removió un mock de desarrollo (`USUARIO_ID_MOCK`, un UUID hardcodeado) que el Server Action del dashboard usaba en lugar de la sesión real — reemplazado por `getServerSession()`, ya disponible desde el trabajo del Módulo D. La decisión se tomó por consistencia (evitar un mock activo al lado de un endpoint nuevo que sí resuelve sesión real para la misma operación), confirmada explícitamente como no requerida técnicamente para el funcionamiento del endpoint REST en sí.

**Nota de proceso:** la verificación inicial de este cambio en la UI se reportó como completa sin haber sido efectivamente ejecutada — corregido antes de continuar, con prueba real posterior vía navegador headless, confirmando el flujo completo con sesión auténtica.

## 2.6. Verificación de la fórmula de cálculo con datos de fixture

Ante la imposibilidad de generar movimientos `EGRESO`/`TRANSFERENCIA` reales (función inexistente en `movimiento.service.ts`), se evaluaron dos caminos: insertar movimientos de prueba directamente por SQL, o documentar el caso como no verificable. Se optó por insertar datos de fixture, con el objetivo explícito y acotado de confirmar que la fórmula matemática de `calcularPromedioMovilEgresos()` está correctamente implementada — sin pretender que esto verifica la integración end-to-end con un flujo de negocio real, que depende de trabajo de otro integrante del equipo.

**Procedimiento:** se insertaron 3 filas de `MovimientoStock` tipo `EGRESO` (10, 15 y 5 unidades, distribuidas en los últimos 3 meses calendario) para una combinación `VarianteSKU`/`Deposito` de prueba, vía `INSERT` directo en PostgreSQL — no a través del cliente de Prisma ni de ningún flujo de la aplicación.

**Resultado:** el cálculo esperado a mano (`promedio_egreso_mensual: 10`, `punto_pedido_sugerido: 5`, `stock_seguridad_sugerido: 3`) coincidió exactamente con la respuesta real del endpoint. La fórmula de cálculo queda confirmada como correcta. Los movimientos de fixture fueron eliminados de la base al finalizar la verificación, para no dejar datos ficticios en `movimientos_stock` que pudieran confundir a otros integrantes del equipo al inspeccionar la tabla.

**Alcance explícito de esta verificación:** confirma la corrección matemática de la fórmula. No confirma la integración con el flujo real de egreso de stock, que aún no existe en el código y es responsabilidad de otra Historia de Usuario.

## 2.7. Selector jerárquico Depósito → Producto → Variante

Ampliación posterior, motivada por una limitación real de la UI original: el formulario de umbrales solo operaba sobre una única combinación fija (`VARIANTE_SKU_ID_MOCK`/`DEPOSITO_ID_MOCK` hardcodeados desde la implementación inicial), sin ninguna forma de elegir sobre qué unidad de stock configurar.

**Decisión de negocio resuelta antes de implementar:** el orden de selección (Depósito → Producto → Variante) y el alcance del listado de Variantes (todas, no solo las que ya tienen `StockDeposito`) se confirmaron explícitamente antes de escribir código — priorizando el caso de uso de configurar umbrales de forma anticipada, antes de que llegue mercadería nueva al depósito.

**Cambio de comportamiento no anticipado en el alcance original, pero necesario:** permitir seleccionar variantes sin `StockDeposito` previo implicaba que el endpoint de guardado, que hasta entonces rechazaba esas combinaciones con `404`, tenía que pasar a crear la fila faltante. Se resolvió reemplazando la lectura-y-falla por un `upsert`, reutilizando el mismo patrón ya usado en `registrarIngresoStock()` — decisión de reutilizar arquitectura existente en vez de introducir un mecanismo nuevo para el mismo problema.

**Hallazgo adicional durante el relevamiento previo a esta tarea:** se confirmó que `depositos/page.tsx` nunca había tenido fetch real de valores — los props `punto_pedido_actual`/`stock_seguridad_actual` eran constantes hardcodeadas (`10`/`5`) desde la implementación original de la HU, nunca conectadas a datos reales. Esta ampliación fue la primera vez que ese fetch se implementó de verdad.

**Verificación:** ejecutada en navegador real (Chrome, tras instalación específica para esta tarea), 7 de 7 casos del plan de prueba, incluyendo confirmación directa en Postgres de que el primer guardado de una combinación sin stock previo persiste los umbrales reales ingresados por el usuario, no valores en cero — y doble verificación de la validación semántica (client-side vía formulario, y server-side vía fetch directo al endpoint, esquivando la UI).

## 2.8. Corrección de UX — chip de confirmación de variante

Verificando el selector jerárquico en navegador real, se detectaron dos problemas relacionados: el `<select>` nativo de Variante truncaba visualmente el texto de opciones largas (ej. "38 · Negro · Femenino (" sin cerrar el paréntesis del SKU), y la sección de guardado (`Umbrales de reposición`) no mostraba ningún indicio de *cuál* variante específica se estaba configurando — solo el Producto Maestro y el Depósito, sin talle/color/género — dejando al usuario sin forma de confirmar visualmente su elección antes de guardar.

**Corrección:** se agregó un tercer chip junto a los dos existentes, mostrando el detalle completo de la variante elegida (`Talle {talle} · {color} · {genero}`, mismo separador ya usado por `etiquetaVariante()` en el propio componente, sin duplicar estilo). Se decidió explícitamente no incluir `modelo` en este chip — a diferencia del `<select>`, cuyo propósito es diferenciar entre opciones de una lista, el chip cumple una función distinta (confirmar la elección ya hecha), para la cual talle/color/género ya son suficientes.

Esta corrección resuelve el problema de fondo (falta de confirmación visual) sin necesidad de reemplazar el `<select>` nativo por un componente de UI más complejo.

## 2.9. Conflicto de merge con trabajo paralelo de otro integrante (HU-A6)

Al integrar esta rama con `develop`, se detectó un conflicto de merge real (no un error de código) en `variante.service.ts`: el archivo estaba completamente vacío al momento de iniciar esta tarea, y dos integrantes del equipo lo completaron de forma independiente y simultánea con contenido distinto — `listarVariantesPorProducto()` (esta HU) y `usuarioPuedeBajarVariante()`/`darDeBajaVariante()` (HU-A6, baja lógica de variantes, de otro integrante).

**Resolución:** se fusionó el archivo para que ambas funciones coexistan, deduplicando los `import` compartidos (`server-only`, cliente de Prisma) sin modificar el contenido ni los comentarios de ninguna de las dos funciones originales. Verificado que el archivo resultante compila sin errores (`tsc --noEmit`) y no contiene marcadores de conflicto residuales.

**Hallazgo colateral durante este proceso, no relacionado a HU-5:** al traer los cambios de `develop`, se detectó que el mismo integrante de HU-A6 había reintroducido código relacionado a la funcionalidad "Stock En Prueba" (`lib/crypto/aes.ts`, entre otros archivos de una nueva auditoría de inventario con datos cifrados), construido sobre una versión del Product Backlog anterior a su corrección — la funcionalidad había sido cancelada por el Product Owner y eliminada del código en una tarea previa (ver `MODULO_D.md`, hallazgo de Sprint Review). Se coordinó directamente con ese integrante, quien confirmó que se encargará de esa limpieza en su propio trabajo; esos archivos no fueron tocados como parte de esta tarea, mergeados tal como llegaron de `develop`, sin intervención.

## 2.10. Ampliación Sprint 2 — relevamiento previo y desalineamientos de nombres con la spec

Antes de implementar la Consola de Depósito, se ejecutó un relevamiento obligatorio del estado real del repositorio (paso exigido explícitamente por `task_HU-A5-ampliacion.md`, sección 5), en lugar de asumir que la spec `spec_modulo_A.md` §2.6 describía nombres y rutas ya existentes en el código. Resultado: la base de Sprint 1 estaba entregada y funcional, pero bajo nombres distintos a los que la spec documentaba.

| La spec/task asumía | Estado real en el repo |
|---|---|
| `PATCH /api/inventario/stock-depositos/[id]/umbrales` | `PATCH /api/inventario/stock/umbrales` (body con `variante_sku_id` + `deposito_id`, no `[id]`) |
| Server Action `actualizarUmbralesStockDeposito()` | `actualizarUmbrales(formData)` en `depositos/actions.ts` |
| Evento `stock:umbrales_actualizados` con `valor_anterior`/`valor_nuevo` | `stock:umbrales_configurados`, sin esos campos en el payload |
| `withPermission(...)` | `withAuth` (Módulo A no tenía, a esa fecha, ningún permiso `inventario:*` wireado a un Route Handler) |

**Decisión tomada:** no renombrar ni mover nada de Sprint 1 — se trató como el entregable ya testeado (`TC-A5-02`) y se construyó lo nuevo al lado. El desalineamiento entre nombres reales y spec queda documentado acá, no resuelto por esta ampliación.

**Filtros en cascada:** verificados como ya completos en `SelectorJerarquicoStock.tsx` (de `task_cali_selector_umbrales.md`) — el criterio de aceptación correspondiente del Backlog se cumplía de antes, sin cambios necesarios.

## 2.11. Construcción del componente compartido — coordinación con HU-A11

No existía en el repo ningún componente de tabla genérico/reutilizable — cada listado (`ListadoProductos`, `PaginadorVariantes`/`BuscadorFiltrosVariantes`, `HistorialTransferencias`) reimplementaba su propia paginación y búsqueda con columnas hardcodeadas. Se construyó `TablaFiltroPaginada.tsx` desde cero, tomando como referencia de servicio (no de componente) los precedentes de `listarVariantesPaginadas()` y `listarHistorialTransferencias()` para el patrón `contains` + `mode: "insensitive"` + `skip`/`take` + `count` con el mismo `where`.

**Decisión de equipo, previa a la implementación:** coordinado explícitamente con el responsable de HU-A11 (que reutiliza el mismo componente para el historial de movimientos) que HU-A5 genera el componente y HU-A11 únicamente lo consume, sin reimplementarlo por separado — evitando el escenario de que ambas HUs programen la misma tabla en paralelo sin saberlo.

**Divergencia de contrato aceptada conscientemente:** los servicios existentes (`listarVariantesPaginadas`, `listarHistorialTransferencias`) devuelven `{ registros|variantes, total, page, page_size }` con `PAGE_SIZE = 10`. El endpoint nuevo usa `{ items, paginacion: { total, pagina_actual, total_paginas, por_pagina } }` con tope 20, por ser el contrato que cruza con HU-A11. No se retrofiteó ningún servicio existente a este nuevo shape.

**Convención de ubicación y nombrado confirmada contra el repo real, no asumida:** `src/components/inventario/TablaFiltroPaginada.tsx`, PascalCase — siguiendo la convención dominante del directorio (`SelectorJerarquicoStock.tsx`, `FormularioUmbralesStock.tsx`), no el nombre en kebab-case originalmente sugerido en la task antes de verificar contra el código.

**RBAC — hallazgo no resuelto por esta ampliación:** no existe ningún permiso de lectura de inventario (`inventario:depositos:leer` u otro) en el seed. El endpoint nuevo usa `withAuth`, siguiendo el mismo precedente que el resto de los Route Handlers de consulta de Módulo A. Queda reportado como deuda técnica transversal de RBAC, no exclusiva de esta HU.

## 2.12. Reestructuración a modal — hallazgo bloqueante de secuencia y resolución

Al iniciar la task de UI/UX (`task_UI_modal_umbrales_deposito.md`), el relevamiento previo detectó que la premisa de la task ("HU-A5 ampliada ya mergeada") no era cierta contra `develop` en ese momento — el entregable de 2.10/2.11 vivía todavía en una rama feature sin mergear. Se optó por ramificar la nueva task a partir de esa rama feature (no de `develop`), para que ambas entregas confluyeran juntas — decisión revisada y corregida una vez que el merge de la ampliación (PR #93) se concretó, recreando la rama de esta task desde `develop` ya actualizado.

**Hallazgo de shape de datos, resuelto de forma aditiva:** para permitir que cada fila de la tabla abra el modal precargado con su propia variante (sin repetir la cascada manual), el item de la tabla necesitaba `variante_sku_id`, campo que no estaba expuesto en el contrato original de 2.11. Se agregó de forma estrictamente aditiva a `ProductoPorDepositoItem` — sin alterar el shape `{ items, paginacion }` ni ningún campo ya consumido por HU-A11.

**Extensión aditiva de `FormularioUmbralesStock`:** se agregó el prop opcional `onSuccess?: () => void` (mismo patrón ya usado por `ModalJustificacionBaja.onSuccess` en otro componente de dominio de Inventario), para que el contenedor del modal supiera cuándo cerrar y disparar la revalidación de la tabla. Evaluado explícitamente como extensión de interfaz pública, no como reescritura de la lógica interna del formulario — la restricción de "no reescribir" de la task apuntaba a esto último.

**Trade-off de revalidación, documentado y aceptado:** `TablaFiltroPaginada` solo expone `revalidarCuando?`, que siempre resetea a página 1 al disparar. Cumplir el requisito de "reflejar valores actualizados sin recarga manual" con este mecanismo implica perder la posición de paginación del usuario tras guardar un umbral. Se aceptó el trade-off en vez de extender la lógica interna del componente compartido — decisión tomada considerando que modificar `TablaFiltroPaginada` para este caso puntual introduciría acoplamiento no deseado con un consumidor específico (HU-A5), cuando el componente está pensado para ser agnóstico también de HU-A11.

## 2.13. Verificación en navegador real — ambas entradas del modal

Verificación ejecutada en navegador tras el build limpio (`tsc --noEmit`, `eslint`, `next build`, todos sin errores): apertura del modal desde el botón de cabecera con cascada vacía (Entrada A), apertura precargada desde una fila de la tabla (Entrada B), cierre por los tres caminos disponibles (botón "x", "Cancelar", guardado exitoso), y confirmación de que la tabla refleja los valores nuevos tras guardar — incluyendo el reinicio a página 1 documentado en 2.12.
