# HU-E16 — Publicación de contenido completo: evidencia de cierre

- **HU:** HU-E16 (backlog Sprint 5, fila 6), 3 SP. Administrador E-commerce: no se puede activar «Mostrar en tienda» sin descripción ni foto.
- **Contrato:** `docs/specs/spec_modulo_E.md` §6.2 (E16-1 a E16-5 y "Concurrencia"); notas aditivas Rev.10 en §2.11.g (errores) y §4 (eventos).
- **Tasks:** `docs/modulos/modulo E/HU16_TASKS.md` (T01–T07, decisiones D1–D15, conflictos C1–C8 resueltos, deuda DT-1, decisiones menores DM-1–DM-11).
- **Estado:** T01–T07 implementadas y verificadas el 20/10/2026. Sin cambios en `schema.prisma` ni migraciones.

---

## 1. Qué cambió

| Pieza | Archivo |
|---|---|
| Regla pura única (`evaluarPublicabilidad`, `ETIQUETA_FALTANTE`) | `src/lib/services/ecommerce/publicabilidad-web.reglas.ts` |
| Evento `ecommerce:publicacion_web_rechazada` | `src/lib/events/event-types.ts` |
| Coordinador de confirmación (10 s, singleton en `globalThis`) | `src/lib/events/publicacion-web-confirmacion.ts` |
| Productor que espera la confirmación de D.3 | `src/lib/events/publicacion-web-auditoria.ts` |
| Handler de D.3 (marca Symbol, import dinámico, whitelist) | `src/lib/events/listeners/audit-log.listener.ts` |
| Lock compartido `SELECT … FOR UPDATE` | `src/lib/services/ecommerce/contenido-web-lock.ts` (usado por `foto-web.service.ts` y `visibilidad-web.service.ts`) |
| Validación `false → true`, rechazo auditado, `publicable`/`faltantes` en el listado | `src/lib/services/ecommerce/visibilidad-web.service.ts` |
| 422 con `details` / 503 | `src/lib/services/ecommerce/respuesta-catalogo.ts` |
| UI de backoffice | `src/components/ecommerce/CatalogoWebAdmin.tsx` |
| Seed E16-5 (Cinturón Táctico, sin foto, oculto) | `prisma/seed.ts` |

## 2. CA → prueba

| CA | Pruebas |
|---|---|
| E16-1 | `publicabilidad-web.reglas.test.ts`; `hu-e16.integration.test.ts` (faltantes individuales/combinados, mutación nula con `updated_at` intacto, E5 intacto); `hu-e16.http.integration.test.ts` (422 + `details.faltantes`) |
| E16-2 | `hu-e16.integration.test.ts` (listado), `hu-e16.http.integration.test.ts` (servicio obligatorio vía PATCH), `catalogo-web-admin.e16.test.ts` (botón deshabilitado + motivo) y render verificado en el HTML real |
| E16-3 | `hu-e16.integration.test.ts` (visible que pierde la última foto: sigue visible, la tienda y el detalle lo excluyen, admin `No publicable`, ocultar OK); `catalogo-web-admin.e16.test.ts` (badge) |
| E16-4 | `audit-log.listener.e16.test.ts` (Symbol, confirmación post-persistencia, whitelist, falla, timeout, sin listener, bus sin inicializar, un asiento por intento); `hu-e16.integration.test.ts` (asiento ya persistido al recibir cada 422, 503 sin cambio ni asiento); `hu-e16.http.integration.test.ts` (asiento por request contra el servidor real; envelope 503) |
| E16-5 | `hu-e16.integration.test.ts` y `hu-e16.http.integration.test.ts` (contenido sembrado → 422 `['foto']`, sigue oculto); seed ×2 sin errores |

## 3. Matriz "Concurrencia" → caso

| Caso de §6.2 | Caso |
|---|---|
| Faltantes individuales/combinados | integración: `E16-1 — …` (3 casos); HTTP: `E16-1/E16-2 — 422 …` |
| Mutación nula | `assertSinMutacion` (visibilidad, `updated_at`, sin evento de cambio) |
| Un asiento por cada 422, incluso repetido | integración: 3 rechazos → 3 asientos con `intento_id` distintos; HTTP: 2 requests por caso |
| Fallo / timeout del listener → 503 sin cambio | integración: `D.3 no confirma`, `timeout del listener`, `sin listener`; listener: tests del productor |
| Carrera con baja de foto | `mostrar espera el lock de la baja…` (bloqueado, luego 422) y `orden por lock` (ambos órdenes) y `la baja de foto espera al lock…` |
| Contenido visible que pierde la última foto | `E16-3 — visible que pierde la última foto…` |

## 4. Corridas de verificación (20/10/2026)

Base de test: `swat_erp_test_e16` (PostgreSQL local). Servidor HTTP: `next dev -p 3116` apuntado a esa base (`CRON_SECRET` local solo para E5-HTTP).

| Comando | Resultado |
|---|---|
| `npx tsc --noEmit` | exit 0 |
| `npm run lint` | 0 errores, 6 warnings preexistentes (ninguno en archivos de E16) |
| `npm test` | 1264 / 1264 |
| `npm run test:integration:e16` | 16 / 16 |
| `npm run test:integration:e16-http` | 6 / 6 |
| `node --experimental-strip-types --test …audit-log.listener.e5/.e11/.e16.test.ts` | 27 / 27 |
| `npm run test:integration:e1` / `e5` / `e11` | 21/21 · 18/18 · 21/21 |
| `npm run test:integration:e5-http` / `e11-http` | 8/8 · 12/12 |
| `npm run test:integration:e1-http` | 13/15: falla preexistente ajena a E16 (`/tienda` responde 200 y el test espera 307; DM-11) |
| `npx prisma db seed` ×2 (base de test y base de desarrollo) | ambas corridas exit 0; contenido E16 único, oculto, 0 fotos |

## 5. Pendientes

- DT-1: `editarContenidoWeb` conserva su SQL de lock en línea (fuera de alcance).
- DM-11: actualizar `hu-e1.http.integration.test.ts` para la portada `/tienda` (owner de E1/tienda).
- Redacción de las etiquetas de faltantes, sujeta a validación del PO.
