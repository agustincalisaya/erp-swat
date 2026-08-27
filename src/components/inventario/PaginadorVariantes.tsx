/**
 * @component PaginadorVariantes
 * @description HU-A6 (R2) — paginación estilo Auditoría Forense (clon de
 * `TablaAuditLog`): "Página X de Y — N en total" + Anterior/Siguiente como
 * LINKS que conservan `queryBase` (tab + q + producto_maestro_id, sin
 * `page`) y solo cambian `page`. Server Component puramente presentacional —
 * sin interactividad propia (la navegación la hace el link).
 */
interface PaginadorVariantesProps {
  page: number;
  total: number;
  pageSize: number;
  /** Query string de los filtros activos (sin `page`). */
  queryBase: string;
}

export function PaginadorVariantes({
  page,
  total,
  pageSize,
  queryBase,
}: PaginadorVariantesProps) {
  const totalPaginas = Math.max(1, Math.ceil(total / pageSize));

  if (total === 0) return null;

  return (
    <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
      <span>
        Página {page} de {totalPaginas} — {total} variante
        {total === 1 ? "" : "s"} en total
      </span>
      <div className="flex gap-2">
        <PaginaLink page={page - 1} disabled={page <= 1} label="Anterior" queryBase={queryBase} />
        <PaginaLink
          page={page + 1}
          disabled={page >= totalPaginas}
          label="Siguiente"
          queryBase={queryBase}
        />
      </div>
    </div>
  );
}

function PaginaLink({
  page,
  disabled,
  label,
  queryBase,
}: {
  page: number;
  disabled: boolean;
  label: string;
  queryBase: string;
}) {
  if (disabled) {
    return (
      <span className="cursor-not-allowed rounded-lg border border-border px-3 py-1.5 text-muted-foreground/50">
        {label}
      </span>
    );
  }

  const separador = queryBase ? "&" : "";

  return (
    <a
      href={`?${queryBase}${separador}page=${page}`}
      className="rounded-lg border border-border px-3 py-1.5 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
    >
      {label}
    </a>
  );
}