-- HU-E4 — Cupones de descuento (spec_modulo_E §2.4.a).
-- `updated_at` en cupones y aplicaciones; `reserva_hasta` en aplicaciones.
-- Sin CHECKs ni índices parciales: las invariantes las garantiza el servicio.

ALTER TABLE "cupones_descuento"
ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "aplicaciones_cupon"
ADD COLUMN "reserva_hasta" TIMESTAMP(3),
ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Registros existentes: `updated_at` = `created_at`.
UPDATE "cupones_descuento" SET "updated_at" = "created_at";
UPDATE "aplicaciones_cupon" SET "updated_at" = "created_at";

-- Aplicaciones pendientes existentes: `reserva_hasta` = vencimiento más
-- próximo de las reservas de su pedido (el mismo valor que E2 informa como
-- `ttl_expiracion`). Las confirmadas e históricas quedan en NULL.
UPDATE "aplicaciones_cupon" AS a
SET "reserva_hasta" = r."vencimiento"
FROM (
  SELECT i."pedido_venta_id", MIN(res."fecha_expiracion") AS "vencimiento"
  FROM "pedido_venta_items" AS i
  JOIN "reservas" AS res ON res."id" = i."reserva_id"
  WHERE i."is_active" = true
  GROUP BY i."pedido_venta_id"
) AS r
WHERE a."pedido_venta_id" = r."pedido_venta_id"
  AND a."confirmada" = false
  AND a."is_active" = true
  AND a."deleted_at" IS NULL;
