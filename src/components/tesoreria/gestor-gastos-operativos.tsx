"use client";

import { useCallback, useEffect, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { crearGastoOperativoAction, editarGastoOperativoAction, darDeBajaGastoOperativoAction } from "@/app/(dashboard)/tesoreria/gastos-operativos/actions";
import type { GastoOperativoListado } from "@/lib/services/tesoreria/gasto-operativo.service";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

type Categoria = { id: string; nombre: string };
type Lista = { mes: string; items: GastoOperativoListado[]; total: string; total_registros: number; page: number; page_size: number };
type Modo = "crear" | "editar" | "baja";
const mesActual = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires", year: "numeric", month: "2-digit" }).format(new Date());
const diaActual = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

export function GestorGastosOperativos({ categorias, activas }: { categorias: Categoria[]; activas: Categoria[] }) {
  const [mes, setMes] = useState(mesActual);
  const [categoria, setCategoria] = useState("");
  const [page, setPage] = useState(1);
  const [lista, setLista] = useState<Lista | null>(null);
  const [cargando, setCargando] = useState(true);
  const [errorLista, setErrorLista] = useState("");
  const [version, setVersion] = useState(0);
  const [modo, setModo] = useState<Modo | null>(null);
  const [seleccionado, setSeleccionado] = useState<GastoOperativoListado | null>(null);
  const [categoriaForm, setCategoriaForm] = useState("");
  const [fecha, setFecha] = useState(diaActual);
  const [monto, setMonto] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [motivo, setMotivo] = useState("");
  const [errorForm, setErrorForm] = useState("");
  const [pendiente, setPendiente] = useState(false);

  const cargar = useCallback(async (signal?: AbortSignal) => {
    setCargando(true); setErrorLista("");
    try {
      const params = new URLSearchParams({ mes, page: String(page), page_size: "20" });
      if (categoria) params.set("categoria_gasto_id", categoria);
      const response = await fetch(`/api/tesoreria/gastos-operativos?${params}`, { signal });
      const body = await response.json();
      if (!response.ok || body.error) throw new Error(body.error?.message ?? "No se pudieron cargar los gastos");
      setLista(body.data);
    } catch (error) {
      if (signal?.aborted) return;
      setErrorLista(error instanceof Error ? error.message : "No se pudieron cargar los gastos");
    } finally { if (!signal?.aborted) setCargando(false); }
  }, [mes, categoria, page]);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => { void cargar(controller.signal); }, 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [cargar, version]);

  function abrir(nuevoModo: Modo, gasto: GastoOperativoListado | null = null) {
    setModo(nuevoModo); setSeleccionado(gasto); setCategoriaForm(gasto?.categoria_gasto_id ?? activas[0]?.id ?? "");
    setFecha(gasto?.fecha ?? diaActual()); setMonto(gasto?.monto ?? "");
    setDescripcion(gasto?.descripcion ?? ""); setMotivo(""); setErrorForm("");
  }
  async function guardar(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPendiente(true); setErrorForm("");
    try {
      const resultado = modo === "crear"
        ? await crearGastoOperativoAction({ categoria_gasto_id: categoriaForm, fecha, monto, descripcion })
        : modo === "editar" && seleccionado
          ? await editarGastoOperativoAction(seleccionado.id, { categoria_gasto_id: categoriaForm, fecha, monto, descripcion })
          : seleccionado ? await darDeBajaGastoOperativoAction(seleccionado.id, { deletion_reason: motivo }) : null;
      if (!resultado) return;
      if (resultado.error) { setErrorForm(resultado.error.message); return; }
      setModo(null); setVersion((v) => v + 1);
    } catch { setErrorForm("No se pudo guardar. Intentá nuevamente."); }
    finally { setPendiente(false); }
  }

  return <section className="space-y-5">
    <div className="rounded-xl border border-border bg-card p-4 space-y-4 sm:p-5">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1"><label htmlFor="gastos-mes" className="text-sm font-medium">Mes</label><Input id="gastos-mes" type="month" value={mes} onChange={(e) => { setMes(e.target.value); setPage(1); }} /></div>
        <div className="space-y-1"><label htmlFor="gastos-categoria" className="text-sm font-medium">Categoría</label>
          <select id="gastos-categoria" value={categoria} onChange={(e) => { setCategoria(e.target.value); setPage(1); }} className="h-10 min-w-48 rounded-md border border-input bg-background px-3 text-sm">
            <option value="">Todas</option>{categorias.map((c) => <option value={c.id} key={c.id}>{c.nombre}</option>)}
          </select></div>
        <Button type="button" onClick={() => abrir("crear")} disabled={activas.length === 0}><Plus className="size-4" /> Nuevo gasto</Button>
      </div>
      <div className="border-t border-border pt-4"><p className="text-xs uppercase tracking-wide text-muted-foreground">Total del período filtrado</p>
        <p className="text-2xl font-semibold tabular-nums text-foreground">$ {lista?.total ?? "0.00"}</p>
        <p className="text-xs text-muted-foreground">Monto total, sin IVA discriminado.</p></div>
    </div>
    {cargando ? <p role="status" className="text-muted-foreground">Cargando gastos…</p>
      : errorLista ? <div role="alert" className="rounded-lg border border-destructive p-4 text-destructive">{errorLista} <Button type="button" variant="outline" onClick={() => setVersion((v) => v + 1)}>Reintentar</Button></div>
      : !lista?.items.length ? <p className="rounded-lg border border-border bg-card p-6 text-muted-foreground">No hay gastos para este filtro. Total: $ 0.00.</p>
      : <div className="space-y-3">{lista.items.map((g) => <article key={g.id} className="rounded-lg border border-border bg-card p-4 sm:flex sm:items-center sm:justify-between sm:gap-4">
        <div><p className="font-semibold text-foreground">{g.descripcion}</p><p className="text-sm text-muted-foreground">{g.fecha.split("-").reverse().join("/")} · {g.categoria_nombre}</p></div>
        <div className="mt-3 flex items-center gap-2 sm:mt-0"><span className="mr-2 font-semibold tabular-nums">$ {g.monto}</span>
          <Button type="button" variant="outline" onClick={() => abrir("editar", g)} aria-label={`Editar ${g.descripcion}`}><Pencil className="size-4" /></Button>
          <Button type="button" variant="outline" onClick={() => abrir("baja", g)} aria-label={`Dar de baja ${g.descripcion}`}><Trash2 className="size-4" /></Button></div>
      </article>)}<div className="flex items-center justify-between text-sm text-muted-foreground"><span>{lista.total_registros} gastos</span>
        <div className="flex items-center gap-2"><Button variant="outline" type="button" disabled={page === 1} onClick={() => setPage(page - 1)}>Anterior</Button>
          <span>Página {page}</span><Button variant="outline" type="button" disabled={page * lista.page_size >= lista.total_registros} onClick={() => setPage(page + 1)}>Siguiente</Button></div></div></div>}
    <Dialog open={modo !== null} onOpenChange={(open) => { if (!open && !pendiente) setModo(null); }}><DialogContent className="w-full max-w-lg p-5" showCloseButton={!pendiente}>
      <DialogTitle>{modo === "crear" ? "Nuevo gasto operativo" : modo === "editar" ? "Editar gasto operativo" : "Dar de baja gasto operativo"}</DialogTitle>
      <DialogDescription>{modo === "baja" ? "El gasto dejará de sumar en el total. Indicá el motivo." : "El monto corresponde al total del gasto, sin IVA discriminado."}</DialogDescription>
      <form onSubmit={guardar} className="mt-4 space-y-4">
        {modo === "baja" ? <div className="space-y-1"><label htmlFor="gasto-motivo" className="text-sm font-medium">Motivo de baja</label>
          <textarea id="gasto-motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} minLength={5} required autoFocus className="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2" /></div>
          : <><div className="space-y-1"><label htmlFor="gasto-categoria" className="text-sm font-medium">Categoría</label>
            <select id="gasto-categoria" value={categoriaForm} onChange={(e) => setCategoriaForm(e.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3" required>
              {modo === "editar" && seleccionado && !activas.some((c) => c.id === seleccionado.categoria_gasto_id) && <option value={seleccionado.categoria_gasto_id}>{seleccionado.categoria_nombre} (inactiva, conservada)</option>}
              {activas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select></div>
            <div className="grid grid-cols-2 gap-3"><div className="space-y-1"><label htmlFor="gasto-fecha" className="text-sm font-medium">Fecha</label><Input id="gasto-fecha" type="date" value={fecha} max={diaActual()} onChange={(e) => setFecha(e.target.value)} required /></div>
              <div className="space-y-1"><label htmlFor="gasto-monto" className="text-sm font-medium">Monto total</label><Input id="gasto-monto" type="number" min="0.01" step="0.01" value={monto} onChange={(e) => setMonto(e.target.value)} required /></div></div>
            <div className="space-y-1"><label htmlFor="gasto-descripcion" className="text-sm font-medium">Descripción</label><textarea id="gasto-descripcion" value={descripcion} onChange={(e) => setDescripcion(e.target.value)} required className="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2" /></div></>}
        {errorForm && <p role="alert" className="text-sm text-destructive">{errorForm}</p>}
        <div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={pendiente} onClick={() => setModo(null)}>Cancelar</Button><Button type="submit" disabled={pendiente}>{pendiente ? "Guardando…" : modo === "baja" ? "Confirmar baja" : "Guardar"}</Button></div>
      </form></DialogContent></Dialog>
  </section>;
}
