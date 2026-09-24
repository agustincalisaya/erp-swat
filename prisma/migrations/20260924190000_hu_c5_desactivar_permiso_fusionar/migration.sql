-- HU-C5: el permiso historico de fusion ya no tiene consumidores.
-- Baja logica de la fila y de todas sus asignaciones; conserva los registros.
-- Si una instalacion nunca tuvo clientes:fusionar, ambas sentencias son no-op.
BEGIN;

UPDATE rol_permisos
SET is_active = false,
    deleted_at = COALESCE(deleted_at, CURRENT_TIMESTAMP),
    deletion_reason = COALESCE(deletion_reason, 'HU-C5: fusión fuera de alcance'),
    updated_at = CURRENT_TIMESTAMP
WHERE is_active = true
  AND permiso_id IN (
    SELECT id FROM permisos WHERE codigo = 'clientes:fusionar'
  );

UPDATE permisos
SET is_active = false,
    deleted_at = COALESCE(deleted_at, CURRENT_TIMESTAMP),
    deletion_reason = COALESCE(deletion_reason, 'HU-C5: fusión fuera de alcance'),
    updated_at = CURRENT_TIMESTAMP
WHERE codigo = 'clientes:fusionar'
  AND is_active = true;

COMMIT;
