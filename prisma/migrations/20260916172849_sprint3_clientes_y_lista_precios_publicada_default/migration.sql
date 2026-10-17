-- CreateEnum
CREATE TYPE "SegmentoComercial" AS ENUM ('MINORISTA', 'MAYORISTA', 'CLIENTE_FRECUENTE');

-- CreateEnum
CREATE TYPE "CanalContacto" AS ENUM ('WHATSAPP', 'EMAIL', 'AMBOS');

-- CreateEnum
CREATE TYPE "TipoDireccionCliente" AS ENUM ('FACTURACION', 'ENVIO');

-- CreateEnum
CREATE TYPE "AlcanceConsentimiento" AS ENUM ('VENTA_ASISTIDA', 'COMUNICACIONES_COMERCIALES', 'AMBOS');

-- AlterTable
ALTER TABLE "listas_precio_version" ALTER COLUMN "publicada" SET DEFAULT false;

-- CreateTable
CREATE TABLE "clientes" (
    "id" TEXT NOT NULL,
    "dni" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "telefono" TEXT,
    "email" TEXT,
    "canal_preferido" "CanalContacto",
    "segmento" "SegmentoComercial" NOT NULL DEFAULT 'MINORISTA',
    "fusionado_en_id" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" TEXT,
    "deletion_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clientes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "direcciones_cliente" (
    "id" TEXT NOT NULL,
    "cliente_id" TEXT NOT NULL,
    "rotulo" TEXT NOT NULL,
    "tipo" "TipoDireccionCliente" NOT NULL,
    "direccion_completa" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" TEXT,
    "deletion_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "direcciones_cliente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consentimientos_cliente" (
    "id" TEXT NOT NULL,
    "cliente_id" TEXT NOT NULL,
    "alcance" "AlcanceConsentimiento" NOT NULL,
    "finalidad" TEXT NOT NULL,
    "fecha_consentimiento" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" TEXT,
    "deletion_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "consentimientos_cliente_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "clientes_dni_key" ON "clientes"("dni");

-- CreateIndex
CREATE INDEX "direcciones_cliente_cliente_id_idx" ON "direcciones_cliente"("cliente_id");

-- CreateIndex
CREATE INDEX "consentimientos_cliente_cliente_id_idx" ON "consentimientos_cliente"("cliente_id");

-- AddForeignKey
ALTER TABLE "clientes" ADD CONSTRAINT "clientes_fusionado_en_id_fkey" FOREIGN KEY ("fusionado_en_id") REFERENCES "clientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "direcciones_cliente" ADD CONSTRAINT "direcciones_cliente_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consentimientos_cliente" ADD CONSTRAINT "consentimientos_cliente_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
