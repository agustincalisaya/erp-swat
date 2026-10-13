/**
 * @page HomePage
 * @route /home
 * @description Pantalla de bienvenida temporal.
 * destino por defecto tras login sin `?redirect=` específico. 
 * Próximamente incluirá el Dashboard (según backlog).
 */
import { redirect } from "next/navigation";
import { Sparkles, Activity, Info, Calendar } from "lucide-react";
import { getServerSession } from "@/lib/auth/session";
import { obtenerIdentidadUsuario } from "@/lib/services/auditoria/usuario.service";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";

export const metadata = {
  title: "Inicio — ERP SWAT",
  description: "Pantalla de bienvenida del sistema ERP SWAT Indumentarias.",
};

export default async function HomePage() {
  const session = await getServerSession();
  if (!session) redirect("/login");

  const identidad = await obtenerIdentidadUsuario(session.userId);
  const nombre = identidad?.nombre_completo ?? session.nombreUsuario;

  // Formatear la fecha actual (ej: "martes, 25 de agosto de 2026")
  const fechaActual = new Intl.DateTimeFormat('es-AR', { 
    weekday: 'long', 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  }).format(new Date());

  return (
    <main className="min-h-full bg-background p-4 sm:p-6 lg:p-8 space-y-6">
      
      {/* 1. BANNER PRINCIPAL */}
      <div className="relative overflow-hidden rounded-xl bg-sidebar text-sidebar-foreground shadow-md">
        {/* Elementos decorativos de fondo */}
        <div className="absolute inset-0 bg-sidebar"></div>
        <div className="absolute -right-20 -top-20 h-64 w-64 rounded-full bg-transparent blur-3xl"></div>
        <div className="absolute -bottom-20 right-20 h-40 w-40 rounded-full bg-transparent blur-2xl"></div>
        
        <div className="relative z-10 p-8 sm:p-10">
          <div className="flex items-center gap-2 text-sidebar-muted-foreground mb-4 text-sm font-medium">
            <Calendar className="size-4" />
            <span className="capitalize">{fechaActual}</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight mb-3 flex items-center gap-3">
            Bienvenido/a, {nombre} <Sparkles className="size-7 text-sidebar-primary" />
          </h1>
          <p className="text-sidebar-muted-foreground max-w-2xl text-lg leading-relaxed">
            Has ingresado correctamente al sistema ERP de SWAT Indumentarias. 
            Utiliza el menú lateral para gestionar los módulos de Auditoría e Inventario.
          </p>
        </div>
      </div>

      {/* 2. SECCIÓN INFORMATIVA (Layout de 2 columnas) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        
        {/* Tarjeta: Próximamente (Placeholder del Dashboard) */}
        <Card className="border-dashed border-2 border-border bg-transparent shadow-none">
          <CardHeader>
            <div className="w-12 h-12 rounded-lg bg-selected text-selected-foreground flex items-center justify-center mb-4">
              <Activity className="size-6" />
            </div>
            <CardTitle className="text-xl text-foreground">Tablero de Control en desarrollo</CardTitle>
            <CardDescription className="text-muted-foreground text-base mt-2">
              Próximamente este espacio mostrará un resumen de la actividad del sistema, incluyendo métricas de inventario y registros recientes de auditoría.
            </CardDescription>
          </CardHeader>
        </Card>

        {/* Tarjeta: Novedades / Estado del Sistema */}
        <Card className="shadow-sm border-border">
          <CardHeader>
            <div className="w-12 h-12 rounded-lg bg-success text-success-foreground flex items-center justify-center mb-4">
              <Info className="size-6" />
            </div>
            <CardTitle className="text-xl text-foreground">Estado del Sistema</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-4 text-sm text-muted-foreground">
              <li className="flex items-start gap-3">
                <span className="w-1.5 h-1.5 rounded-full bg-success-foreground mt-1.5 shrink-0"></span>
                <p>Los módulos de <strong>Auditoría</strong> e <strong>Inventario</strong> ya se encuentran desplegados y listos para su uso.</p>
              </li>
              <li className="flex items-start gap-3">
                <span className="w-1.5 h-1.5 rounded-full bg-success-foreground mt-1.5 shrink-0"></span>
                <p>La vista principal actual es temporal mientras se avanza con las tareas del Product Backlog correspondientes al Dashboard.</p>
              </li>
            </ul>
          </CardContent>
        </Card>

      </div>
    </main>
  );
}