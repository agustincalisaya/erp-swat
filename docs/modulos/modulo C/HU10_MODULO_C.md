# HU-C10 — Log de auditoría de clientes

## Alcance

La opción **Clientes** de `/auditoria/logs` consulta asientos ya existentes del ledger central `AuditLog`. Muestra únicamente `CREATE`, `UPDATE` y `DELETE_LOGICO` cuya `tabla_afectada` es `clientes`. Comprende altas, ediciones de ficha, cambios de segmento y canal de contacto y bajas lógicas cuando sus asientos están registrados. No incorpora direcciones, consentimientos, ventas ni fusiones. La consulta no escribe ni modifica registros.

## Acceso

El permiso `clientes:leer_auditoria` se asigna a los roles Auditor y Administrador CRM. Vendedor no lo recibe. La vista y `GET /api/auditoria/logs?modulo=clientes` verifican el permiso; el servicio también lo revalida. El filtro de tabla y operaciones se aplica en el servidor antes de contar y paginar, sin aceptar una tabla solicitada por el navegador. El permiso no habilita lectura global ni `POST /api/auditoria/verificar-cadena` al Administrador CRM. El modo general de `/auditoria/logs` conserva sus reglas anteriores.

## Consulta y resultados

1. Abrir **Auditoría Forense** y elegir **Clientes**.
2. Filtrar, si corresponde, por ID de cliente, responsable, operación y fechas. La fecha final incluye todo el día indicado en UTC. Los cambios de filtros vuelven a la página 1; la paginación mantiene el filtro.
3. Revisar fecha y hora, responsable, cliente, operación, motivo de baja cuando conste y el detalle de valores anteriores y nuevos del asiento.

`AuditLog.registro_id` identifica al cliente. El nombre y DNI mostrados junto al ID se consultan de la ficha **actual**, incluso si el cliente está inactivo; no representan el nombre histórico. El asiento `CREATE` contiene el DNI pero no el nombre. Los asientos `UPDATE` contienen solo los campos modificados. `DELETE_LOGICO` conserva `is_active` anterior/nuevo y `deletion_reason`. Un dato ausente se muestra como tal, sin reconstruir valores históricos.

## Integridad y límites

HU-C10 reutiliza `AuditLog` y su cadena SHA-256. El botón existente de verificación ejecuta el verificador **global** únicamente para usuarios que ya tienen `auditoria:verificar_cadena`. La consulta de Clientes no calcula otra cadena. Los eventos se publican después del commit por el mecanismo existente; HU-C10 muestra los asientos que efectivamente llegaron al ledger y no altera ese mecanismo transversal.

**Archivos principales:** `src/lib/services/clientes/auditoria-clientes.service.ts`, `src/lib/schemas/auditoria-clientes.schema.ts`, `src/components/auditoria/VistaAuditoriaClientes.tsx`, `src/app/(dashboard)/auditoria/logs/page.tsx` y `src/app/api/auditoria/logs/route.ts`.
