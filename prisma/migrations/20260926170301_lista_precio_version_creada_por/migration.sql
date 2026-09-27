-- AlterTable
ALTER TABLE "listas_precio_version" ADD COLUMN     "creada_por_id" TEXT;

-- AddForeignKey
ALTER TABLE "listas_precio_version" ADD CONSTRAINT "listas_precio_version_creada_por_id_fkey" FOREIGN KEY ("creada_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
