import { PrismaClient, TipoMovimiento } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * IDs fijos (no @default(uuid()) al insertar) para que el seed sea
 * idempotente vía `upsert` y para que
 * `src/app/(dashboard)/inventario/depositos/page.tsx` pueda referenciar
 * exactamente estos registros sin copiar/pegar el output de cada corrida.
 */
const USUARIO_SEED_ID = "8c682c21-d075-4665-9cd2-ed0285c80f91";
const PRODUCTO_MAESTRO_SEED_ID = "cccf5533-44b5-4ed2-99e5-0d29c20da167";
const VARIANTE_SKU_SEED_ID = "fadabd3f-991e-4e26-90f2-ad8cc97856c7";
const DEPOSITO_SEED_ID = "a61c8fe5-bac1-4c4f-a15a-9a2ff1c7c95a";
const STOCK_DEPOSITO_SEED_ID = "90bb1fa7-d5f4-40fa-aa0c-ffeab09082e6";
const MOVIMIENTO_EGRESO_1_ID = "a74c7b59-1d02-4d32-b839-205bd67f14ec";
const MOVIMIENTO_EGRESO_2_ID = "d0290236-d5b5-485f-9063-afe5e760548b";
const MOVIMIENTO_EGRESO_3_ID = "c7d4f09e-d987-4356-b052-121a67b14558";

function diasAtras(dias: number): Date {
  const fecha = new Date();
  fecha.setDate(fecha.getDate() - dias);
  return fecha;
}

async function main() {
  const usuario = await prisma.usuario.upsert({
    where: { id: USUARIO_SEED_ID },
    update: {},
    create: {
      id: USUARIO_SEED_ID,
      nombre_usuario: "seed.deposito",
      email: "seed.deposito@erp-swat.local",
      // Hash/salt de prueba: este usuario solo satisface la FK NOT NULL de
      // MovimientoStock.registrado_por_id en datos de seed. No es una
      // credencial real (lib/auth/password.ts todavía no está implementado).
      password_hash: "seed-only-not-a-real-hash",
      password_salt: "seed-only-not-a-real-salt",
      nombre_completo: "Usuario Seed (Encargado de Depósito)",
      is_active: true,
    },
  });

  const productoMaestro = await prisma.productoMaestro.upsert({
    where: { id: PRODUCTO_MAESTRO_SEED_ID },
    update: {},
    create: {
      id: PRODUCTO_MAESTRO_SEED_ID,
      nombre: "Camisa de Policía",
      rubro: "Indumentaria",
      categoria: "Camisas",
      unidad_medida: "UNIDAD",
      descripcion: "Camisa táctica reglamentaria — datos de prueba HU-7",
      costo_estandar_referencia: 12500.0,
      is_active: true,
    },
  });

  const varianteSku = await prisma.varianteSKU.upsert({
    where: { id: VARIANTE_SKU_SEED_ID },
    update: {},
    create: {
      id: VARIANTE_SKU_SEED_ID,
      producto_maestro_id: productoMaestro.id,
      sku: "CAMISA-POLICIA-M-AZUL-MASCULINO",
      ean_qr: "7791234500017",
      talle: "M",
      color: "Azul",
      genero: "Masculino",
      modelo: "Policía",
      is_active: true,
    },
  });

  const deposito = await prisma.deposito.upsert({
    where: { id: DEPOSITO_SEED_ID },
    update: {},
    create: {
      id: DEPOSITO_SEED_ID,
      nombre: "Depósito Central",
      tipo: "CENTRAL",
      direccion: "Sede Central — datos de prueba HU-7",
      is_active: true,
    },
  });

  const stockDeposito = await prisma.stockDeposito.upsert({
    where: { id: STOCK_DEPOSITO_SEED_ID },
    update: {},
    create: {
      id: STOCK_DEPOSITO_SEED_ID,
      variante_sku_id: varianteSku.id,
      deposito_id: deposito.id,
      cantidad: 40,
      punto_pedido: 10,
      stock_seguridad: 5,
      is_active: true,
    },
  });

  // 3 egresos dentro de los últimos 2 meses, para que
  // calcularPromedioMovilEgresos (meses_historico default = 3) tenga
  // historial real con el que calcular el promedio móvil sugerido.
  const egresos = [
    { id: MOVIMIENTO_EGRESO_1_ID, cantidad: 20, hace_dias: 50 },
    { id: MOVIMIENTO_EGRESO_2_ID, cantidad: 30, hace_dias: 30 },
    { id: MOVIMIENTO_EGRESO_3_ID, cantidad: 40, hace_dias: 10 },
  ];

  for (const egreso of egresos) {
    await prisma.movimientoStock.upsert({
      where: { id: egreso.id },
      update: {},
      create: {
        id: egreso.id,
        variante_sku_id: varianteSku.id,
        deposito_origen_id: deposito.id,
        deposito_destino_id: null,
        tipo_movimiento: TipoMovimiento.EGRESO,
        estado_origen: "DISPONIBLE",
        cantidad: egreso.cantidad,
        comprobante_referencia: `SEED-EGRESO-${egreso.cantidad}`,
        registrado_por_id: usuario.id,
        created_at: diasAtras(egreso.hace_dias),
        is_active: true,
      },
    });
  }

  console.log("Seed HU-7 completado:");
  console.table({
    usuario_id: usuario.id,
    producto_maestro_id: productoMaestro.id,
    variante_sku_id: varianteSku.id,
    deposito_id: deposito.id,
    stock_deposito_id: stockDeposito.id,
    movimiento_egreso_1_id: MOVIMIENTO_EGRESO_1_ID,
    movimiento_egreso_2_id: MOVIMIENTO_EGRESO_2_ID,
    movimiento_egreso_3_id: MOVIMIENTO_EGRESO_3_ID,
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
