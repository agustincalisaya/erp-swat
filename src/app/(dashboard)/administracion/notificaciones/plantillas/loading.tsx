/** Estado de carga de la pantalla de plantillas de notificación (HU-F2, task §6). */
export default function CargandoPlantillasNotificacion() {
  return (
    <main className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8" aria-busy="true">
      <div className="max-w-6xl mx-auto space-y-5 animate-pulse">
        <div className="h-10 w-72 rounded-lg bg-gray-200" />
        <div className="h-8 w-64 rounded-lg bg-gray-200" />
        <div className="h-64 rounded-xl bg-gray-200" />
      </div>
      <span className="sr-only">Cargando plantillas…</span>
    </main>
  );
}
