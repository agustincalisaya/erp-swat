import { redirect } from "next/navigation";
import { Tags } from "lucide-react";
import { getServerSession } from "@/lib/auth/session";
import { usuarioTienePermiso } from "@/lib/auth/with-permission";
import { listarCategoriasGasto, PERMISO_GESTIONAR_CATEGORIAS_GASTO } from "@/lib/services/tesoreria/categoria-gasto.service";
import { GestorCategoriasGasto } from "@/components/tesoreria/gestor-categorias-gasto";

export const dynamic = "force-dynamic";
export const metadata = { title: "Categorías de gasto — ERP SWAT" };

export default async function CategoriasGastoPage() {
  const session = await getServerSession();
  if (!session) redirect("/login");
  if (!(await usuarioTienePermiso(session.userId, PERMISO_GESTIONAR_CATEGORIAS_GASTO))) redirect("/no-autorizado");
  let categorias = null;
  try { categorias = await listarCategoriasGasto(true); }
  catch (error) { console.error("[HU-G12] No se pudo cargar la lista:", error); }

  return <main className="min-h-screen bg-background p-4 sm:p-6 lg:p-8">
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="flex items-start gap-3">
        <div className="rounded-xl bg-selected p-2 text-selected-foreground"><Tags className="size-5" aria-hidden="true" /></div>
        <div><h1 className="text-xl font-bold text-foreground">Categorías de gasto</h1>
          <p className="text-sm text-muted-foreground">Administrá las categorías usadas para clasificar gastos operativos.</p></div>
      </header>
      {categorias === null
        ? <p role="alert" className="rounded-lg border border-destructive p-4 text-destructive">No se pudieron cargar las categorías. Actualizá la página para reintentar.</p>
        : <GestorCategoriasGasto categorias={categorias} />}
    </div>
  </main>;
}
