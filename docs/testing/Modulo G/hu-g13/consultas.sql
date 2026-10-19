-- Ejecutar solamente en la base local descartable HU-G13.
SELECT g.id, g.categoria_gasto_id, c.nombre, g.fecha, g.monto,
       g.descripcion, g.registrado_por_id, g.is_active,
       g.deleted_at, g.deleted_by, g.deletion_reason
FROM gastos_operativos g
JOIN categorias_gasto c ON c.id = g.categoria_gasto_id
ORDER BY g.fecha, g.id;

SELECT COALESCE(SUM(monto), 0) AS total_activo
FROM gastos_operativos
WHERE is_active = true
  AND fecha >= TIMESTAMP '2026-10-01 00:00:00'
  AND fecha < TIMESTAMP '2026-11-01 00:00:00';

SELECT accion, tabla_afectada, registro_id, valor_anterior, valor_nuevo,
       hash_anterior, hash_actual
FROM audit_logs
WHERE tabla_afectada = 'gastos_operativos'
ORDER BY created_at, id;
