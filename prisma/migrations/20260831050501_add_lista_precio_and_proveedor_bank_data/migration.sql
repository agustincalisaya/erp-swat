-- AlterTable
ALTER TABLE "proveedores" ADD COLUMN     "datos_bancarios_cifrado" TEXT,
ADD COLUMN     "datos_bancarios_iv" TEXT;

-- CreateTable
CREATE TABLE "listas_precio" (
    "id" TEXT NOT NULL,
    "proveedor_id" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" TEXT,
    "deletion_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "listas_precio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "listas_precio_version" (
    "id" TEXT NOT NULL,
    "lista_precio_id" TEXT NOT NULL,
    "fecha_inicio_vigencia" TIMESTAMP(3) NOT NULL,
    "variacion_porcentual_maxima" DECIMAL(5,2) NOT NULL,
    "requiere_aprobacion" BOOLEAN NOT NULL DEFAULT false,
    "publicada" BOOLEAN NOT NULL DEFAULT true,
    "aprobada_por_id" TEXT,
    "aprobada_at" TIMESTAMP(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" TEXT,
    "deletion_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "listas_precio_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "listas_precio_item" (
    "id" TEXT NOT NULL,
    "lista_precio_version_id" TEXT NOT NULL,
    "variante_sku_id" TEXT NOT NULL,
    "precio_unitario" DECIMAL(10,2) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" TEXT,
    "deletion_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "listas_precio_item_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "listas_precio_proveedor_id_idx" ON "listas_precio"("proveedor_id");

-- CreateIndex
CREATE INDEX "listas_precio_version_lista_precio_id_publicada_fecha_inici_idx" ON "listas_precio_version"("lista_precio_id", "publicada", "fecha_inicio_vigencia");

-- CreateIndex
CREATE INDEX "listas_precio_item_variante_sku_id_idx" ON "listas_precio_item"("variante_sku_id");

-- AddForeignKey
ALTER TABLE "listas_precio" ADD CONSTRAINT "listas_precio_proveedor_id_fkey" FOREIGN KEY ("proveedor_id") REFERENCES "proveedores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listas_precio_version" ADD CONSTRAINT "listas_precio_version_lista_precio_id_fkey" FOREIGN KEY ("lista_precio_id") REFERENCES "listas_precio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listas_precio_version" ADD CONSTRAINT "listas_precio_version_aprobada_por_id_fkey" FOREIGN KEY ("aprobada_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listas_precio_item" ADD CONSTRAINT "listas_precio_item_lista_precio_version_id_fkey" FOREIGN KEY ("lista_precio_version_id") REFERENCES "listas_precio_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listas_precio_item" ADD CONSTRAINT "listas_precio_item_variante_sku_id_fkey" FOREIGN KEY ("variante_sku_id") REFERENCES "variantes_sku"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
