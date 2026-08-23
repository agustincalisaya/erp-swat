# HU-7 — Configuración de Umbrales de Stock (Módulo A)

**Estado:** Implementado y verificado — incluida la fórmula de cálculo de sugerencia, confirmada con datos de fixture. Ver sección 1.7 para el detalle exacto de qué está confirmado, qué está fuera de alcance por depender de trabajo de otro integrante del equipo, y qué queda como limitación conocida.
**Metodología:** Specification-Driven Development (SDD) con Claude Code.
**Documentos fuente:** `RULES.md`, `spec_modulo_A.md`, `contexto_sprint_1.md`

---

# PARTE 1 — Referencia Técnica (estado actual, verificado).

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
| `/api/inventario/stock/umbrales` | `PATCH` | ✅ Implementado | Configuración válida (`200`, persistido en Postgres), violación de regla semántica (`400`), sin sesión (`401`), combinación inexistente (`404`) |
| `/api/inventario/stock/umbrales/sugerencia` | `POST` | ✅ Implementado | Caso sin histórico (`null`/`null` + warning) y caso con histórico (datos de fixture) ambos verificados |

Ambos endpoints delegan en `actualizarUmbrales()` y `calcularPromedioMovilEgresos()` de `stock.service.ts` — sin lógica de negocio duplicada entre el Route Handler y el Server Action equivalente que consume el dashboard.

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

## 1.8. Ubicación de la UI

El formulario de configuración de umbrales vive en `inventario/depositos/`, no en `inventario/variantes/`. Justificación: `punto_pedido`/`stock_seguridad` son propiedades de la combinación variante+depósito, no de la variante en sí — la misma variante puede tener umbrales distintos en depósitos distintos. El rol dueño de la HU (Encargado de Depósito) opera pensando en términos de "mi depósito".

---

# PARTE 2 — Historial de Desarrollo (proceso SDD)

## 2.1. Contexto de la tarea original

Primera Historia de Usuario trabajada bajo esta metodología SDD en el proyecto, a partir de una fila de planificación (Módulo A, HU-7, Encargado de Depósito, 3 puntos de historia) que definía el criterio de aceptación en términos generales.

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
