# HU-G13 — evidencia local, 2026-10-18

Base descartable: PostgreSQL 16 en `127.0.0.1:55437/hu_g13`, creada con `prisma db push` y seed local. No se aplicó migración nueva ni se modificó schema o seed en esta etapa. El permiso G13 y las cinco categorías están cubiertos por el commit `seed:` previo.

## Unitario e integración

- `node --experimental-strip-types --test src/lib/schemas/gasto-operativo.schema.test.ts`: 1/1.
- `node --conditions=react-server --import tsx --test --test-concurrency=1 src/lib/services/tesoreria/gasto-operativo.integration.test.ts`: 1/1. Verificó fecha solo día UTC, decimales exactos `0.10 + 0.20 = 0.30`, paginación con total completo, fecha inexistente y futura, no-op, edición, baja, edición posterior rechazada, mes vacío `0.00`, categoría inactiva rechazada para alta y cambio, categoría histórica conservada, edición y baja concurrentes, asientos `CREATE/UPDATE/DELETE_LOGICO` y `verificarCadenaIntegridad().integra === true`.
- `node --experimental-strip-types --test src/lib/events/listeners/audit-log.listener.test.ts src/lib/events/event-types.test.ts`: 21/21.
- `npx tsc --noEmit --pretty false`, ESLint de archivos G13 y `git diff --check`: correctos.

## HTTP y pantalla

`node "docs/testing/Modulo G/hu-g13/http.mjs"` contra Next dev local con el seed: login real de `tesorero.seed`, `admin.seed` y `cajero.seed`; 401 sin sesión, 403 sin permiso, pantalla protegida, selector G12, alta 201, listado filtrado con paginación y total, edición 200, baja 200, validación 400 e intento de editar luego de la baja 409. G13 con Tesorero Central: operativo.

Capturas con sesión real del Tesorero Central: [listado](listado.png) y [formulario de alta](formulario-alta.png).
El script de capturas completó además un alta por `crearGastoOperativoAction` desde el formulario y confirmó la aparición del gasto `Interfaz G13 1792351103716` en el listado.

## Base de datos

Las consultas están en [consultas.sql](consultas.sql). Para el gasto HTTP `940a6c80-fdf0-47cd-a548-ba0fcf29ab67` se obtuvo:

```text
monto=1251.25 | fecha=2026-10-18 00:00:00 | is_active=false
deleted_at=presente | deleted_by=presente | deletion_reason=Prueba HTTP completa
audit_logs: CREATE, UPDATE, DELETE_LOGICO; tres hash_actual presentes
total activo octubre 2026: 0.70; el gasto dado de baja no suma
```

La categoría histórica conserva su nombre en el DTO aun dada de baja. El evento de edición incluye fecha anterior/nueva para que D6 pueda reevaluar ambos meses.

**Bloqueada por HU-G14:** prueba del impacto en el reporte mensual. `obtenerResumenMensual` continúa como stub; corresponde a HU-G14 integrar ese consumidor. No se duplicó el cálculo aquí.
