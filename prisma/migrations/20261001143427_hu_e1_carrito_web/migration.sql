-- AlterEnum
ALTER TYPE "OrigenReserva" ADD VALUE 'CHECKOUT_WEB';

-- DropIndex
DROP INDEX "carritos_web_cuenta_cliente_web_id_key";

-- AlterTable
ALTER TABLE "cuentas_cliente_web" ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "items_carrito_web" ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "carritos_web_cuenta_cliente_web_id_idx" ON "carritos_web"("cuenta_cliente_web_id");

-- HU-E1 (D5) — Un único carrito ACTIVO por cuenta de Cliente Web.
-- Reemplaza al `@unique` que se quitó del schema (DropIndex de arriba): un
-- único total impedía que la cuenta tuviera un carrito nuevo después de que
-- el job de carritos abandonados (HU-E5) diera de baja lógica el anterior.
-- Prisma 6 no modela índices parciales: este índice vive solo acá (ver el
-- comentario del modelo `CarritoWeb` en schema.prisma).
CREATE UNIQUE INDEX "carritos_web_cuenta_activa_key"
  ON "carritos_web"("cuenta_cliente_web_id")
  WHERE "is_active" = true AND "deleted_at" IS NULL AND "cuenta_cliente_web_id" IS NOT NULL;
