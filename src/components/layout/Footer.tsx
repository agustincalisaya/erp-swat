/**
 * @component Footer
 * @description Pie de página simple, común a todo el dashboard (HU-D9,
 * task_cali_layout_dashboard.md §1).
 */
export function Footer() {
  const anioActual = new Date().getFullYear();

  return (
    <footer className="shrink-0 border-t border-border bg-white px-4 sm:px-6 py-3">
      <p className="text-xs text-muted-foreground text-center">
        SWAT Indumentarias &copy; {anioActual} — Uso interno.
      </p>
    </footer>
  );
}
