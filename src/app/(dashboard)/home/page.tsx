/**
 * @page HomePage
 * @route /home
 * @description Pantalla de bienvenida (task_cali_pagina_home.md §1.1) —
 * destino por defecto tras login sin `?redirect=` específico. Vive dentro
 * de `app/(dashboard)/` para heredar Sidebar/Navbar/Footer; no requiere
 * ningún permiso adicional, solo sesión válida (ya exigida por
 * `src/proxy.ts`).
 */
import { redirect } from "next/navigation";
import { Sparkles } from "lucide-react";
import { getServerSession } from "@/lib/auth/session";
import { obtenerIdentidadUsuario } from "@/lib/services/auditoria/usuario.service";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

export const metadata = {
  title: "Inicio — ERP SWAT",
  description: "Pantalla de bienvenida del sistema ERP SWAT Indumentarias.",
};

export default async function HomePage() {
  const session = await getServerSession();
  if (!session) redirect("/login");

  const identidad = await obtenerIdentidadUsuario(session.userId);
  const nombre = identidad?.nombre_completo ?? session.nombreUsuario;

  return (
    <main className="min-h-full bg-gray-50 p-4 sm:p-6 lg:p-8">
      <div className="max-w-2xl mx-auto">
        <Card>
          <CardHeader className="items-center text-center gap-3">
            <div className="p-3 rounded-full bg-blue-100 text-blue-600">
              <Sparkles className="size-6" aria-hidden="true" />
            </div>
            <CardTitle className="text-lg">Bienvenido/a, {nombre}</CardTitle>
            <CardDescription>
              Usá el menú lateral para acceder a los módulos disponibles del sistema.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    </main>
  );
}
