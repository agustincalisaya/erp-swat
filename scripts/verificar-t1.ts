import 'dotenv/config';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';

async function main() {
const url = new URL(process.env.DATABASE_URL!);
assert.ok(['localhost', '127.0.0.1'].includes(url.hostname));
assert.equal(url.pathname, '/swat_erp_db');
// Next.js carga este .env del proyecto cuando el proceso no hereda DATABASE_URL.
assert.ok(!url.searchParams.get('schema') || url.searchParams.get('schema') === 'public');
const local = process.argv.includes('--local');
const schema = local ? 'public' : `t1_demo_${Date.now()}`;
url.searchParams.set('schema', schema);
process.env.DATABASE_URL = url.toString();
const p = new PrismaClient();
const run = (args: string[]) => {
  const r = spawnSync(process.execPath, args, { env: process.env, encoding: 'utf8' });
  if (r.status !== 0) throw new Error((r.stderr + r.stdout).slice(-6000));
};
try {
if (!local) {
  await p.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  run(['node_modules/prisma/build/index.js', 'db', 'push', '--skip-generate']);
  run(['--conditions=react-server', '--import', 'tsx', 'prisma/seed.ts', '--without-t1']);
}
const audit = async () => ({ cantidad: await p.auditLog.count(),
  hashes: createHash('sha256').update(JSON.stringify(await p.auditLog.findMany({orderBy: {id:'asc'}}))).digest('hex'),
  ultimo: await p.auditLog.findFirst({ orderBy: { created_at: 'desc' }, select: { hash_actual: true } }) });
const before = await audit();
const snapshot = async () => {
  const tables = ['PedidoVenta','PedidoVentaItem','VentaMedioPago','ComprobanteFiscal','PedidoVentaEcommerce','IngresoTesoreria','ContraAsientoIngreso','ReintegroPedidoWeb','ReintegroRefundIntento','CuentaCorrienteOperacion','OrdenCompra','OrdenCompraItem','CuentaPorPagar','ComprobanteProveedor','CuentaPorPagarComprobante','GastoOperativo'];
  const tablasFisicas: Record<string,string> = {"PedidoVenta": "pedidos_venta", "PedidoVentaItem": "pedido_venta_items", "VentaMedioPago": "venta_medios_pago", "ComprobanteFiscal": "comprobantes_fiscales", "PedidoVentaEcommerce": "pedidos_venta_ecommerce", "IngresoTesoreria": "ingresos_tesoreria", "ContraAsientoIngreso": "contra_asientos_ingreso", "ReintegroPedidoWeb": "reintegros_pedido_web", "ReintegroRefundIntento": "reintegro_refund_intentos", "CuentaCorrienteOperacion": "cuenta_corriente_operaciones", "OrdenCompra": "ordenes_compra", "OrdenCompraItem": "orden_compra_items", "CuentaPorPagar": "cuentas_por_pagar", "ComprobanteProveedor": "comprobantes_proveedor", "CuentaPorPagarComprobante": "cuentas_por_pagar_comprobantes", "GastoOperativo": "gastos_operativos"};
  const result: Record<string, unknown> = {};
  for (const table of tables) {
    // Compara también updated_at: la migración de textos no reescribe filas idénticas.
    const rows = await p.$queryRawUnsafe<unknown[]>(`SELECT to_jsonb(t) AS fila FROM "${tablasFisicas[table]}" t ORDER BY id`);
    result[table] = {cantidad: rows.length, hash: createHash('sha256').update(JSON.stringify(rows)).digest('hex')};
  }
  return result;
};
run(['--conditions=react-server', '--import', 'tsx', 'prisma/seed.ts', '--t1-only']);
assert.deepEqual(await audit(), before);
const first = await snapshot();
run(['--conditions=react-server', '--import', 'tsx', 'prisma/seed.ts', '--t1-only']);
assert.deepEqual(await snapshot(), first);
assert.deepEqual(await audit(), before);
const { obtenerResumenMensual } = await import('../src/lib/services/tesoreria/reporte-mensual.service');
const { consultarPagosProveedoresDelMes } = await import('../src/lib/services/tesoreria/reporte-mensual-extensiones.service');
const { consultarLibroIva } = await import('../src/lib/services/tesoreria/libro-iva.service');
const { obtenerComprobanteParaPdf } = await import('../src/lib/services/tesoreria/comprobantes-repositorio.service');
const { generarComprobanteFiscalPdf } = await import('../src/lib/services/ecommerce/comprobante-web-pdf');
const id = (key: string) => { const h = createHash('sha256').update(`swat:sprint5:t1:${key}`).digest('hex'); return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`; };
const ventas = await p.pedidoVenta.findMany({ where: { created_at: {gte: new Date('2026-04-01'),lt: new Date('2026-08-01')} }, include: { medios_pago: true, comprobantes: true } });
for (const v of ventas) {
  assert.equal(v.medios_pago.reduce((n, m) => n + Math.round(Number(m.importe)*100), 0), Math.round(Number(v.total)*100));
  assert.ok(v.comprobantes.length);
}
const numeros = (await p.pedidoVenta.findMany({where:{numero_venta:{startsWith:'V-2026-'}},select:{numero_venta:true}})).map(v=>Number(v.numero_venta.slice(-6))).sort((a,b)=>a-b);
assert.equal(new Set(numeros).size,numeros.length);
if (!local) for(let i=1;i<numeros.length;i++) assert.equal(numeros[i],numeros[i-1]+1);
const pagos = await p.cuentaPorPagar.findMany({where:{estado:'PAGADA',fecha_pago:{gte:new Date('2026-04-01'),lt:new Date('2026-08-01')}},include:{comprobantes:{include:{comprobante_proveedor:true}}}});
for (const pago of pagos) { assert.ok(pago.comprobantes.length); for (const c of pago.comprobantes) assert.equal(c.comprobante_proveedor.orden_compra_id,pago.orden_compra_id); }
const reintegro = await p.reintegroPedidoWeb.findUniqueOrThrow({where:{pedido_venta_id:id('venta:web-julio-reintegro')},include:{nota_credito:true,contra_asiento_ingreso:true}});
assert.equal(reintegro.nota_credito!.comprobante_original_id,id('comprobante:web-julio-reintegro'));
assert.equal(reintegro.contra_asiento_ingreso!.ingreso_original_id,id('ingreso:web-julio-reintegro'));
assert.equal(reintegro.monto_total.toFixed(2),reintegro.contra_asiento_ingreso!.monto.toFixed(2));
const out = `/tmp/${schema}-evidencia`; mkdirSync(out,{recursive:true});
const meses = [];
for (const mes of [4,5,6,7]) {
  const resumen = await obtenerResumenMensual(2026,mes,{incluir_desglose_gastos:true});
  const proveedores = await consultarPagosProveedoresDelMes(p,2026,mes);
  assert.equal(proveedores.reduce((n,v)=>n+Math.round(Number(v.monto)*100),0),Math.round(Number(resumen.egresos.proveedores)*100));
  const iva = {} as Record<string,unknown>;
  for (const tipo of ['VENTAS','COMPRAS'] as const) {
    const libro = await consultarLibroIva(tipo,`2026-0${mes}`);
    assert.ok(libro.filas.length > 0);
    iva[tipo]=libro;
  }
  const desde = new Date(`2026-0${mes}-01`), hasta = new Date(`2026-0${mes+1}-01`);
  const densidad = {
    mostrador: await p.pedidoVenta.count({where:{canal:'MOSTRADOR',fecha_facturacion:{gte:desde,lt:hasta}}}),
    web: await p.ingresoTesoreria.count({where:{fecha:{gte:desde,lt:hasta}}}),
    pagos: await p.cuentaPorPagar.count({where:{estado:'PAGADA',fecha_pago:{gte:desde,lt:hasta}}}),
    gastos: await p.gastoOperativo.count({where:{is_active:true,fecha:{gte:desde,lt:hasta}}}),
    bajas: await p.gastoOperativo.count({where:{is_active:false,fecha:{gte:desde,lt:hasta}}}),
  };
  if (!local) assert.deepEqual(densidad,{mostrador:8,web:4,pagos:3,gastos:mes===4?10:11,bajas:mes===7?2:1});
  meses.push({mes,resumen,proveedores,iva,densidad});
}
for (const clave of ['comprobante:mostrador-julio','comprobante:web-junio','comprobante:nc-web-julio']) {
  const dto = await obtenerComprobanteParaPdf(id(clave));
  const pdf = await generarComprobanteFiscalPdf(dto);
  assert.ok(pdf.length>1000);
  writeFileSync(`${out}/${clave.replace(':','-')}.pdf`,pdf);
}
const { listarGastosOperativos } = await import('../src/lib/services/tesoreria/gasto-operativo.service');
const { obtenerSerieSeisMeses } = await import('../src/lib/services/tesoreria/reporte-mensual.serie.service');
const gastosJulio = await listarGastosOperativos({mes:'2026-07',page:1,page_size:20});
assert.ok(gastosJulio.total_registros >= 10);
assert.equal(gastosJulio.total,meses[3].resumen.egresos.gastos_operativos);
const serie = await obtenerSerieSeisMeses(meses[3].resumen);
assert.deepEqual(serie.map(s=>s.periodo),['2026-02','2026-03','2026-04','2026-05','2026-06','2026-07']);
for(const punto of serie.slice(2)) assert.ok(Number(punto.ingresos)>0 && Number(punto.egresos)>0);
assert.deepEqual(await audit(),before);
const evidence={schema,audit:before,snapshot:first,numeros,meses,gastosJulio,serie};
writeFileSync(`${out}/resultado.json`,JSON.stringify(evidence,null,2));
console.log(JSON.stringify({schema,audit:before,out,meses:meses.map(m=>m.resumen)},null,2));
const { prisma } = await import('../src/lib/db/prisma'); await prisma.$disconnect();
} finally { await p.$disconnect(); }
}
main().catch(e=>{console.error(e);process.exit(1)});
