-- CreateEnum
CREATE TYPE "EstadoUsuario" AS ENUM ('ACTIVO', 'SUSPENDIDO', 'BLOQUEADO', 'INACTIVO');

-- CreateEnum
CREATE TYPE "TipoMovimiento" AS ENUM ('INGRESO', 'EGRESO', 'TRANSFERENCIA', 'AJUSTE');

-- CreateTable
CREATE TABLE "usuarios" (
    "id" TEXT NOT NULL,
    "nombre_usuario" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "password_salt" TEXT NOT NULL,
    "nombre_completo" TEXT NOT NULL,
    "estado" "EstadoUsuario" NOT NULL DEFAULT 'ACTIVO',
    "intentos_fallidos" INTEGER NOT NULL DEFAULT 0,
    "bloqueado_hasta" TIMESTAMP(3),
    "ultimo_login" TIMESTAMP(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" TEXT,
    "deletion_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" TEXT,
    "deletion_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permisos" (
    "id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "descripcion" TEXT,
    "modulo" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" TEXT,
    "deletion_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "permisos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usuario_roles" (
    "id" TEXT NOT NULL,
    "usuario_id" TEXT NOT NULL,
    "rol_id" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" TEXT,
    "deletion_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "usuario_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rol_permisos" (
    "id" TEXT NOT NULL,
    "rol_id" TEXT NOT NULL,
    "permiso_id" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" TEXT,
    "deletion_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rol_permisos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "usuario_id" TEXT,
    "accion" TEXT NOT NULL,
    "tabla_afectada" TEXT NOT NULL,
    "registro_id" TEXT,
    "ip" TEXT NOT NULL,
    "valor_anterior" JSONB,
    "valor_nuevo" JSONB,
    "hash_anterior" TEXT NOT NULL,
    "hash_actual" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sesiones" (
    "id" TEXT NOT NULL,
    "usuario_id" TEXT NOT NULL,
    "jwt_id" TEXT NOT NULL,
    "ip_origen" TEXT NOT NULL,
    "user_agent" TEXT,
    "emitida_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expira_en" TIMESTAMP(3) NOT NULL,
    "revocada" BOOLEAN NOT NULL DEFAULT false,
    "revocada_en" TIMESTAMP(3),
    "revocada_motivo" TEXT,

    CONSTRAINT "sesiones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "productos_maestros" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "rubro" TEXT NOT NULL,
    "categoria" TEXT NOT NULL,
    "unidad_medida" TEXT NOT NULL,
    "descripcion" TEXT,
    "proveedor_preferente" TEXT,
    "costo_estandar_referencia" DECIMAL(10,2) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" TEXT,
    "deletion_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "productos_maestros_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "variantes_sku" (
    "id" TEXT NOT NULL,
    "producto_maestro_id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "ean_qr" TEXT NOT NULL,
    "talle" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "genero" TEXT NOT NULL,
    "modelo" TEXT NOT NULL,
    "proveedor_id" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" TEXT,
    "deletion_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "variantes_sku_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "depositos" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "direccion" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" TEXT,
    "deletion_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "depositos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_depositos" (
    "id" TEXT NOT NULL,
    "variante_sku_id" TEXT NOT NULL,
    "deposito_id" TEXT NOT NULL,
    "cantidad" INTEGER NOT NULL DEFAULT 0,
    "punto_pedido" INTEGER NOT NULL DEFAULT 0,
    "stock_seguridad" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" TEXT,
    "deletion_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_depositos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "movimientos_stock" (
    "id" TEXT NOT NULL,
    "variante_sku_id" TEXT NOT NULL,
    "deposito_origen_id" TEXT,
    "deposito_destino_id" TEXT,
    "tipo_movimiento" "TipoMovimiento" NOT NULL,
    "estado_origen" TEXT,
    "estado_destino" TEXT,
    "cantidad" INTEGER NOT NULL,
    "comprobante_referencia" TEXT,
    "registrado_por_id" TEXT NOT NULL,
    "venta_id" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" TEXT,
    "deletion_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "movimientos_stock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "legajos_prueba" (
    "id" TEXT NOT NULL,
    "variante_sku_id" TEXT NOT NULL,
    "registrado_por_id" TEXT NOT NULL,
    "efectivo_placa" TEXT NOT NULL,
    "efectivo_organismo" TEXT NOT NULL,
    "fecha_inicio_prueba" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fecha_fin_prueba" TIMESTAMP(3),
    "cliente_id" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" TEXT,
    "deletion_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "legajos_prueba_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_nombre_usuario_key" ON "usuarios"("nombre_usuario");

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_email_key" ON "usuarios"("email");

-- CreateIndex
CREATE UNIQUE INDEX "roles_nombre_key" ON "roles"("nombre");

-- CreateIndex
CREATE UNIQUE INDEX "permisos_codigo_key" ON "permisos"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "usuario_roles_usuario_id_rol_id_key" ON "usuario_roles"("usuario_id", "rol_id");

-- CreateIndex
CREATE UNIQUE INDEX "rol_permisos_rol_id_permiso_id_key" ON "rol_permisos"("rol_id", "permiso_id");

-- CreateIndex
CREATE UNIQUE INDEX "audit_logs_hash_actual_key" ON "audit_logs"("hash_actual");

-- CreateIndex
CREATE UNIQUE INDEX "sesiones_jwt_id_key" ON "sesiones"("jwt_id");

-- CreateIndex
CREATE INDEX "sesiones_usuario_id_idx" ON "sesiones"("usuario_id");

-- CreateIndex
CREATE INDEX "sesiones_jwt_id_idx" ON "sesiones"("jwt_id");

-- CreateIndex
CREATE UNIQUE INDEX "variantes_sku_sku_key" ON "variantes_sku"("sku");

-- CreateIndex
CREATE UNIQUE INDEX "variantes_sku_ean_qr_key" ON "variantes_sku"("ean_qr");

-- CreateIndex
CREATE UNIQUE INDEX "depositos_nombre_key" ON "depositos"("nombre");

-- CreateIndex
CREATE UNIQUE INDEX "stock_depositos_variante_sku_id_deposito_id_key" ON "stock_depositos"("variante_sku_id", "deposito_id");

-- AddForeignKey
ALTER TABLE "usuario_roles" ADD CONSTRAINT "usuario_roles_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usuario_roles" ADD CONSTRAINT "usuario_roles_rol_id_fkey" FOREIGN KEY ("rol_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rol_permisos" ADD CONSTRAINT "rol_permisos_rol_id_fkey" FOREIGN KEY ("rol_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rol_permisos" ADD CONSTRAINT "rol_permisos_permiso_id_fkey" FOREIGN KEY ("permiso_id") REFERENCES "permisos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sesiones" ADD CONSTRAINT "sesiones_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variantes_sku" ADD CONSTRAINT "variantes_sku_producto_maestro_id_fkey" FOREIGN KEY ("producto_maestro_id") REFERENCES "productos_maestros"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_depositos" ADD CONSTRAINT "stock_depositos_variante_sku_id_fkey" FOREIGN KEY ("variante_sku_id") REFERENCES "variantes_sku"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_depositos" ADD CONSTRAINT "stock_depositos_deposito_id_fkey" FOREIGN KEY ("deposito_id") REFERENCES "depositos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos_stock" ADD CONSTRAINT "movimientos_stock_variante_sku_id_fkey" FOREIGN KEY ("variante_sku_id") REFERENCES "variantes_sku"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos_stock" ADD CONSTRAINT "movimientos_stock_deposito_origen_id_fkey" FOREIGN KEY ("deposito_origen_id") REFERENCES "depositos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos_stock" ADD CONSTRAINT "movimientos_stock_deposito_destino_id_fkey" FOREIGN KEY ("deposito_destino_id") REFERENCES "depositos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos_stock" ADD CONSTRAINT "movimientos_stock_registrado_por_id_fkey" FOREIGN KEY ("registrado_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legajos_prueba" ADD CONSTRAINT "legajos_prueba_variante_sku_id_fkey" FOREIGN KEY ("variante_sku_id") REFERENCES "variantes_sku"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legajos_prueba" ADD CONSTRAINT "legajos_prueba_registrado_por_id_fkey" FOREIGN KEY ("registrado_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
