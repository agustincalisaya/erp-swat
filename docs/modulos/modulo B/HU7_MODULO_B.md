# HU-B7 — Emisión de Comprobante Fiscal con CAE y QR Simulados

**Módulo:** B (Ventas y Punto de Venta) — Sprint 3
**Responsable:** Adriel Relos
**Rama:** `feature/HU-B7-comprobante-fiscal`
**Estado:** Completa, verificada. Lista para commit y PR contra `develop`.

---

## 1. Objetivo de la HU

Asegurar que ninguna venta se concrete sin comprobante fiscal completo y archivado, sin depender de la disponibilidad de un servicio externo. El Cajero POS selecciona manualmente el tipo de comprobante (Factura A, Factura B o Ticket) al confirmar el cobro; el sistema genera de forma local un CAE simulado y un código QR con la estructura exigida por la normativa vigente, sin invocar ningún servicio externo de AFIP. El comprobante queda archivado de forma permanente, nunca eliminable.

---

## 2. Alcance real — por qué esta HU es más chica de lo esperado

**Hallazgo clave, confirmado contra el Product Backlog vigente (Sprint 3) antes de escribir la task:** la nota de coordinación del equipo indica explícitamente que "HU-B1 + HU-B7 comparten literalmente la misma transacción de cobro; no conviene repartirlas entre dos personas distintas." Los 4 criterios de aceptación de HU-B7 del Backlog ya habían quedado implementados dentro de la rama de HU-B1 (ya mergeada a `develop`):

1. Selección manual del tipo de comprobante al confirmar el cobro. ✅ (`RegistrarVentaMostradorSchema.tipo_comprobante`)
2. CAE simulado y QR generados localmente, sin invocar AFIP. ✅ (`comprobante-fiscal.service.ts`, `emitirComprobanteFiscal()`)
3. Archivo permanente, nunca eliminable. ✅ (`ComprobanteFiscal` sin bloque de soft-delete)
4. Integración real con AFIP fuera de alcance. ✅ (`es_simulado: true`)

Lo único pendiente según la spec técnica vigente (`spec_modulo_B.md` §2.7, Rev. 3) era el **endpoint de consulta** de un comprobante ya emitido, que no expone ruta de alta propia (el comprobante siempre nace asociado a una venta, nunca de forma aislada) — eso es lo que esta rama efectivamente agrega.

---

## 3. Qué se implementó

**Backend:**
- `GET /api/ventas/comprobantes/[id]/route.ts` — nuevo endpoint de consulta, gateado por `withPermission(ventas:leer)` (permiso ya sembrado desde HU-B1, sin cambios de seed).
- `obtenerComprobantePorId(id)` en `comprobante-fiscal.service.ts` — busca el `ComprobanteFiscal` por id, `404 COMPROBANTE_NO_ENCONTRADO` si no existe. Sin lógica de negocio en el route handler.
- `ComprobanteFiscalIdSchema` agregado a `ventas.schema.ts` para validar el `id` como UUID.
- Sin cambios en `emitirComprobanteFiscal()` (HU-B1) ni en `schema.prisma`/`seed.ts` — el modelo `ComprobanteFiscal` ya estaba completo y estable.

**Frontend:**
- `ModalComprobanteFiscal.tsx` — nuevo componente que consulta el endpoint y muestra el CAE simulado y el código QR (desde `qr_data_url`).
- Botón "Ver comprobante" agregado en `FormularioVentaMostrador.tsx`, visible únicamente cuando `comprobante_id !== null` (venta facturada). No aparece cuando la venta queda pendiente de autorización de un Supervisor.
- Sin pantalla nueva de listado/historial de comprobantes — fuera de alcance, mismo criterio que HU-B1.

---

## 4. Verificación realizada (evidencia real)

**`npm test`:** 374/374 ✔ (incluye los unitarios nuevos de `comprobante-fiscal.service.test.ts`).

**`npx tsc --noEmit`:** limpio. (Se detectó y corrigió `.next/dev/types/routes.d.ts` vacío por una corrida de `next dev` interrumpida antes de esta rama — sin relación con el código de esta HU.)

**`npm run build`:** compila OK, incluye `/api/ventas/comprobantes/[id]` en el manifest.

**`npm run test:integration:b7` (HTTP contra servidor real + Postgres real, 6/6 ✔):**

| Caso | Resultado |
|---|---|
| Sin sesión | ✔ PASS — `401` |
| Sin permiso `ventas:leer` (usuario `comprador.seed`, fuera del módulo Ventas) | ✔ PASS — `403` |
| `id` con formato inválido | ✔ PASS — `400` |
| `id` válido pero inexistente | ✔ PASS — `404 COMPROBANTE_NO_ENCONTRADO` |
| Comprobante existente (fixture de seed) | ✔ PASS — `200`, shape correcto |

**Verificación manual completa en navegador**, con capturas de los 2 escenarios clave desde `/ventas/pos`:
1. **Venta con 5% de descuento:** facturada directo, botón "Ver comprobante" visible. Al hacer clic, el modal muestra el CAE simulado (`94715789360105`) y el QR correctamente.
2. **Venta con 20% de descuento:** queda pendiente de autorización de un Supervisor, el botón "Ver comprobante" **no aparece** (comportamiento esperado, sin `comprobante_id`).

---

## 5. Decisiones y ambigüedades resueltas (documentadas en `docs/tasks/task_relos.md`, no versionado)

- **Un único archivo de integración** (`comprobante-fiscal.integration.test.ts`), sin separarlo en un `.http.integration.test.ts` propio — mismo criterio de simplicidad ya usado en HU-B1/HU-B2.
- **Usuario elegido para el caso `403`:** `comprador.seed`. Todos los roles propios de Ventas (Cajero POS, Supervisor de Ventas, Auditor) tienen `ventas:leer`, así que se necesitó un usuario de otro módulo para poder probar el rechazo por falta de permiso.

---

## 6. Hallazgo a reportar (no bloqueante, no corregido en esta rama)

El Documento de Alcance Funcional y Técnico general del proyecto, sección **Módulo G — Tesorería** (§3.3 "Integración y repositorio fiscal AFIP", aprox. páginas 43-47), todavía describe una integración **real** con AFIP/WSFEV1: menciona que Módulo G "centraliza la única integración del sistema con el servicio web de facturación electrónica de AFIP", que los módulos de venta "delegan esa emisión" a Módulo G, un "modo contingencia" con encolado automático de CAE, y exportación del Libro de IVA Digital en formato SITER.

Esto **contradice directamente** la directiva del PO ya aplicada en `spec_modulo_B.md`: se eliminó del alcance del proyecto toda integración real con AFIP, y el comprobante se genera de forma **local y simulada** por cada módulo de venta, sin depender de Módulo G ni de ningún servicio externo. La propia `spec_modulo_B.md` indica explícitamente: *"Si algún documento del repositorio (Alcance Funcional, código, comentario) todavía asume una integración real con AFIP en el circuito de Ventas, no es la fuente de verdad (...) Reportar cualquier inconsistencia encontrada, no corregirla asumiendo cuál versión es la correcta sin confirmar primero."*

Módulo G no está construido en este sprint, así que no hay código real afectado — es un hallazgo de higiene documental. Se eleva al equipo/PO para que actualice esa sección del Documento de Alcance Funcional y la alinee con la directiva ya vigente en `spec_modulo_B.md`.

---

## 7. Pendientes reales (no bloqueantes)

- Sin pendientes técnicos adicionales sobre el alcance propio de HU-B7 — la emisión, el CAE/QR simulados y la inmutabilidad del comprobante ya habían quedado resueltos en HU-B1.
- **Corrección respecto del resumen de cierre de HU-B1:** la máquina de estados de facturación parcial/remitos que se había anotado ahí como "pendiente, se resuelve en HU-B7" en realidad no es parte de HU-B7 — corresponde a HU-B3 (cotización con reserva de stock, sección 2.3 y 3.1 de `spec_modulo_B.md`). Queda pendiente para cuando se aborde esa HU.

---

## 8. Estado de entrega

- Verificación completa (automatizada + manual) cerrada.
- Pendiente: commit y PR contra `develop`.

## 9. Próximo paso

Commit, push de la rama `feature/HU-B7-comprobante-fiscal`, y apertura de PR con el hallazgo de AFIP/Módulo G documentado en la descripción. Con esto se completa la secuencia acordada **B2 → B1 → B7**. Definir con el equipo el siguiente frente de trabajo (por ejemplo, HU-B3, donde vive realmente la máquina de estados de facturación parcial/remitos).
