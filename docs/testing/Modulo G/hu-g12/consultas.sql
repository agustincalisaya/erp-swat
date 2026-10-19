-- Ejecutar únicamente sobre la base local descartable HU-G12.
SELECT id, nombre, nombre_normalizado, is_active, deleted_at, deleted_by, deletion_reason
FROM categorias_gasto ORDER BY nombre_normalizado;

SELECT categoria_gasto_id, COUNT(*) FROM gastos_operativos
GROUP BY categoria_gasto_id ORDER BY categoria_gasto_id;

SELECT accion, tabla_afectada, registro_id, valor_anterior, valor_nuevo,
       hash_anterior, hash_actual
FROM audit_logs
WHERE tabla_afectada = 'categorias_gasto'
ORDER BY created_at, id;
