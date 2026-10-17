# HU-B2 — Apertura y Cierre de Turno de Caja con Arqueo Ciego

**Módulo:** B (Ventas y Punto de Venta) — Sprint 3
**Responsable:** Adriel Relos
**Rama:** `feature/HU-B2-turno-caja`
**Estado:** Completa, verificada, commiteada y pusheada. PR en curso.

---

## 1. Objetivo de la HU

El Cajero POS abre su turno declarando un fondo fijo inicial en efectivo, y lo cierra mediante **arqueo ciego**: declara su conteo físico de caja sin que el sistema le muestre antes cuánto debería haber. Recién al enviar ese conteo, el backend calcula el saldo esperado y la diferencia contra lo declarado. Si la diferencia supera un umbral configurado, el sistema exige una justificación antes de permitir el cierre.

---

## 2. Funcionamiento (explicado en detalle)

- **Apertura:** el Cajero declara `fondo_fijo_inicial` (el efectivo con el que arranca la caja). El sistema no permite abrir un segundo turno si ya tiene uno abierto (`fecha_cierre: null`) — valida esto en la capa de servicios, sin constraint de base de datos.
- **Durante el turno:** cada venta en efectivo que se registre contra ese turno (esto se conecta a futuro con HU-B1, todavía no implementada) va sumando al efectivo que el sistema espera encontrar en caja.
- **Cierre — arqueo ciego:** el Cajero cuenta físicamente el efectivo real y declara `conteo_fisico_declarado`, **sin que el sistema le muestre antes** cuánto "debería" haber. Recién al enviar ese conteo, el backend calcula:
  - `saldo_esperado = fondo_fijo_inicial + SUM(ventas en efectivo del turno)`
  - `diferencia = saldo_esperado - conteo_fisico_declarado`
- **Umbral de tolerancia ($500):** si `abs(diferencia) <= 500`, el turno cierra directo. Si supera los $500, el sistema bloquea el cierre (`422 JUSTIFICACION_REQUERIDA`) y exige que el Cajero ingrese una justificación de texto antes de poder reenviar y cerrar. La justificación **no dispara un flujo de aprobación** (a diferencia de HU-B4) — es una constancia escrita que queda guardada junto con el cierre, marcada como evento sensible en la auditoría (cadena SHA-256 reforzada).
- **Importante — por qué hoy el saldo esperado suele dar $0 o igual al fondo inicial:** como HU-B1 (venta de mostrador) todavía no existe en código, no hay ventas en efectivo reales que sumar. El cálculo es correcto; simplemente no tiene datos de venta para alimentar la suma todavía. Esto queda resuelto cuando se implemente HU-B1.

---

## 3. Qué se implementó

**Backend:**
- `abrirTurnoCaja(usuarioId, input)` — valida turno único abierto por usuario (409 `TURNO_YA_ABIERTO`), crea el `TurnoCaja`.
- `cerrarTurnoCaja(turnoCajaId, usuarioId, input)` — calcula saldo esperado y diferencia, aplica la regla del umbral, actualiza el turno en una sola operación.
- Sin cambios de schema: `TurnoCaja` ya estaba migrado completo desde la preparación previa de base de datos del sprint.
- Eventos de dominio `venta:turno_abierto` / `venta:turno_cerrado`, emitidos tras el commit exitoso (fire-and-forget). Cierre con justificación = evento sensible.

**Frontend:**
- Pantalla `/ventas/turnos`: formulario de apertura (fondo fijo inicial) y formulario de cierre (conteo físico + justificación condicional, mostrada solo si el backend la exige).
- El saldo esperado y la diferencia se revelan recién en la respuesta del cierre — nunca antes, ni siquiera en un endpoint de solo lectura.
- Entrada agregada al sidebar bajo la sección "Ventas", condicionada al permiso `ventas:gestionar_turno_caja` (ya sembrado para el rol `CAJERO_POS` desde HU-B8).

---

## 4. Archivos modificados/agregados

**Nuevos:**
- `src/app/(dashboard)/ventas/turnos/actions.ts` — Server Actions `abrirTurnoCaja` / `cerrarTurnoCaja`
- `src/app/(dashboard)/ventas/turnos/page.tsx` — pantalla de turno de caja
- `src/app/api/ventas/turnos/route.ts` — POST apertura de turno
- `src/app/api/ventas/turnos/[id]/cerrar/route.ts` — PATCH cierre de turno
- `src/components/ventas/FormularioTurnoCaja.tsx` — formulario de apertura/cierre con arqueo ciego
- `src/lib/services/ventas/turno-caja.service.ts` — lógica de negocio
- `src/lib/services/ventas/turno-caja.calculo.ts` — funciones puras de cálculo
- `src/lib/services/ventas/turno-caja.constants.ts` — `UMBRAL_DIFERENCIA_ARQUEO`
- `src/lib/services/ventas/turno-caja.service.test.ts`
- `src/lib/services/ventas/turno-caja.calculo.test.ts`
- `src/lib/services/ventas/turno-caja.integration.test.ts`

**Modificados:**
- `src/lib/schemas/ventas.schema.ts` — `AbrirTurnoCajaSchema`, `CerrarTurnoCajaSchema`
- `src/lib/schemas/ventas.schema.test.ts`
- `src/lib/events/event-types.ts` — `VentaTurnoAbiertoPayload`, `VentaTurnoCerradoPayload`
- `src/lib/events/listeners/audit-log.listener.ts` — listeners para ambos eventos
- `src/components/layout/Sidebar.tsx` — sección Ventas > Turno de caja
- `package.json`

---

## 5. Verificación realizada (evidencia real, no autodeclarada)

- `npm test`: 347/347 ✔
- `npx tsc --noEmit`: limpio
- `npm run build`: compila OK, incluye las nuevas rutas
- Test de integración contra Postgres real (14/14, corrido dos veces): doble apertura (409), cierre dentro del umbral, cierre fuera del umbral sin justificación (422), reintento con justificación (cierra), cadena SHA-256 verificada íntegra
- **Verificación manual completa en navegador**, hecha por Adriel, con capturas de los 4 escenarios:
  1. Apertura de turno
  2. Cierre con diferencia dentro del umbral (ej. saldo esperado $500, conteo $400, diferencia $100) → cierra directo
  3. Cierre con diferencia fuera del umbral (ej. saldo esperado $0, conteo $2000, diferencia $2000) → bloquea, pide justificación
  4. Reenvío con justificación → cierra, diferencia y justificación quedan guardadas y visibles en la respuesta

**Bug encontrado y corregido durante la prueba manual:** `revalidatePath` en la Server Action de cierre rompía el arqueo ciego (la pantalla saltaba directo a "apertura" sin mostrar el resultado del cierre). Se sacó de ahí; el botón "Continuar" quedó como el único punto que dispara el refresh.

**Hallazgo adicional:** el seed del proyecto ya tenía un `TurnoCaja` abierto con `VentaMedioPago` reales (no sintéticos), lo que permitió verificar la agregación de `saldo_esperado` contra datos genuinamente sembrados en un caso, además de los casos de prueba con datos forzados.

---

## 6. Pendientes documentados (no bloqueantes para el cierre de esta HU)

1. **Validar `UMBRAL_DIFERENCIA_ARQUEO` ($500) con Dirección/PO.** No existe hoy una entidad de configuración global en el sistema (mismo gap que el umbral de homologación de HU-H5 y el % de descuento máximo de HU-B4); se implementó como constante de código en `turno-caja.constants.ts`.
2. **Notificación real al Tesorero** cuando la diferencia supera el umbral: la AC lo pide, pero no existe hoy ningún motor de notificaciones (Módulo F/G no construido). El evento `venta:turno_cerrado` ya lleva `diferencia` y `requiere_justificacion` en el payload, listo para que un futuro consumidor lo use.
3. **Verificación end-to-end de `saldo_esperado` con ventas reales en efectivo:** pendiente de que HU-B1 (venta de mostrador) exista en código y empiece a alimentar la suma.
4. **Corrección/cancelación de un turno abierto por error:** detectado durante la prueba manual — hoy no hay forma de corregir un `fondo_fijo_inicial` mal ingresado al abrir; solo se puede cerrar el turno (con diferencia y justificación si corresponde) y abrir uno nuevo. **No está contemplado en la especificación original de la HU.** Implica decisiones de negocio no triviales: ¿edición del mismo turno o anulación + nuevo turno?, ¿se permite si ya hay operaciones registradas contra el turno?, ¿requiere su propio evento de auditoría?, ¿qué rol puede hacerlo? Se eleva al equipo/PO antes de implementarse — no resuelto en esta HU.

---

## 7. Estado de entrega

- Commit: `feat(HU-B2): apertura y cierre de turno de caja con arqueo ciego`
- Push: `origin/feature/HU-B2-turno-caja` (up to date)
- Working tree: limpio, nada sin commitear
- PR: en curso de creación contra `develop`

## 8. Próximo paso

Continuar con **HU-B7** (emisión de comprobante fiscal simulado con CAE/QR), siguiendo la secuencia acordada B2 → B7 → B1. Antes de escribir la task de B7, repasar en detalle la HU y sus criterios de aceptación, siguiendo el mismo proceso que se usó para B2.
