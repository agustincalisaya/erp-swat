import { redirect } from "next/navigation";
import { ReceiptText } from "lucide-react";
import { getServerSession } from "@/lib/auth/session";
import { usuarioTienePermiso } from "@/lib/auth/with-permission";
import { listarCategoriasGasto, listarCategoriasActivasParaGasto } from "@/lib/services/tesoreria/categoria-gasto.service";
import { PERMISO_GESTIONAR_GASTOS } from "@/lib/services/tesoreria/gasto-operativo.service";
import { GestorGastosOperativos } from "@/components/tesoreria/gestor-gastos-operativos";

export const dynamic = "force-dynamic";
export const metadata = { title: "Gastos operativos — ERP SWAT" };
export default async function GastosOperativosPage() {
  const session = await getServerSession();
  if (!session) redirect("/login");
  if (!(await usuarioTienePermiso(session.userId, PERMISO_GESTIONAR_GASTOS))) redirect("/no-autorizado");
  let categorias = null;
  let activas = null;
  try { [categorias, activas] = await Promise.all([listarCategoriasGasto(true), listarCategoriasActivasParaGasto()]); }
  catch (error) { console.error("[HU-G13] No se pudieron cargar categorías:", error); }
  return <main className="min-h-screen bg-background p-4 sm:p-6 lg:p-8"><div className="mx-auto max-w-6xl space-y-6">
    <header className="flex items-start gap-3"><div className="rounded-xl bg-selected p-2 text-selected-foreground"><ReceiptText className="size-5" aria-hidden="true" /></div>
      <div><h1 className="text-xl font-bold text-foreground">Gastos operativos</h1><p className="text-sm text-muted-foreground">Registrá y consultá los gastos del negocio.</p></div></header>
    {categorias && activas ? <GestorGastosOperativos categorias={categorias.map(({ id, nombre }) => ({ id, nombre }))} activas={activas} />
      : <p role="alert" className="rounded-lg border border-destructive p-4 text-destructive">No se pudieron cargar las categorías. Actualizá la página para reintentar.</p>}
  </div></main>;
}
