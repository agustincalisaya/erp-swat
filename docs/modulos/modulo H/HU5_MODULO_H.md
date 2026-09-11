# HU-H5 — Evaluación de Proveedores (Módulo H)

**Issue de GitHub:** #90 — "HU-H5: Evaluar Proveedores"
**Rama:** `feature/HU-H5-evaluacion-proveedores` (mergeada a `develop`, commit `c1cccab`)
**Sprint:** Sprint 2, Módulo H (Proveedores y Abastecimiento)
**Rol:** Supervisor de Compras

## Resumen

Se implementó el recálculo incremental del puntaje ponderado de evaluación de un proveedor, disparado por cada recepción de mercadería, junto con la suspensión automática del proveedor cuando el puntaje cae por debajo del umbral mínimo de homologación. La implementación es capa de servicios pura: no agrega Route Handlers ni Server Actions, ni interfaz de usuario. La función se invoca de forma directa desde el servicio de recepciones de HU-H4.

## Objetivo

Evaluar proveedores mediante un modelo ponderado por cumplimiento de plazos, calidad de recepción y documentación vigente, para mantener actualizada la calificación de la cartera de proveedores y proteger la continuidad del abastecimiento táctico.

## Alcance

**Implementado en este PR:**
- Recálculo incremental del puntaje ante cada recepción (nunca en batch).
- Registro histórico e inmutable de cada evaluación.
- Suspensión automática del proveedor cuando corresponde, dentro de la misma transacción que registra la evaluación.
- Emisión de un evento de dominio para que la suspensión quede trazada en auditoría.
- Historial de evaluaciones consultable por query directa (sin necesidad de UI).
- Devoluciones por defecto de fabricación como insumo manual opcional (Módulo I, que alimentaría esto automáticamente, no existe todavía en el proyecto).

**Fuera de alcance de este PR:**
- Panel de alertas de proveedores próximos a caer del umbral de homologación. Ningún documento de spec del proyecto define un contrato de endpoint para esta pantalla — solo se menciona sin especificación técnica en el documento de alcance funcional. Se priorizó cerrar la capa de servicios, que es la que bloqueaba a HU-H4, antes que construir una UI de lectura sin contrato definido. Si se confirma que entra en el sprint, es una iteración siguiente sobre esta misma base (el dato ya existe y es consultable).
- Cualquier interfaz de usuario.
- Handler de auditoría para el evento emitido (ver "Trabajo pendiente" más abajo).

## Modelo de datos

No se modificó `schema.prisma`. El modelo `EvaluacionProveedor` ya estaba migrado de un sprint anterior y no necesitó ningún campo nuevo — todas las reglas de negocio de esta HU se resolvieron en código de aplicación, no en el modelo de datos.

Cada `EvaluacionProveedor` es un registro nuevo e inmutable: nunca se actualiza uno existente. El puntaje vigente de un proveedor se resuelve por consulta a la evaluación más reciente (`fecha_evaluacion desc`), no hay ningún campo cacheado que mantener sincronizado — mismo criterio que ya usa el proyecto para la versión vigente de listas de precios.

## Reglas de negocio implementadas

Estas reglas de negocio no estaban definidas en ningún documento de spec del proyecto. El equipo de desarrollo las definió para poder avanzar, y quedaron centralizadas en `evaluacion.constants.ts` para que sean fáciles de ajustar sin tocar lógica de negocio:

**Ponderación del puntaje total.** Se estableció una ponderación igualitaria: 33.3% para cumplimiento de plazos, 33.3% para calidad de recepción, 33.3% para documentación vigente.

**Umbral mínimo de homologación.** Se fijó en 60 puntos, como constante de código (`UMBRAL_MINIMO_HOMOLOGACION`), no como una entidad de configuración en base de datos — el Módulo D todavía no expone ninguna entidad de configuración de negocio parametrizable; el proyecto ya resuelve un caso similar (`MAX_INTENTOS_FALLIDOS`, el límite de intentos de login) de la misma manera.

**Cumplimiento de plazos.** Se calcula como `clamp(100 - dias_atraso × 5, 0, 100)`, donde `dias_atraso` es la diferencia en días entre la fecha real de recepción y la fecha de entrega comprometida de la orden de compra (nunca negativa). Si la orden de compra no tiene fecha de entrega comprometida cargada, el puntaje de plazos es 100 — no hay base para penalizar sin un compromiso de fecha.

**Calidad de recepción.** Se calcula como el porcentaje de ítems de la recepción que no tienen ninguna discrepancia asociada, sobre el total de ítems de esa recepción.

**Documentación vigente.** El proyecto no tiene todavía un modelo de vencimientos documentales. Se trata como un insumo manual opcional, con el mismo criterio que ya usa el modelo para el campo de devoluciones por defecto de fabricación: si no se carga un valor explícito, se usa un valor por defecto de 100 (vigente).

**Contrato de integración con HU-H4 (Recepción de Mercadería).** `evaluacion.service.ts` expone la función `registrarEvaluacionDesdeRecepcion(recepcionId: string, usuarioId: string)`. El servicio de recepciones la invoca directamente, inmediatamente después de que su propia transacción de registro de recepción confirme el commit. Es una llamada intra-módulo directa, no pasa por el bus de eventos de dominio.

## Arquitectura y archivos

**Archivos nuevos:**
- `src/lib/services/proveedores/evaluacion.constants.ts` — las constantes de negocio descriptas arriba.
- `src/lib/services/proveedores/evaluacion.calculo.ts` — funciones puras de cálculo (`calcularPuntajePlazos`, `calcularPuntajeCalidad`, `calcularPuntajeTotal`), sin acceso a base de datos, testeables de forma aislada.
- `src/lib/services/proveedores/evaluacion.calculo.test.ts` — tests unitarios de las funciones puras.
- `src/lib/services/proveedores/evaluacion.service.ts` — `registrarEvaluacion(input)` (lógica transaccional completa) y `registrarEvaluacionDesdeRecepcion(recepcionId, usuarioId)` (función de invocación que consume HU-H4).
- `src/lib/services/proveedores/evaluacion.service.test.ts` — tests del servicio.
- `src/lib/schemas/proveedores.schema.ts` — `RegistrarEvaluacionDesdeRecepcionSchema` (validación Zod del input).

**Archivos modificados:**
- `src/lib/events/event-types.ts` — se agregó la interfaz `ProveedorEstadoCambiadoPayload` y su entrada en `DomainEventMap`.
- `package.json` — se agregaron los dos archivos de test nuevos al script `test`.

## Flujo transaccional

Dentro de una única transacción de base de datos: se lee la recepción con sus ítems y discrepancias, y la fecha de entrega comprometida de la orden de compra asociada; se calculan los tres sub-puntajes; se resuelve el puntaje de documentación (valor manual si se proveyó, 100 por defecto si no); se calcula el puntaje total ponderado; se crea el nuevo registro de `EvaluacionProveedor`; y si el puntaje total queda por debajo del umbral mínimo, se actualiza el estado del proveedor a `SUSPENDIDO`, todo dentro de la misma transacción.

Después de que la transacción confirma el commit, si hubo una suspensión, se emite el evento de dominio `proveedor:estado_cambiado`.

## Eventos de dominio

Se agregó el evento `proveedor:estado_cambiado`, con el siguiente payload:

```typescript
interface ProveedorEstadoCambiadoPayload {
  proveedor_id: string;
  usuario_id: string | null;
  estado_anterior: string;
  estado_nuevo: string;
  origen: "MANUAL" | "AUTOMATICO";
  motivo: string;
}
```

El campo `origen` distingue si el cambio de estado fue disparado automáticamente por esta evaluación (`"AUTOMATICO"`, con `usuario_id: null`) o por una acción manual de un usuario a través del endpoint de homologar/suspender proveedores definido en la especificación del módulo (`"MANUAL"`) — ambos casos reutilizan el mismo evento y el mismo tipo de payload.

## Verificación

**Tests automatizados:** 44 tests pasando (22 nuevos de esta HU más los 22 preexistentes del proyecto), sin romper ninguno. Compilación de TypeScript (`tsc --noEmit`) y build de producción (`next build`, 47 rutas) sin errores.

De los 22 tests nuevos, los 10 de `evaluacion.calculo.test.ts` ejecutan las funciones puras de verdad. Los 12 de `evaluacion.service.test.ts` son assertions sobre el código fuente del servicio, no ejecuciones reales contra base de datos — esto es consistente con el resto del proyecto: el test runner nativo de Node que usa el repositorio no resuelve el alias de import `@/lib/...`, la misma limitación que ya afecta a los tests de otros servicios existentes (órdenes de compra, transferencias).

**Ejecución real contra datos reales.** Para no depender únicamente de assertions de código, se ejecutó la función `registrarEvaluacionDesdeRecepcion()` de verdad contra la base de datos de desarrollo, con dos casos:

- Con los datos reales del seed del proyecto (una recepción con 1 ítem y 1 discrepancia, sin fecha de entrega comprometida cargada): el cálculo dio 100 / 0 / 100 en los tres sub-puntajes, puntaje total 66.67, por encima del umbral — el proveedor no cambió de estado y no se emitió ningún evento.
- Con datos sintéticos armados para forzar el caso de suspensión (20 días de atraso, 2 de 2 ítems con discrepancia): el cálculo dio 0 / 0 / 100, puntaje total 33.33, por debajo del umbral — el proveedor pasó de `HOMOLOGADO` a `SUSPENDIDO` y se emitió el evento `proveedor:estado_cambiado` con `origen: "AUTOMATICO"` después del commit, con el payload correcto.

Todos los datos sintéticos usados para esta verificación se eliminaron de la base al finalizar; los datos originales del seed quedaron intactos.

## Actualización — Idempotencia y trazabilidad (2026-09-02)

Al integrar el contrato con HU-H4, el desarrollador a cargo detectó tres puntos que esta documentación no dejaba definidos formalmente. Se resolvieron con un PR de corrección (`fix/HU-H5-idempotencia-evaluacion`, mergeado a `develop`) sobre el código ya descripto arriba:

**Momento de evaluación.** Se confirmó que la evaluación se dispara ante cada recepción física, incluidas las parciales — no solo la que deja la orden de compra en `RECIBIDA_COMPLETA`. Esto ya estaba implícito en el diseño original (recálculo incremental, nunca en batch) y quedó confirmado explícitamente como parte del contrato.

**Idempotencia.** Se agregó `recepcion_id` a `EvaluacionProveedor` (campo único, con relación a `Recepcion`). `registrarEvaluacion()` ahora verifica si ya existe una evaluación para esa recepción antes de crear una nueva — si existe, la devuelve sin duplicar, sin volver a suspender al proveedor ni volver a emitir el evento. Esto garantiza una evaluación por recepción, incluso ante un retry o una doble invocación desde HU-H4.

**Trazabilidad.** El mismo campo `recepcion_id` deja cada evaluación vinculada explícitamente a la recepción que la originó. No se agregó una referencia directa a `OrdenCompra` en `EvaluacionProveedor`, ya que se llega a ella de forma transitiva a través de `Recepcion`.

La migración correspondiente (`20260902165629_add_recepcion_id_evaluacion_proveedor`) backfillea por identificador conocido la única evaluación preexistente del seed — no incluye una lógica de emparejamiento genérica para múltiples filas huérfanas, ya que ningún entorno real presenta ese caso hoy. Si en el futuro aparece, se revisará con datos reales en mano en vez de anticiparlo.

Esta corrección también dejó verificado con evidencia real de ejecución (no solo tests estáticos) que el handler de auditoría para el evento `proveedor:estado_cambiado` — implementado por otro integrante del equipo — genera correctamente la fila esperada en el registro de auditoría al dispararse una suspensión automática.


## Decisiones sujetas a revisión

Las reglas de negocio de la sección "Reglas de negocio implementadas" fueron definidas por el equipo de desarrollo ante la ausencia de una definición formal en la documentación de especificación del proyecto. Quedan centralizadas en `evaluacion.constants.ts` específicamente para que el equipo o el Product Owner puedan ajustarlas — la ponderación, el valor del umbral, el coeficiente de penalización por día de atraso, y el tratamiento del puntaje de documentación — sin necesidad de modificar la lógica de negocio.