-- Agrega el campo `codigo_producto` (segmento [PRODUCTO] del SKU
-- determinístico, HU-A1) a `productos_maestros`. Se agrega nullable primero,
-- se backfillea para las filas ya sembradas por `prisma/seed.ts` y recién
-- después se promueve a NOT NULL, para no fallar contra datos existentes.
--
-- Deliberadamente NO es @unique: dos ProductoMaestro de la misma familia
-- (ej. dos modelos de campera) pueden compartir el mismo código de
-- categoría/línea — la unicidad real del SKU final la garantiza
-- `VarianteSKU.sku @unique`, no este campo.

-- AlterTable (paso 1: columna nullable)
ALTER TABLE "productos_maestros" ADD COLUMN "codigo_producto" TEXT;

-- Backfill de filas ya sembradas (prisma/seed.ts)
UPDATE "productos_maestros" SET "codigo_producto" = 'CAMPOL' WHERE "nombre" = 'Camisa de Policía' AND "codigo_producto" IS NULL;
UPDATE "productos_maestros" SET "codigo_producto" = 'CAMTAC' WHERE "nombre" = 'Camisa Táctica' AND "codigo_producto" IS NULL;
UPDATE "productos_maestros" SET "codigo_producto" = 'BORCEG' WHERE "nombre" = 'Borcegos' AND "codigo_producto" IS NULL;

-- AlterTable (paso 2: promover a NOT NULL una vez backfilleada)
ALTER TABLE "productos_maestros" ALTER COLUMN "codigo_producto" SET NOT NULL;
