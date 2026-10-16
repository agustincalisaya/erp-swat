/**
 * HU-D6 — verificaciones estáticas del panel de alertas (mismo patrón que
 * `components/ecommerce/pedidos-pagados-admin.test.ts`): la página y la API
 * usan el mismo servicio que reevalúa, el control de acceso, el formulario
 * de umbrales solo con `configuracion:administrar`, la lectura sin N+1, los
 * tokens semánticos y el ítem del Sidebar.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const leer = (ruta: string) => readFileSync(new URL(ruta, import.meta.url), "utf8");
const pagina = leer("../../app/(dashboard)/tesoreria/alertas/page.tsx");
const ruta = leer("../../app/api/tesoreria/alertas/route.ts");
const servicio = leer("../../lib/services/alertas/alerta-desvio.panel.service.ts");
const panel = leer("./PanelAlertasDesvio.tsx");
const formulario = leer("./FormularioUmbralesEgresos.tsx");
const selector = leer("./SelectorNivelAlertas.tsx");
const sidebar = leer("../layout/Sidebar.tsx");
const seed = leer("../../../prisma/seed.ts");

test("página: RSC sin fetch a la propia API, acceso con login / no-autorizado y servicio que reevalúa", () => {
  assert.doesNotMatch(pagina, /^"use client"/);
  assert.doesNotMatch(pagina, /fetch\(/);
  assert.match(pagina, /resolverAccesoPanelAlertas\(await getServerSession\(\), usuarioTienePermiso\)/);
  assert.match(pagina, /acceso\.tipo === "LOGIN"\) redirect\("\/login"\)/);
  assert.match(pagina, /acceso\.tipo === "NO_AUTORIZADO"\) redirect\("\/no-autorizado"\)/);
  assert.match(pagina, /obtenerPanelAlertas\(filtros\)/);
  assert.match(pagina, /normalizarFiltrosPanel\(await searchParams\)/);
});

test("API y página comparten obtenerPanelAlertas, que reevalúa ANTES de listar", () => {
  assert.match(ruta, /withPermission\(PERMISO_ALERTAS_LEER/);
  assert.match(ruta, /obtenerPanelAlertas\(parsed\.data\)/);
  const reevalua = servicio.indexOf("await reevaluarAlertasAlAbrirPanel(");
  const lista = servicio.indexOf("prisma.alertaDesvio.findMany(");
  assert.ok(reevalua > 0 && lista > reevalua, "reevalúa primero y lista después");
});

test("formulario de umbrales: solo con configuracion:administrar; el resto ve solo lectura", () => {
  assert.match(pagina, /puedeEditar \? \(\s*<FormularioUmbralesEgresos umbrales=\{panel\.umbrales\} \/>/);
  assert.match(pagina, /puedeEditar=\{acceso\.puedeEditarUmbrales\}/);
  assert.equal(pagina.match(/<FormularioUmbralesEgresos/g)?.length, 1, "un único punto de render");
  assert.match(pagina, /Guardados en la configuración del sistema\. Solo lectura: los modifica el Administrador\./);
});

test("formulario: PATCH al endpoint, router.refresh(), errores por campo y envío deshabilitado", () => {
  assert.match(formulario, /^"use client"/);
  assert.match(formulario, /fetch\("\/api\/tesoreria\/alertas\/umbrales", \{\s*method: "PATCH"/);
  assert.match(formulario, /router\.refresh\(\)/);
  assert.match(formulario, /UmbralesEgresosSchema\.safeParse/);
  assert.match(formulario, /json\?\.error\?\.fieldErrors/);
  assert.match(formulario, /disabled=\{enviando\}/);
  assert.match(formulario, /enviandoRef\.current/);
  assert.match(formulario, /role="alert"/);
  assert.doesNotMatch(formulario, /actions?\.ts|"use server"/, "sin Server Action (D25)");
});

test("lectura del panel: is_active, una sola consulta con join (sin N+1), mismo where para el conteo, orden estable", () => {
  assert.match(servicio, /is_active: true/);
  assert.match(servicio, /variante_sku: \{ select: \{ sku: true \} \}/);
  assert.match(servicio, /deposito: \{ select: \{ nombre: true \} \}/);
  assert.match(servicio, /prisma\.alertaDesvio\.count\(\{ where \}\)/);
  assert.match(servicio, /orderBy: \[\{ severidad: "asc" \}, \{ created_at: "desc" \}, \{ id: "asc" \}\]/);
  assert.doesNotMatch(servicio, /for \([^)]*\)[\s\S]{0,120}await/);
});

test("estilos: solo tokens semánticos, sin colores fijos; el nivel se muestra como texto", () => {
  for (const [nombre, fuente] of [["página", pagina], ["panel", panel], ["formulario", formulario], ["selector", selector]] as const) {
    assert.doesNotMatch(fuente, /#[0-9a-fA-F]{3,8}\b|\b(?:bg|text|border)-(?:red|amber|yellow|blue|green|orange|gray|slate)-\d{2,3}\b/, nombre);
  }
  assert.match(panel, /\{alerta\.severidad_etiqueta\}/);
  assert.match(panel, /CRITICA: "bg-danger-soft text-danger-soft-foreground"/);
});

test("contenido de D12: pestañas, nivel, columnas, nota al pie y sin el banner del prototipo", () => {
  for (const texto of ["Activas", "Resueltas", "Todas"]) assert.match(panel, new RegExp(`etiqueta: "${texto}"`));
  for (const texto of ["Todos los niveles", "Crítica", "Advertencia", "Informativa"]) assert.match(selector, new RegExp(texto));
  for (const columna of ["Nivel", "Indicador", "Referencia", "Detalle", "Estado", "Desde"]) {
    assert.match(panel, new RegExp(`<TableHead>${columna}</TableHead>`));
  }
  assert.match(pagina, /Para stock: advertencia en o por debajo del punto de pedido, crítica en cero\./);
  assert.match(pagina, /Fuera del sprint: Tablero de Comando y push de la PWA\./);
  assert.doesNotMatch(pagina, /Pantalla nueva del Sprint 5/);
});

test("Sidebar: un único ítem Alertas con alertas:leer, último del grupo Tesorería", () => {
  assert.equal(sidebar.match(/href: "\/tesoreria\/alertas"/g)?.length, 1);
  const grupo = sidebar.slice(sidebar.indexOf('label: "Tesorería"'), sidebar.indexOf('label: "Administración"'));
  assert.match(grupo, /label: "Cuentas por Pagar"[\s\S]*label: "Alertas",\s*href: "\/tesoreria\/alertas",\s*icon: TriangleAlert,\s*permiso: "alertas:leer"/);
  assert.match(grupo, /permiso: "alertas:leer",\s*\},\s*\],/, "es el último ítem del grupo");
});

test("seed: alertas:leer asignado a ADMINISTRADOR y GERENTE (quienes entran al panel)", () => {
  const cluster6 = seed.slice(seed.indexOf("async function seedSprint5Cluster6"));
  assert.match(cluster6, /codigo: "alertas:leer"/);
  assert.match(cluster6, /for \(const rol_id of \[ROL_ADMINISTRADOR_ID, ROL_GERENTE_ID\]\)/);
});
