/** Estado de carga de la bandeja de notificaciones (HU-F3, task §6). */
export default function CargandoNotificaciones() {
  return (
    <main className="min-h-screen bg-background p-4 sm:p-6 lg:p-8" aria-busy="true">
      <div className="max-w-4xl mx-auto space-y-5 animate-pulse">
        <div className="h-10 w-64 rounded-lg bg-muted" />
        <div className="h-7 w-96 max-w-full rounded-lg bg-muted" />
        <div className="h-20 rounded-xl bg-muted" />
        <div className="h-20 rounded-xl bg-muted" />
        <div className="h-20 rounded-xl bg-muted" />
      </div>
      <span className="sr-only">Cargando notificaciones…</span>
    </main>
  );
}
