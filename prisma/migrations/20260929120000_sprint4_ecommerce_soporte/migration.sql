-- CreateEnum
CREATE TYPE "CanalVenta" AS ENUM ('MOSTRADOR', 'WEB');

-- CreateEnum
CREATE TYPE "EstadoEcommerce" AS ENUM ('PAGO_PENDIENTE', 'PAGO_CONFIRMADO', 'PAGO_RECHAZADO', 'EN_PREPARACION', 'LISTO_PARA_RETIRO', 'ENTREGADO', 'ANULADO', 'CANCELADO', 'VENCIDO_SIN_RETIRO');

-- CreateEnum
CREATE TYPE "EntornoConectorPago" AS ENUM ('SANDBOX', 'PRODUCCION');

-- CreateEnum
CREATE TYPE "EstadoConectorPago" AS ENUM ('ACTIVO', 'INACTIVO');

-- CreateEnum
CREATE TYPE "PrioridadNotificacion" AS ENUM ('CRITICA', 'ADVERTENCIA', 'INFORMATIVA');

-- DropIndex
DROP INDEX "reservas_is_active_fecha_fin_reserva_fecha_inicio_reserva_idx";

-- AlterTable
-- HU-A10 Rev. 3 (spec_modulo_A.md §2.9): se agrega nullable, se backfillea y
-- recién después se fuerza NOT NULL. Backfill de TODAS las filas (activas y
-- ya cerradas) con el mismo umbral fijo de 72h que el cron venía aplicando,
-- para no cambiar retroactivamente el comportamiento de ninguna reserva.
ALTER TABLE "reservas" ADD COLUMN     "fecha_expiracion" TIMESTAMP(3);

UPDATE "reservas"
SET "fecha_expiracion" = "fecha_inicio_reserva" + INTERVAL '72 hours'
WHERE "fecha_expiracion" IS NULL;

ALTER TABLE "reservas" ALTER COLUMN "fecha_expiracion" SET NOT NULL;

-- AlterTable
ALTER TABLE "pedidos_venta" ADD COLUMN     "canal" "CanalVenta" NOT NULL DEFAULT 'MOSTRADOR';

-- CreateTable
CREATE TABLE "configuraciones_sistema" (
    "id" TEXT NOT NULL,
    "clave" TEXT NOT NULL,
    "valor" TEXT NOT NULL,
    "descripcion" TEXT,
    "modulo" TEXT NOT NULL,
    "actualizado_por_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "configuraciones_sistema_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "listas_precio_venta" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL DEFAULT 'Lista de Precios de Venta — General',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" TEXT,
    "deletion_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "listas_precio_venta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "versiones_lista_precio_venta" (
    "id" TEXT NOT NULL,
    "lista_id" TEXT NOT NULL,
    "vigente_desde" TIMESTAMP(3) NOT NULL,
    "publicado_por_id" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" TEXT,
    "deletion_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "versiones_lista_precio_venta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "items_lista_precio_venta" (
    "id" TEXT NOT NULL,
    "version_id" TEXT NOT NULL,
    "variante_sku_id" TEXT NOT NULL,
    "precio_venta" DECIMAL(12,2) NOT NULL,
    "costo_reposicion_referencia" DECIMAL(12,2),
    "confirmado_bajo_costo" BOOLEAN NOT NULL DEFAULT false,
    "motivo_bajo_costo" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" TEXT,
    "deletion_reason" TEXT,

    CONSTRAINT "items_lista_precio_venta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingresos_tesoreria" (
    "id" TEXT NOT NULL,
    "pedido_venta_id" TEXT NOT NULL,
    "mercadopago_payment_id" TEXT NOT NULL,
    "monto" DECIMAL(12,2) NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'PENDIENTE_CONCILIACION',
    "caja_virtual" TEXT NOT NULL DEFAULT 'MERCADO_PAGO_CANAL_WEB',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ingresos_tesoreria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contra_asientos_ingreso" (
    "id" TEXT NOT NULL,
    "ingreso_original_id" TEXT NOT NULL,
    "pedido_venta_id" TEXT NOT NULL,
    "monto" DECIMAL(12,2) NOT NULL,
    "motivo" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contra_asientos_ingreso_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "carritos_web" (
    "id" TEXT NOT NULL,
    "carrito_token" TEXT,
    "cuenta_cliente_web_id" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" TEXT,
    "deletion_reason" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "carritos_web_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "items_carrito_web" (
    "id" TEXT NOT NULL,
    "carrito_id" TEXT NOT NULL,
    "variante_sku_id" TEXT NOT NULL,
    "cantidad" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" TEXT,
    "deletion_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "items_carrito_web_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pedidos_venta_ecommerce" (
    "id" TEXT NOT NULL,
    "pedido_venta_id" TEXT NOT NULL,
    "estado_ecommerce" "EstadoEcommerce" NOT NULL DEFAULT 'PAGO_PENDIENTE',
    "mercadopago_payment_id" TEXT,
    "cupon_aplicacion_id" TEXT,
    "codigo_qr_retiro" TEXT,
    "plazo_retiro_vencimiento" TIMESTAMP(3),
    "operador_asignado_id" TEXT,
    "prioridad_manual" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" TEXT,
    "deletion_reason" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pedidos_venta_ecommerce_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cupones_descuento" (
    "id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "tipo_beneficio" TEXT NOT NULL,
    "valor" DECIMAL(12,2) NOT NULL,
    "vigente_desde" TIMESTAMP(3) NOT NULL,
    "vigente_hasta" TIMESTAMP(3) NOT NULL,
    "limite_uso_global" INTEGER,
    "limite_uso_por_cliente" INTEGER NOT NULL DEFAULT 1,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" TEXT,
    "deletion_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cupones_descuento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "aplicaciones_cupon" (
    "id" TEXT NOT NULL,
    "cupon_id" TEXT NOT NULL,
    "pedido_venta_id" TEXT NOT NULL,
    "cliente_id" TEXT NOT NULL,
    "monto_descontado" DECIMAL(12,2) NOT NULL,
    "confirmada" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" TEXT,
    "deletion_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "aplicaciones_cupon_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contenidos_producto_web" (
    "id" TEXT NOT NULL,
    "producto_maestro_id" TEXT NOT NULL,
    "titulo_comercial" TEXT NOT NULL,
    "descripcion" TEXT NOT NULL,
    "visibilidad_web" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" TEXT,
    "deletion_reason" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contenidos_producto_web_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fotos_producto_web" (
    "id" TEXT NOT NULL,
    "producto_web_contenido_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "es_principal" BOOLEAN NOT NULL DEFAULT false,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" TEXT,
    "deletion_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fotos_producto_web_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cuentas_cliente_web" (
    "id" TEXT NOT NULL,
    "cliente_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "token_version" INTEGER NOT NULL DEFAULT 0,
    "intentos_fallidos" INTEGER NOT NULL DEFAULT 0,
    "bloqueada_hasta" TIMESTAMP(3),
    "vinculacion_pendiente" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" TEXT,
    "deletion_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cuentas_cliente_web_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "log_transacciones_pago" (
    "id" TEXT NOT NULL,
    "pedido_venta_ecommerce_id" TEXT NOT NULL,
    "mercadopago_payment_id" TEXT NOT NULL,
    "monto" DECIMAL(12,2) NOT NULL,
    "estado_pago" TEXT NOT NULL,
    "resultado_webhook" TEXT NOT NULL,
    "datos_facturacion_cifrados" TEXT NOT NULL,
    "datos_facturacion_iv" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "log_transacciones_pago_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conectores_pago" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "entorno" "EntornoConectorPago" NOT NULL,
    "estado" "EstadoConectorPago" NOT NULL DEFAULT 'INACTIVO',
    "access_token_cifrado" TEXT NOT NULL,
    "access_token_iv" TEXT NOT NULL,
    "public_key_cifrada" TEXT NOT NULL,
    "public_key_iv" TEXT NOT NULL,
    "webhook_secret_cifrado" TEXT NOT NULL,
    "webhook_secret_iv" TEXT NOT NULL,
    "ultimo_health_check_exitoso_at" TIMESTAMP(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" TEXT,
    "deletion_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conectores_pago_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invocaciones_conector_pago" (
    "id" TEXT NOT NULL,
    "conector_id" TEXT NOT NULL,
    "operacion" TEXT NOT NULL,
    "exitosa" BOOLEAN NOT NULL,
    "detalle_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invocaciones_conector_pago_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "log_webhooks_pago" (
    "id" TEXT NOT NULL,
    "mercadopago_payment_id" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "log_webhooks_pago_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plantillas_notificacion" (
    "id" TEXT NOT NULL,
    "tipo_evento" TEXT NOT NULL,
    "asunto" TEXT NOT NULL,
    "cuerpo" TEXT NOT NULL,
    "prioridad_default" "PrioridadNotificacion" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" TEXT,
    "deletion_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plantillas_notificacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notificaciones" (
    "id" TEXT NOT NULL,
    "plantilla_id" TEXT,
    "tipo_evento" TEXT NOT NULL,
    "asunto" TEXT NOT NULL,
    "cuerpo" TEXT NOT NULL,
    "prioridad" "PrioridadNotificacion" NOT NULL,
    "clave_idempotencia" TEXT NOT NULL,
    "usuario_destinatario_id" TEXT,
    "cuenta_cliente_web_destinatario_id" TEXT,
    "leida_at" TIMESTAMP(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" TEXT,
    "deletion_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notificaciones_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "configuraciones_sistema_clave_key" ON "configuraciones_sistema"("clave");

-- CreateIndex
CREATE INDEX "versiones_lista_precio_venta_lista_id_vigente_desde_idx" ON "versiones_lista_precio_venta"("lista_id", "vigente_desde");

-- CreateIndex
CREATE UNIQUE INDEX "items_lista_precio_venta_version_id_variante_sku_id_key" ON "items_lista_precio_venta"("version_id", "variante_sku_id");

-- CreateIndex
CREATE UNIQUE INDEX "ingresos_tesoreria_pedido_venta_id_key" ON "ingresos_tesoreria"("pedido_venta_id");

-- CreateIndex
CREATE UNIQUE INDEX "ingresos_tesoreria_mercadopago_payment_id_key" ON "ingresos_tesoreria"("mercadopago_payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "contra_asientos_ingreso_pedido_venta_id_key" ON "contra_asientos_ingreso"("pedido_venta_id");

-- CreateIndex
CREATE INDEX "contra_asientos_ingreso_ingreso_original_id_idx" ON "contra_asientos_ingreso"("ingreso_original_id");

-- CreateIndex
CREATE UNIQUE INDEX "carritos_web_carrito_token_key" ON "carritos_web"("carrito_token");

-- CreateIndex
CREATE UNIQUE INDEX "carritos_web_cuenta_cliente_web_id_key" ON "carritos_web"("cuenta_cliente_web_id");

-- CreateIndex
CREATE UNIQUE INDEX "items_carrito_web_carrito_id_variante_sku_id_key" ON "items_carrito_web"("carrito_id", "variante_sku_id");

-- CreateIndex
CREATE UNIQUE INDEX "pedidos_venta_ecommerce_pedido_venta_id_key" ON "pedidos_venta_ecommerce"("pedido_venta_id");

-- CreateIndex
CREATE UNIQUE INDEX "pedidos_venta_ecommerce_cupon_aplicacion_id_key" ON "pedidos_venta_ecommerce"("cupon_aplicacion_id");

-- CreateIndex
CREATE UNIQUE INDEX "pedidos_venta_ecommerce_codigo_qr_retiro_key" ON "pedidos_venta_ecommerce"("codigo_qr_retiro");

-- CreateIndex
CREATE UNIQUE INDEX "cupones_descuento_codigo_key" ON "cupones_descuento"("codigo");

-- CreateIndex
CREATE INDEX "aplicaciones_cupon_cupon_id_confirmada_idx" ON "aplicaciones_cupon"("cupon_id", "confirmada");

-- CreateIndex
CREATE INDEX "aplicaciones_cupon_cupon_id_cliente_id_idx" ON "aplicaciones_cupon"("cupon_id", "cliente_id");

-- CreateIndex
CREATE INDEX "aplicaciones_cupon_pedido_venta_id_idx" ON "aplicaciones_cupon"("pedido_venta_id");

-- CreateIndex
CREATE UNIQUE INDEX "contenidos_producto_web_producto_maestro_id_key" ON "contenidos_producto_web"("producto_maestro_id");

-- CreateIndex
CREATE INDEX "fotos_producto_web_producto_web_contenido_id_idx" ON "fotos_producto_web"("producto_web_contenido_id");

-- CreateIndex
CREATE UNIQUE INDEX "cuentas_cliente_web_cliente_id_key" ON "cuentas_cliente_web"("cliente_id");

-- CreateIndex
CREATE UNIQUE INDEX "cuentas_cliente_web_email_key" ON "cuentas_cliente_web"("email");

-- CreateIndex
CREATE INDEX "log_transacciones_pago_pedido_venta_ecommerce_id_idx" ON "log_transacciones_pago"("pedido_venta_ecommerce_id");

-- CreateIndex
CREATE INDEX "log_transacciones_pago_mercadopago_payment_id_idx" ON "log_transacciones_pago"("mercadopago_payment_id");

-- CreateIndex
CREATE INDEX "conectores_pago_entorno_estado_is_active_idx" ON "conectores_pago"("entorno", "estado", "is_active");

-- CreateIndex
CREATE INDEX "invocaciones_conector_pago_conector_id_created_at_idx" ON "invocaciones_conector_pago"("conector_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "log_webhooks_pago_mercadopago_payment_id_topic_key" ON "log_webhooks_pago"("mercadopago_payment_id", "topic");

-- CreateIndex
CREATE UNIQUE INDEX "plantillas_notificacion_tipo_evento_key" ON "plantillas_notificacion"("tipo_evento");

-- CreateIndex
CREATE UNIQUE INDEX "notificaciones_clave_idempotencia_key" ON "notificaciones"("clave_idempotencia");

-- CreateIndex
CREATE INDEX "notificaciones_usuario_destinatario_id_is_active_leida_at_idx" ON "notificaciones"("usuario_destinatario_id", "is_active", "leida_at");

-- CreateIndex
CREATE INDEX "notificaciones_cuenta_cliente_web_destinatario_id_is_active_idx" ON "notificaciones"("cuenta_cliente_web_destinatario_id", "is_active", "leida_at");

-- CreateIndex
CREATE INDEX "reservas_is_active_fecha_fin_reserva_fecha_expiracion_idx" ON "reservas"("is_active", "fecha_fin_reserva", "fecha_expiracion");

-- AddForeignKey
ALTER TABLE "configuraciones_sistema" ADD CONSTRAINT "configuraciones_sistema_actualizado_por_id_fkey" FOREIGN KEY ("actualizado_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "versiones_lista_precio_venta" ADD CONSTRAINT "versiones_lista_precio_venta_lista_id_fkey" FOREIGN KEY ("lista_id") REFERENCES "listas_precio_venta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "versiones_lista_precio_venta" ADD CONSTRAINT "versiones_lista_precio_venta_publicado_por_id_fkey" FOREIGN KEY ("publicado_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "items_lista_precio_venta" ADD CONSTRAINT "items_lista_precio_venta_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "versiones_lista_precio_venta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "items_lista_precio_venta" ADD CONSTRAINT "items_lista_precio_venta_variante_sku_id_fkey" FOREIGN KEY ("variante_sku_id") REFERENCES "variantes_sku"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingresos_tesoreria" ADD CONSTRAINT "ingresos_tesoreria_pedido_venta_id_fkey" FOREIGN KEY ("pedido_venta_id") REFERENCES "pedidos_venta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contra_asientos_ingreso" ADD CONSTRAINT "contra_asientos_ingreso_ingreso_original_id_fkey" FOREIGN KEY ("ingreso_original_id") REFERENCES "ingresos_tesoreria"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contra_asientos_ingreso" ADD CONSTRAINT "contra_asientos_ingreso_pedido_venta_id_fkey" FOREIGN KEY ("pedido_venta_id") REFERENCES "pedidos_venta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "carritos_web" ADD CONSTRAINT "carritos_web_cuenta_cliente_web_id_fkey" FOREIGN KEY ("cuenta_cliente_web_id") REFERENCES "cuentas_cliente_web"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "items_carrito_web" ADD CONSTRAINT "items_carrito_web_carrito_id_fkey" FOREIGN KEY ("carrito_id") REFERENCES "carritos_web"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "items_carrito_web" ADD CONSTRAINT "items_carrito_web_variante_sku_id_fkey" FOREIGN KEY ("variante_sku_id") REFERENCES "variantes_sku"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedidos_venta_ecommerce" ADD CONSTRAINT "pedidos_venta_ecommerce_pedido_venta_id_fkey" FOREIGN KEY ("pedido_venta_id") REFERENCES "pedidos_venta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedidos_venta_ecommerce" ADD CONSTRAINT "pedidos_venta_ecommerce_cupon_aplicacion_id_fkey" FOREIGN KEY ("cupon_aplicacion_id") REFERENCES "aplicaciones_cupon"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedidos_venta_ecommerce" ADD CONSTRAINT "pedidos_venta_ecommerce_operador_asignado_id_fkey" FOREIGN KEY ("operador_asignado_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aplicaciones_cupon" ADD CONSTRAINT "aplicaciones_cupon_cupon_id_fkey" FOREIGN KEY ("cupon_id") REFERENCES "cupones_descuento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aplicaciones_cupon" ADD CONSTRAINT "aplicaciones_cupon_pedido_venta_id_fkey" FOREIGN KEY ("pedido_venta_id") REFERENCES "pedidos_venta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aplicaciones_cupon" ADD CONSTRAINT "aplicaciones_cupon_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contenidos_producto_web" ADD CONSTRAINT "contenidos_producto_web_producto_maestro_id_fkey" FOREIGN KEY ("producto_maestro_id") REFERENCES "productos_maestros"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fotos_producto_web" ADD CONSTRAINT "fotos_producto_web_producto_web_contenido_id_fkey" FOREIGN KEY ("producto_web_contenido_id") REFERENCES "contenidos_producto_web"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cuentas_cliente_web" ADD CONSTRAINT "cuentas_cliente_web_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "log_transacciones_pago" ADD CONSTRAINT "log_transacciones_pago_pedido_venta_ecommerce_id_fkey" FOREIGN KEY ("pedido_venta_ecommerce_id") REFERENCES "pedidos_venta_ecommerce"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invocaciones_conector_pago" ADD CONSTRAINT "invocaciones_conector_pago_conector_id_fkey" FOREIGN KEY ("conector_id") REFERENCES "conectores_pago"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notificaciones" ADD CONSTRAINT "notificaciones_plantilla_id_fkey" FOREIGN KEY ("plantilla_id") REFERENCES "plantillas_notificacion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notificaciones" ADD CONSTRAINT "notificaciones_usuario_destinatario_id_fkey" FOREIGN KEY ("usuario_destinatario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notificaciones" ADD CONSTRAINT "notificaciones_cuenta_cliente_web_destinatario_id_fkey" FOREIGN KEY ("cuenta_cliente_web_destinatario_id") REFERENCES "cuentas_cliente_web"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- HU-F3: el destinatario de una Notificacion es exactamente uno —
-- personal interno (Usuario) o Cliente Web (CuentaClienteWeb). Prisma no
-- modela CHECK constraints; se agrega a mano y no lo pisa ningún diff futuro.
ALTER TABLE "notificaciones" ADD CONSTRAINT "notificaciones_destinatario_unico_chk"
CHECK (
    ("usuario_destinatario_id" IS NOT NULL)::int
  + ("cuenta_cliente_web_destinatario_id" IS NOT NULL)::int = 1
);
