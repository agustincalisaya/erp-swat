-- CreateEnum
CREATE TYPE "EstadoPresupuesto" AS ENUM ('BORRADOR', 'EMITIDO', 'VENCIDO');

-- CreateEnum
CREATE TYPE "EstadoPedidoVenta" AS ENUM ('RESERVADO', 'FACTURADO', 'REMITO_EMITIDO', 'CERRADO', 'ANULADO');

-- CreateEnum
CREATE TYPE "MedioPagoVenta" AS ENUM ('EFECTIVO', 'TRANSFERENCIA', 'E_CHEQ', 'MERCADO_PAGO', 'TARJETA', 'CUENTA_CORRIENTE');

-- CreateEnum
CREATE TYPE "TipoComprobanteVenta" AS ENUM ('FACTURA_A', 'FACTURA_B', 'TICKET');

-- CreateEnum
CREATE TYPE "EstadoOperacionCC" AS ENUM ('APROBADA', 'RETENIDA', 'RECHAZADA');

-- CreateTable
CREATE TABLE "presupuestos" (
    "id" TEXT NOT NULL,
    "cliente_id" TEXT NOT NULL,
    "estado" "EstadoPresupuesto" NOT NULL DEFAULT 'BORRADOR',
    "vigencia_dias" INTEGER NOT NULL,
    "vigencia_hasta" TIMESTAMP(3),
    "condiciones_comerciales" TEXT,
    "creado_por_id" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" TEXT,
    "deletion_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "presupuestos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "presupuesto_items" (
    "id" TEXT NOT NULL,
    "presupuesto_id" TEXT NOT NULL,
    "variante_sku_id" TEXT NOT NULL,
    "cantidad" INTEGER NOT NULL,
    "precio_cotizado" DECIMAL(10,2) NOT NULL,
    "reserva_id" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" TEXT,
    "deletion_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "presupuesto_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pedidos_venta" (
    "id" TEXT NOT NULL,
    "numero_venta" TEXT NOT NULL,
    "cliente_id" TEXT,
    "presupuesto_origen_id" TEXT,
    "turno_caja_id" TEXT,
    "estado" "EstadoPedidoVenta" NOT NULL DEFAULT 'RESERVADO',
    "total" DECIMAL(12,2) NOT NULL,
    "fecha_facturacion" TIMESTAMP(3),
    "registrado_por_id" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" TEXT,
    "deletion_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pedidos_venta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pedido_venta_items" (
    "id" TEXT NOT NULL,
    "pedido_venta_id" TEXT NOT NULL,
    "variante_sku_id" TEXT NOT NULL,
    "cantidad" INTEGER NOT NULL,
    "precio_unitario" DECIMAL(10,2) NOT NULL,
    "descuento_porcentual" DECIMAL(5,2),
    "reserva_id" TEXT,
    "cantidad_facturada" INTEGER NOT NULL DEFAULT 0,
    "cantidad_entregada" INTEGER NOT NULL DEFAULT 0,
    "requiere_autorizacion" BOOLEAN NOT NULL DEFAULT false,
    "autorizado_por_id" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" TEXT,
    "deletion_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pedido_venta_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "turnos_caja" (
    "id" TEXT NOT NULL,
    "usuario_id" TEXT NOT NULL,
    "fondo_fijo_inicial" DECIMAL(12,2) NOT NULL,
    "fecha_apertura" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fecha_cierre" TIMESTAMP(3),
    "saldo_esperado" DECIMAL(12,2),
    "conteo_fisico_declarado" DECIMAL(12,2),
    "diferencia" DECIMAL(12,2),
    "justificacion" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" TEXT,
    "deletion_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "turnos_caja_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "venta_medios_pago" (
    "id" TEXT NOT NULL,
    "pedido_venta_id" TEXT NOT NULL,
    "medio" "MedioPagoVenta" NOT NULL,
    "importe" DECIMAL(12,2) NOT NULL,
    "referencia" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" TEXT,
    "deletion_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "venta_medios_pago_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comprobantes_fiscales" (
    "id" TEXT NOT NULL,
    "pedido_venta_id" TEXT NOT NULL,
    "tipo_comprobante" "TipoComprobanteVenta" NOT NULL,
    "cae_simulado" TEXT NOT NULL,
    "qr_data_url" TEXT NOT NULL,
    "es_simulado" BOOLEAN NOT NULL DEFAULT true,
    "monto_total" DECIMAL(12,2) NOT NULL,
    "emitido_por_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comprobantes_fiscales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cuentas_corrientes_cliente" (
    "id" TEXT NOT NULL,
    "cliente_id" TEXT NOT NULL,
    "limite_credito_autorizado" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "saldo_actual" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" TEXT,
    "deletion_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cuentas_corrientes_cliente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cuenta_corriente_operaciones" (
    "id" TEXT NOT NULL,
    "cuenta_corriente_id" TEXT NOT NULL,
    "pedido_venta_id" TEXT NOT NULL,
    "monto" DECIMAL(12,2) NOT NULL,
    "plan_de_pagos" JSONB,
    "estado" "EstadoOperacionCC" NOT NULL DEFAULT 'APROBADA',
    "autorizado_por_id" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" TEXT,
    "deletion_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cuenta_corriente_operaciones_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "presupuestos_cliente_id_idx" ON "presupuestos"("cliente_id");

-- CreateIndex
CREATE INDEX "presupuestos_estado_vigencia_hasta_idx" ON "presupuestos"("estado", "vigencia_hasta");

-- CreateIndex
CREATE UNIQUE INDEX "presupuesto_items_reserva_id_key" ON "presupuesto_items"("reserva_id");

-- CreateIndex
CREATE INDEX "presupuesto_items_presupuesto_id_idx" ON "presupuesto_items"("presupuesto_id");

-- CreateIndex
CREATE UNIQUE INDEX "pedidos_venta_numero_venta_key" ON "pedidos_venta"("numero_venta");

-- CreateIndex
CREATE UNIQUE INDEX "pedidos_venta_presupuesto_origen_id_key" ON "pedidos_venta"("presupuesto_origen_id");

-- CreateIndex
CREATE INDEX "pedidos_venta_cliente_id_estado_idx" ON "pedidos_venta"("cliente_id", "estado");

-- CreateIndex
CREATE INDEX "pedidos_venta_turno_caja_id_idx" ON "pedidos_venta"("turno_caja_id");

-- CreateIndex
CREATE UNIQUE INDEX "pedido_venta_items_reserva_id_key" ON "pedido_venta_items"("reserva_id");

-- CreateIndex
CREATE INDEX "pedido_venta_items_pedido_venta_id_idx" ON "pedido_venta_items"("pedido_venta_id");

-- CreateIndex
CREATE INDEX "turnos_caja_usuario_id_fecha_cierre_idx" ON "turnos_caja"("usuario_id", "fecha_cierre");

-- CreateIndex
CREATE INDEX "venta_medios_pago_pedido_venta_id_idx" ON "venta_medios_pago"("pedido_venta_id");

-- CreateIndex
CREATE INDEX "comprobantes_fiscales_pedido_venta_id_idx" ON "comprobantes_fiscales"("pedido_venta_id");

-- CreateIndex
CREATE UNIQUE INDEX "cuentas_corrientes_cliente_cliente_id_key" ON "cuentas_corrientes_cliente"("cliente_id");

-- CreateIndex
CREATE INDEX "cuenta_corriente_operaciones_cuenta_corriente_id_idx" ON "cuenta_corriente_operaciones"("cuenta_corriente_id");

-- CreateIndex
CREATE INDEX "cuenta_corriente_operaciones_pedido_venta_id_idx" ON "cuenta_corriente_operaciones"("pedido_venta_id");

-- AddForeignKey
ALTER TABLE "presupuestos" ADD CONSTRAINT "presupuestos_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "presupuestos" ADD CONSTRAINT "presupuestos_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "presupuesto_items" ADD CONSTRAINT "presupuesto_items_presupuesto_id_fkey" FOREIGN KEY ("presupuesto_id") REFERENCES "presupuestos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "presupuesto_items" ADD CONSTRAINT "presupuesto_items_variante_sku_id_fkey" FOREIGN KEY ("variante_sku_id") REFERENCES "variantes_sku"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "presupuesto_items" ADD CONSTRAINT "presupuesto_items_reserva_id_fkey" FOREIGN KEY ("reserva_id") REFERENCES "reservas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedidos_venta" ADD CONSTRAINT "pedidos_venta_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedidos_venta" ADD CONSTRAINT "pedidos_venta_presupuesto_origen_id_fkey" FOREIGN KEY ("presupuesto_origen_id") REFERENCES "presupuestos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedidos_venta" ADD CONSTRAINT "pedidos_venta_turno_caja_id_fkey" FOREIGN KEY ("turno_caja_id") REFERENCES "turnos_caja"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedidos_venta" ADD CONSTRAINT "pedidos_venta_registrado_por_id_fkey" FOREIGN KEY ("registrado_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedido_venta_items" ADD CONSTRAINT "pedido_venta_items_pedido_venta_id_fkey" FOREIGN KEY ("pedido_venta_id") REFERENCES "pedidos_venta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedido_venta_items" ADD CONSTRAINT "pedido_venta_items_variante_sku_id_fkey" FOREIGN KEY ("variante_sku_id") REFERENCES "variantes_sku"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedido_venta_items" ADD CONSTRAINT "pedido_venta_items_reserva_id_fkey" FOREIGN KEY ("reserva_id") REFERENCES "reservas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedido_venta_items" ADD CONSTRAINT "pedido_venta_items_autorizado_por_id_fkey" FOREIGN KEY ("autorizado_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "turnos_caja" ADD CONSTRAINT "turnos_caja_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "venta_medios_pago" ADD CONSTRAINT "venta_medios_pago_pedido_venta_id_fkey" FOREIGN KEY ("pedido_venta_id") REFERENCES "pedidos_venta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comprobantes_fiscales" ADD CONSTRAINT "comprobantes_fiscales_pedido_venta_id_fkey" FOREIGN KEY ("pedido_venta_id") REFERENCES "pedidos_venta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comprobantes_fiscales" ADD CONSTRAINT "comprobantes_fiscales_emitido_por_id_fkey" FOREIGN KEY ("emitido_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cuentas_corrientes_cliente" ADD CONSTRAINT "cuentas_corrientes_cliente_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cuenta_corriente_operaciones" ADD CONSTRAINT "cuenta_corriente_operaciones_cuenta_corriente_id_fkey" FOREIGN KEY ("cuenta_corriente_id") REFERENCES "cuentas_corrientes_cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cuenta_corriente_operaciones" ADD CONSTRAINT "cuenta_corriente_operaciones_pedido_venta_id_fkey" FOREIGN KEY ("pedido_venta_id") REFERENCES "pedidos_venta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cuenta_corriente_operaciones" ADD CONSTRAINT "cuenta_corriente_operaciones_autorizado_por_id_fkey" FOREIGN KEY ("autorizado_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
