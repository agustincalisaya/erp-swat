-- Cancelación de HU-A3 (Legajos de Prueba / estado "En Prueba") por decisión
-- del Product Owner en la Sprint Review del 21/08/2026: la funcionalidad no
-- debía haber entrado al sprint. Elimina el modelo LegajoPrueba y sus FKs.

-- DropForeignKey
ALTER TABLE "legajos_prueba" DROP CONSTRAINT "legajos_prueba_registrado_por_id_fkey";

-- DropForeignKey
ALTER TABLE "legajos_prueba" DROP CONSTRAINT "legajos_prueba_variante_sku_id_fkey";

-- DropTable
DROP TABLE "legajos_prueba";
