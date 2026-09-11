/**
 * @layout DashboardLayout
 * @description Layout compartido de `app/(dashboard)/**` (HU-D9,
 * task_cali_layout_dashboard.md) — Sidebar + Navbar + Footer, común a
 * todas las rutas del grupo, incluyendo las que se agreguen a futuro
 * (Módulo A completo, D.1 cuando se retome, etc.).
 */
import { Toaster } from "@/components/ui/toast";
import { Sidebar } from "@/components/layout/Sidebar";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-dvh flex">
      <Sidebar />

      <div className="flex-1 flex flex-col min-w-0">
        <Navbar />
        <div className="flex-1 overflow-y-auto">{children}</div>
        <Footer />
      </div>

      <Toaster />
    </div>
  );
}