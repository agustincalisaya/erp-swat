/**
 * HU-E1 — Fixtures compartidos por los tests de integración (servicios y HTTP).
 * Cada llamada crea datos PROPIOS (UUID/sufijos aleatorios), así los casos no
 * dependen del seed ni del estado que dejó una corrida anterior. Nunca borran
 * nada (Regla N.° 1): pensados para una base de test descartable.
 */
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

// IDs fijos de prisma/seed.ts que los fixtures necesitan como FK.
export const PROVEEDOR_HOMOLOGADO_ID = "1a2b3c4d-6666-4a1a-8a1a-000000000001";
export const DEPOSITO_CENTRAL_ID = "a61c8fe5-bac1-4c4f-a15a-9a2ff1c7c95a";
export const DEPOSITO_SHOWROOM_ID = "acafbd3f-3309-46f6-8199-3509ca1d37f9";
export const LISTA_PRECIO_VENTA_VERSION_1_ID = "f7bc2652-5022-4d5c-b235-be90b8f1677d";

export interface OpcionesArticulo {
  stockShowroom: number;
  stockCentral?: number;
  /** `null` = sin precio vigente. Default 10000. */
  precio?: number | null;
  visible?: boolean;
}

export interface ArticuloFixture {
  productoMaestroId: string;
  productoWebId: string;
  varianteId: string;
  sku: string;
}

/** Producto web publicable de una variante, con precio y stock propios. */
export async function crearArticulo(prisma: PrismaClient, opciones: OpcionesArticulo): Promise<ArticuloFixture> {
  const sufijo = randomUUID().slice(0, 8).toUpperCase();
  const producto = await prisma.productoMaestro.create({
    data: {
      codigo_producto: "E1TEST",
      nombre: `Artículo HU-E1 ${sufijo}`,
      rubro: "Indumentaria",
      categoria: "Test HU-E1",
      unidad_medida: "UNIDAD",
      costo_estandar_referencia: 1000,
    },
  });
  const variante = await prisma.varianteSKU.create({
    data: {
      producto_maestro_id: producto.id,
      proveedor_id: PROVEEDOR_HOMOLOGADO_ID,
      sku: `E1TEST-${sufijo}`,
      talle: "M",
      color: "Negro",
      genero: "UNISEX",
      modelo: "Test",
    },
  });
  const contenido = await prisma.productoWebContenido.create({
    data: {
      producto_maestro_id: producto.id,
      titulo_comercial: `Artículo HU-E1 ${sufijo}`,
      descripcion: "Fixture de test de integración HU-E1",
      visibilidad_web: opciones.visible ?? true,
      fotos: { create: { url: "https://placehold.co/800x800?text=E1", es_principal: true } },
    },
  });
  if (opciones.precio !== null) {
    await prisma.listaPrecioVentaItem.create({
      data: {
        version_id: LISTA_PRECIO_VENTA_VERSION_1_ID,
        variante_sku_id: variante.id,
        precio_venta: opciones.precio ?? 10000,
      },
    });
  }
  await prisma.stockDeposito.create({
    data: { variante_sku_id: variante.id, deposito_id: DEPOSITO_SHOWROOM_ID, cantidad: opciones.stockShowroom },
  });
  if (opciones.stockCentral !== undefined) {
    await prisma.stockDeposito.create({
      data: { variante_sku_id: variante.id, deposito_id: DEPOSITO_CENTRAL_ID, cantidad: opciones.stockCentral },
    });
  }
  return { productoMaestroId: producto.id, productoWebId: contenido.id, varianteId: variante.id, sku: variante.sku };
}

export interface CuentaFixture {
  cuentaId: string;
  clienteId: string;
  email: string;
  sesion: { cuentaId: string; clienteId: string; vinculacionPendiente: boolean };
}

/**
 * Cliente + cuenta web propios, sin pedidos previos. `passwordHash`: hash PHC
 * real (para los tests HTTP que inician sesión); los tests de servicio no lo usan.
 */
export async function crearCuenta(
  prisma: PrismaClient,
  opciones: { vinculacionPendiente?: boolean; passwordHash?: string } = {},
): Promise<CuentaFixture> {
  const vinculacionPendiente = opciones.vinculacionPendiente ?? false;
  const dni = String(90_000_000 + Math.floor(Math.random() * 9_999_999));
  const cliente = await prisma.cliente.create({ data: { dni, nombre: `Cliente HU-E1 ${dni}` } });
  const email = `e1.${dni}.${randomUUID().slice(0, 6)}@example.com`;
  const cuenta = await prisma.cuentaClienteWeb.create({
    data: {
      cliente_id: cliente.id,
      email,
      password_hash: opciones.passwordHash ?? "no-usado-en-tests-de-servicio",
      vinculacion_pendiente: vinculacionPendiente,
    },
  });
  return {
    cuentaId: cuenta.id,
    clienteId: cliente.id,
    email,
    sesion: { cuentaId: cuenta.id, clienteId: cliente.id, vinculacionPendiente },
  };
}
