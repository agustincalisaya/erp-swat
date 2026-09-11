-- CreateEnum
CREATE TYPE "OrigenReserva" AS ENUM ('SENIA', 'LICITACION', 'PEDIDO_INSTITUCIONAL');

-- CreateEnum
CREATE TYPE "EstadoProveedor" AS ENUM ('PENDIENTE', 'HOMOLOGADO', 'SUSPENDIDO');

-- CreateEnum
CREATE TYPE "EstadoOrdenCompra" AS ENUM ('BORRADOR', 'ENVIADA', 'CONFIRMADA', 'RECEPCION_PARCIAL', 'RECIBIDA_COMPLETA', 'CERRADA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "TipoDiscrepancia" AS ENUM ('CANTIDAD', 'TALLE', 'COLOR', 'CALIDAD');

-- CreateEnum
CREATE TYPE "EstadoCuentaPorPagar" AS ENUM ('PROVISORIO', 'DEFINITIVA', 'PAGADA', 'CANCELADA');

-- AlterTable
ALTER TABLE "reservas" ADD COLUMN     "origen_reserva" "OrigenReserva";

-- CreateTable
CREATE TABLE "proveedores" (
    "id" TEXT NOT NULL,
    "razon_social" TEXT NOT NULL,
    "nombre_fantasia" TEXT,
    "cuit" TEXT NOT NULL,
    "condiciones_pago" TEXT,
    "categorias" TEXT[],
    "estado" "EstadoProveedor" NOT NULL DEFAULT 'PENDIENTE',
    "contacto_nombre" TEXT,
    "contacto_email" TEXT,
    "contacto_telefono" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" TEXT,
    "deletion_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "proveedores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ordenes_compra" (
    "id" TEXT NOT NULL,
    "numero_orden" TEXT NOT NULL,
    "proveedor_id" TEXT NOT NULL,
    "estado" "EstadoOrdenCompra" NOT NULL DEFAULT 'BORRADOR',
    "fecha_emision" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fecha_envio" TIMESTAMP(3),
    "fecha_confirmacion" TIMESTAMP(3),
    "fecha_cierre" TIMESTAMP(3),
    "observaciones" TEXT,
    "creada_por_id" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" TEXT,
    "deletion_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ordenes_compra_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orden_compra_items" (
    "id" TEXT NOT NULL,
    "orden_compra_id" TEXT NOT NULL,
    "variante_sku_id" TEXT NOT NULL,
    "cantidad_solicitada" INTEGER NOT NULL,
    "precio_unitario" DECIMAL(10,2) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" TEXT,
    "deletion_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orden_compra_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recepciones" (
    "id" TEXT NOT NULL,
    "orden_compra_id" TEXT NOT NULL,
    "numero_remito_proveedor" TEXT,
    "fecha_recepcion" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recibida_por_id" TEXT NOT NULL,
    "observaciones" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" TEXT,
    "deletion_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recepciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recepcion_items" (
    "id" TEXT NOT NULL,
    "recepcion_id" TEXT NOT NULL,
    "orden_compra_item_id" TEXT NOT NULL,
    "cantidad_recibida" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" TEXT,
    "deletion_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recepcion_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recepcion_discrepancias" (
    "id" TEXT NOT NULL,
    "recepcion_item_id" TEXT NOT NULL,
    "tipo" "TipoDiscrepancia" NOT NULL,
    "detalle" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" TEXT,
    "deletion_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recepcion_discrepancias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evaluaciones_proveedor" (
    "id" TEXT NOT NULL,
    "proveedor_id" TEXT NOT NULL,
    "puntaje_cumplimiento_plazos" INTEGER NOT NULL,
    "puntaje_calidad_recepcion" INTEGER NOT NULL,
    "puntaje_documentacion" INTEGER NOT NULL,
    "puntaje_total" DECIMAL(5,2) NOT NULL,
    "devoluciones_fabricacion" INTEGER,
    "observaciones" TEXT,
    "evaluado_por_id" TEXT NOT NULL,
    "fecha_evaluacion" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" TEXT,
    "deletion_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "evaluaciones_proveedor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cuentas_por_pagar" (
    "id" TEXT NOT NULL,
    "orden_compra_id" TEXT NOT NULL,
    "recepcion_id" TEXT,
    "monto" DECIMAL(12,2) NOT NULL,
    "estado" "EstadoCuentaPorPagar" NOT NULL DEFAULT 'PROVISORIO',
    "fecha_vencimiento" TIMESTAMP(3),
    "fecha_pago" TIMESTAMP(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" TEXT,
    "deletion_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cuentas_por_pagar_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "proveedores_cuit_key" ON "proveedores"("cuit");

-- CreateIndex
CREATE INDEX "proveedores_estado_is_active_idx" ON "proveedores"("estado", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "ordenes_compra_numero_orden_key" ON "ordenes_compra"("numero_orden");

-- CreateIndex
CREATE INDEX "ordenes_compra_proveedor_id_estado_idx" ON "ordenes_compra"("proveedor_id", "estado");

-- CreateIndex
CREATE INDEX "ordenes_compra_estado_is_active_idx" ON "ordenes_compra"("estado", "is_active");

-- CreateIndex
CREATE INDEX "orden_compra_items_orden_compra_id_idx" ON "orden_compra_items"("orden_compra_id");

-- CreateIndex
CREATE INDEX "recepciones_orden_compra_id_idx" ON "recepciones"("orden_compra_id");

-- CreateIndex
CREATE INDEX "recepcion_items_recepcion_id_idx" ON "recepcion_items"("recepcion_id");

-- CreateIndex
CREATE INDEX "recepcion_discrepancias_tipo_idx" ON "recepcion_discrepancias"("tipo");

-- CreateIndex
CREATE INDEX "evaluaciones_proveedor_proveedor_id_fecha_evaluacion_idx" ON "evaluaciones_proveedor"("proveedor_id", "fecha_evaluacion");

-- CreateIndex
CREATE INDEX "cuentas_por_pagar_estado_is_active_idx" ON "cuentas_por_pagar"("estado", "is_active");

-- CreateIndex
CREATE INDEX "cuentas_por_pagar_orden_compra_id_estado_idx" ON "cuentas_por_pagar"("orden_compra_id", "estado");

-- AddForeignKey
ALTER TABLE "ordenes_compra" ADD CONSTRAINT "ordenes_compra_proveedor_id_fkey" FOREIGN KEY ("proveedor_id") REFERENCES "proveedores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ordenes_compra" ADD CONSTRAINT "ordenes_compra_creada_por_id_fkey" FOREIGN KEY ("creada_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orden_compra_items" ADD CONSTRAINT "orden_compra_items_orden_compra_id_fkey" FOREIGN KEY ("orden_compra_id") REFERENCES "ordenes_compra"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orden_compra_items" ADD CONSTRAINT "orden_compra_items_variante_sku_id_fkey" FOREIGN KEY ("variante_sku_id") REFERENCES "variantes_sku"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recepciones" ADD CONSTRAINT "recepciones_orden_compra_id_fkey" FOREIGN KEY ("orden_compra_id") REFERENCES "ordenes_compra"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recepciones" ADD CONSTRAINT "recepciones_recibida_por_id_fkey" FOREIGN KEY ("recibida_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recepcion_items" ADD CONSTRAINT "recepcion_items_recepcion_id_fkey" FOREIGN KEY ("recepcion_id") REFERENCES "recepciones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recepcion_items" ADD CONSTRAINT "recepcion_items_orden_compra_item_id_fkey" FOREIGN KEY ("orden_compra_item_id") REFERENCES "orden_compra_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recepcion_discrepancias" ADD CONSTRAINT "recepcion_discrepancias_recepcion_item_id_fkey" FOREIGN KEY ("recepcion_item_id") REFERENCES "recepcion_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluaciones_proveedor" ADD CONSTRAINT "evaluaciones_proveedor_proveedor_id_fkey" FOREIGN KEY ("proveedor_id") REFERENCES "proveedores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluaciones_proveedor" ADD CONSTRAINT "evaluaciones_proveedor_evaluado_por_id_fkey" FOREIGN KEY ("evaluado_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cuentas_por_pagar" ADD CONSTRAINT "cuentas_por_pagar_orden_compra_id_fkey" FOREIGN KEY ("orden_compra_id") REFERENCES "ordenes_compra"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cuentas_por_pagar" ADD CONSTRAINT "cuentas_por_pagar_recepcion_id_fkey" FOREIGN KEY ("recepcion_id") REFERENCES "recepciones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
