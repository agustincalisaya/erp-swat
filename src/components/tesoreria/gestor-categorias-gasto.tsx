"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Trash2 } from "lucide-react";
import type { CategoriaGastoListado } from "@/lib/services/tesoreria/categoria-gasto.service";
import { crearCategoriaGastoAction, editarCategoriaGastoAction, darDeBajaCategoriaGastoAction } from "@/app/(dashboard)/tesoreria/categorias-gasto/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

type Modo = "crear" | "editar" | "baja";

export function GestorCategoriasGasto({ categorias }: { categorias: CategoriaGastoListado[] }) {
  const router = useRouter();
  const [incluirInactivas, setIncluirInactivas] = useState(false);
  const [modo, setModo] = useState<Modo | null>(null);
  const [seleccionada, setSeleccionada] = useState<CategoriaGastoListado | null>(null);
  const [nombre, setNombre] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState("");
  const [pendiente, setPendiente] = useState(false);
  const visibles = categorias.filter((c) => incluirInactivas || c.is_active);

  function abrir(siguiente: Modo, categoria: CategoriaGastoListado | null = null) {
    setModo(siguiente); setSeleccionada(categoria);
    setNombre(categoria?.nombre ?? ""); setDescripcion(categoria?.descripcion ?? "");
    setMotivo(""); setError("");
  }

  async function guardar(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPendiente(true); setError("");
    try {
      const resultado = modo === "crear"
        ? await crearCategoriaGastoAction({ nombre, descripcion })
        : modo === "editar" && seleccionada
          ? await editarCategoriaGastoAction(seleccionada.id, { nombre, descripcion })
          : seleccionada
            ? await darDeBajaCategoriaGastoAction(seleccionada.id, { deletion_reason: motivo })
            : null;
      if (!resultado) return;
      if (resultado.error) { setError(resultado.error.message); return; }
      setModo(null); router.refresh();
    } catch { setError("No se pudo guardar. Intentá nuevamente."); }
    finally { setPendiente(false); }
  }

  return <section className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <label className="flex min-h-11 items-center gap-2 text-sm text-foreground">
        <input type="checkbox" checked={incluirInactivas} onChange={(e) => setIncluirInactivas(e.target.checked)} className="size-4 accent-primary" />
        Incluir categorías dadas de baja
      </label>
      <Button type="button" onClick={() => abrir("crear")}><Plus className="size-4" aria-hidden="true" /> Nueva categoría</Button>
    </div>

    {visibles.length === 0
      ? <p className="rounded-lg border border-border bg-card p-6 text-muted-foreground">No hay categorías para este filtro.</p>
      : <div className="grid gap-3">
        {visibles.map((c) => <article key={c.id} className="rounded-lg border border-border bg-card p-4 sm:flex sm:items-center sm:justify-between sm:gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold text-foreground">{c.nombre}</h2>
              <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">{c.is_active ? "Activa" : "Dada de baja"}</span></div>
            {c.descripcion && <p className="mt-1 text-sm text-muted-foreground">{c.descripcion}</p>}
            {!c.is_active && c.deletion_reason && <p className="mt-1 text-xs text-muted-foreground">Motivo: {c.deletion_reason}</p>}
          </div>
          {c.is_active && <div className="mt-3 flex gap-2 sm:mt-0">
            <Button type="button" variant="outline" onClick={() => abrir("editar", c)}><Pencil className="size-4" aria-hidden="true" /> Editar</Button>
            <Button type="button" variant="outline" onClick={() => abrir("baja", c)}><Trash2 className="size-4" aria-hidden="true" /> Dar de baja</Button>
          </div>}
        </article>)}
      </div>}

    <Dialog open={modo !== null} onOpenChange={(open) => { if (!open && !pendiente) setModo(null); }}>
      <DialogContent className="w-full max-w-lg p-5" showCloseButton={!pendiente}>
        <DialogTitle>{modo === "crear" ? "Nueva categoría" : modo === "editar" ? `Editar ${seleccionada?.nombre}` : `Dar de baja ${seleccionada?.nombre}`}</DialogTitle>
        <DialogDescription>{modo === "baja" ? "El nombre permanecerá visible en los gastos históricos." : "Completá los datos de la categoría de gasto."}</DialogDescription>
        <form onSubmit={guardar} className="mt-4 space-y-4">
          {modo === "baja" ? <div className="space-y-1"><label htmlFor="categoria-motivo" className="text-sm font-medium">Motivo de baja</label>
            <textarea id="categoria-motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} minLength={5} required autoFocus className="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-base text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
            <p className="text-xs text-muted-foreground">Mínimo 5 caracteres. Los gastos históricos conservarán esta categoría.</p></div>
          : <><div className="space-y-1"><label htmlFor="categoria-nombre" className="text-sm font-medium">Nombre</label>
              <Input id="categoria-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} required autoFocus /></div>
            <div className="space-y-1"><label htmlFor="categoria-descripcion" className="text-sm font-medium">Descripción (opcional)</label>
              <textarea id="categoria-descripcion" value={descripcion} onChange={(e) => setDescripcion(e.target.value)} className="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-base text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" /></div></>}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={pendiente} onClick={() => setModo(null)}>Cancelar</Button>
            <Button type="submit" disabled={pendiente}>{pendiente ? "Guardando…" : modo === "baja" ? "Confirmar baja" : "Guardar"}</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  </section>;
}
