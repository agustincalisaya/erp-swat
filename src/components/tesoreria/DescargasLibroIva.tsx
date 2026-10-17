"use client";

import { useEffect, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, BookOpen, CalendarDays, ChevronLeft, ChevronRight, Download, FileText, LoaderCircle, RefreshCw, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { LibroIvaVista, TipoLibroIva } from "@/lib/services/tesoreria/libro-iva.constants";
import { fechaLibro, MESES_LIBRO, monedaLibro, periodoLibro, tipoComprobanteLibro } from "@/lib/services/tesoreria/libro-iva.presentacion";

type Resultado = { libro?: LibroIvaVista; error?: string };
const TAMANO_PAGINA = 15;
const TIPOS = ["VENTAS", "COMPRAS"] as const;
// text-sidebar-foreground explícito: la regla base de globals.css pinta los <select> con --foreground,
// que en tema claro es oscuro y no se lee sobre el encabezado bg-sidebar (oscuro en ambos temas).
const SELECTOR_PERIODO = "min-w-0 cursor-pointer rounded-md bg-transparent px-1 py-2 text-sm font-medium text-sidebar-foreground outline-none [color-scheme:dark] focus-visible:ring-2 focus-visible:ring-sidebar-primary disabled:cursor-not-allowed";

async function mensajeError(respuesta: Response): Promise<string> {
  const datos = await respuesta.json().catch(() => null);
  if (respuesta.status === 401) return "Tu sesión venció. Volvé a iniciar sesión para continuar.";
  if (respuesta.status === 403) return "Tu usuario no tiene permiso para consultar el Libro de IVA.";
  const incidencias = datos?.error?.details?.incidencias as { comprobante_id: string }[] | undefined;
  return (datos?.error?.message || "No se pudo cargar el libro. Intentá nuevamente.") +
    (incidencias?.length ? ` Comprobantes: ${incidencias.map((i) => i.comprobante_id).join(", ")}.${datos.error.details.hay_mas ? " Hay más registros para revisar." : ""}` : "");
}

export function DescargasLibroIva({ mesInicial }: { mesInicial: string }) {
  const [mes, setMes] = useState(mesInicial);
  const [tipo, setTipo] = useState<TipoLibroIva>("VENTAS");
  const [resultados, setResultados] = useState<Record<TipoLibroIva, Resultado>>({ VENTAS: {}, COMPRAS: {} });
  const [cargando, setCargando] = useState(true);
  const [revision, setRevision] = useState(0);
  const [busqueda, setBusqueda] = useState("");
  const [pagina, setPagina] = useState(1);
  const [descargando, setDescargando] = useState<"pdf" | "txt" | null>(null);
  const [errorDescarga, setErrorDescarga] = useState("");
  const [estado, setEstado] = useState("");

  useEffect(() => {
    const abortador = new AbortController();
    async function cargar() {
      const entradas = await Promise.all(TIPOS.map(async (libroTipo) => {
        try {
          const respuesta = await fetch(`/api/tesoreria/libro-iva/${libroTipo.toLowerCase()}?mes=${mes}&formato=json`, {
            credentials: "same-origin", cache: "no-store", signal: abortador.signal,
          });
          if (!respuesta.ok) return [libroTipo, { error: await mensajeError(respuesta) }] as const;
          const datos = await respuesta.json();
          return [libroTipo, { libro: datos.data as LibroIvaVista }] as const;
        } catch {
          return [libroTipo, { error: "No pudimos conectarnos. Revisá tu conexión y volvé a intentar." }] as const;
        }
      }));
      if (!abortador.signal.aborted) {
        setResultados(Object.fromEntries(entradas) as Record<TipoLibroIva, Resultado>);
        setCargando(false);
      }
    }
    void cargar();
    return () => abortador.abort();
  }, [mes, revision]);

  function cambiarMes(nuevo: string) {
    if (!/^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(nuevo) || nuevo === mes) return;
    setMes(nuevo); setPagina(1); setBusqueda(""); setEstado(""); setErrorDescarga(""); setCargando(true);
  }
  function moverMes(delta: number) {
    const [anio, numero] = mes.split("-").map(Number);
    const fecha = new Date(Date.UTC(anio!, numero! - 1 + delta, 1));
    if (fecha.getUTCFullYear() < 1000 || fecha.getUTCFullYear() > 9999) return;
    cambiarMes(`${fecha.getUTCFullYear()}-${String(fecha.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  async function descargar(formato: "pdf" | "txt") {
    setDescargando(formato); setErrorDescarga(""); setEstado("");
    try {
      const respuesta = await fetch(`/api/tesoreria/libro-iva/${tipo.toLowerCase()}?mes=${mes}&formato=${formato}`, { credentials: "same-origin", cache: "no-store" });
      if (!respuesta.ok) throw new Error(await mensajeError(respuesta));
      const url = URL.createObjectURL(await respuesta.blob());
      const nombre = /filename\*=UTF-8''([^;]+)/i.exec(respuesta.headers.get("Content-Disposition") ?? "")?.[1];
      const enlace = document.createElement("a");
      try {
        enlace.href = url;
        enlace.download = nombre ? decodeURIComponent(nombre) : `Libro_IVA_${tipo.toLowerCase()}_${mes}.${formato}`;
        document.body.appendChild(enlace); enlace.click();
      } finally {
        enlace.remove(); setTimeout(() => URL.revokeObjectURL(url), 1_000);
      }
      setEstado(`Libro de ${tipo.toLowerCase()} descargado en ${formato.toUpperCase()}.`);
    } catch (error) {
      setErrorDescarga(error instanceof Error ? error.message : "No se pudo descargar el archivo.");
    } finally { setDescargando(null); }
  }

  const resultado = resultados[tipo];
  const libro = cargando ? undefined : resultado.libro;
  const termino = busqueda.trim().toLocaleLowerCase("es-AR");
  const filtradas = (libro?.filas ?? []).filter((fila) => !termino ||
    [fila.denominacion, fila.numero_doc, `${fila.pv}-${fila.numero}`, tipoComprobanteLibro(fila.tipo), fechaLibro(fila.fecha)].some((valor) => valor.toLocaleLowerCase("es-AR").includes(termino)));
  const paginas = Math.max(1, Math.ceil(filtradas.length / TAMANO_PAGINA));
  const visibles = filtradas.slice((pagina - 1) * TAMANO_PAGINA, pagina * TAMANO_PAGINA);
  const ocupado = descargando !== null;
  // Años del selector: ventana alrededor del mes inicial, ampliada si anterior/siguiente sale de ella.
  const anioInicial = Number(mesInicial.slice(0, 4));
  const anioActual = Number(mes.slice(0, 4));
  const anios: string[] = [];
  for (let a = Math.max(Math.min(anioActual, anioInicial - 10), 1000); a <= Math.min(Math.max(anioActual, anioInicial + 1), 9999); a++) anios.push(String(a));

  return <div className="space-y-6">
    <header className="relative overflow-hidden rounded-2xl bg-sidebar p-6 text-sidebar-foreground sm:p-8">
      <div aria-hidden className="pointer-events-none absolute -right-10 -top-24 size-80 rounded-full border-[44px] border-sidebar-primary/10" />
      <div className="relative flex flex-col justify-between gap-6 xl:flex-row xl:items-center">
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-sidebar-primary"><BookOpen className="size-4" aria-hidden />Tesorería</div>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Libro de IVA</h1>
          <p className="text-sm text-sidebar-muted-foreground">Tus ventas y compras, en un solo lugar.</p>
        </div>
        <div className="relative space-y-2">
          <label htmlFor="mes-libro-iva" className="text-xs font-medium uppercase tracking-wider text-sidebar-muted-foreground">Período contable</label>
          <div className="flex items-center gap-2 rounded-xl border border-sidebar-border bg-sidebar-accent/50 p-2">
            <button aria-label="Mes anterior" disabled={ocupado || mes === "1000-01"} onClick={() => moverMes(-1)} className="rounded-lg p-2 transition hover:bg-sidebar-border disabled:opacity-40"><ChevronLeft className="size-4" /></button>
            <CalendarDays className="hidden size-4 text-sidebar-primary sm:block" aria-hidden />
            <select id="mes-libro-iva" aria-label="Mes" value={mes.slice(5, 7)} disabled={ocupado} onChange={(e) => cambiarMes(`${mes.slice(0, 4)}-${e.target.value}`)} className={SELECTOR_PERIODO}>
              {MESES_LIBRO.map((nombre, i) => <option key={nombre} value={String(i + 1).padStart(2, "0")}>{nombre}</option>)}
            </select>
            <select aria-label="Año" value={mes.slice(0, 4)} disabled={ocupado} onChange={(e) => cambiarMes(`${e.target.value}-${mes.slice(5, 7)}`)} className={SELECTOR_PERIODO}>
              {anios.map((anio) => <option key={anio} value={anio}>{anio}</option>)}
            </select>
            <button aria-label="Mes siguiente" disabled={ocupado || mes === "9999-12"} onClick={() => moverMes(1)} className="rounded-lg p-2 transition hover:bg-sidebar-border disabled:opacity-40"><ChevronRight className="size-4" /></button>
          </div>
        </div>
      </div>
    </header>
    <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
      <div className="inline-flex w-fit gap-1 rounded-xl border bg-card p-1" aria-label="Tipo de libro">
        {TIPOS.map((opcion) => {
          const Icono = opcion === "VENTAS" ? ArrowUpRight : ArrowDownLeft;
          return <button key={opcion} aria-pressed={tipo === opcion} disabled={ocupado} onClick={() => { setTipo(opcion); setPagina(1); setBusqueda(""); setEstado(""); setErrorDescarga(""); }} className={`flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition ${tipo === opcion ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted"}`}>
            <Icono className="size-4" aria-hidden />{opcion === "VENTAS" ? "Ventas" : "Compras"}
            <span className={`rounded-md px-1.5 py-0.5 text-xs ${tipo === opcion ? "bg-white/15" : "bg-muted"}`}>{cargando ? "…" : resultados[opcion].libro?.totales.comprobantes ?? "—"}</span>
          </button>;
        })}
      </div>
      <button onClick={() => { setCargando(true); setPagina(1); setRevision((r) => r + 1); }} disabled={cargando || ocupado} className="inline-flex items-center gap-2 self-start rounded-md px-2 py-2 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50 sm:self-auto"><RefreshCw className={`size-3.5 ${cargando ? "animate-spin" : ""}`} aria-hidden />Actualizar datos</button>
    </div>
    <section aria-label="Resumen del período" aria-busy={cargando} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {[
        { titulo: "Comprobantes", valor: libro ? String(libro.totales.comprobantes) : "—", pie: libro ? `${libro.totales.notas_credito} ${libro.totales.notas_credito === 1 ? "nota" : "notas"} de crédito` : "Cantidad del período", principal: false },
        { titulo: "Neto gravado", valor: libro ? monedaLibro(libro.totales.neto) : "—", pie: "Importe sin IVA", principal: false },
        { titulo: "IVA del período", valor: libro ? monedaLibro(libro.totales.iva) : "—", pie: "Alícuota 21%", principal: false },
        { titulo: tipo === "VENTAS" ? "Total de ventas" : "Total de compras", valor: libro ? monedaLibro(libro.totales.total) : "—", pie: "Pesos argentinos", principal: true },
      ].map((tarjeta) => <div key={tarjeta.titulo} className={`min-w-0 rounded-xl border p-5 ${tarjeta.principal ? "border-primary/20 bg-secondary" : "bg-card"}`}>
        <p className="text-sm text-muted-foreground">{tarjeta.titulo}</p><p className={`my-3 break-words text-2xl font-semibold tracking-tight tabular-nums ${cargando ? "animate-pulse" : ""}`}>{tarjeta.valor}</p><p className="text-xs text-muted-foreground">{tarjeta.pie}</p>
      </div>)}
    </section>
    <section className="overflow-hidden rounded-xl border bg-card" aria-label={`Libro de ${tipo.toLowerCase()}`}>
      <div className="flex flex-col justify-between gap-4 border-b p-5 lg:flex-row lg:items-center">
        <div><h2 className="text-lg font-semibold">Detalle de {tipo.toLowerCase()}</h2><p className="mt-1 text-sm text-muted-foreground">{periodoLibro(mes)}</p></div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => descargar("pdf")} disabled={!libro || ocupado} className="gap-2">{descargando === "pdf" ? <LoaderCircle className="size-4 animate-spin" /> : <FileText className="size-4" />}Descargar PDF</Button>
          <Button variant="outline" onClick={() => descargar("txt")} disabled={!libro || ocupado} className="gap-2">{descargando === "txt" ? <LoaderCircle className="size-4 animate-spin" /> : <Download className="size-4" />}Exportar TXT</Button>
        </div>
      </div>
      <div className="flex flex-col justify-between gap-3 px-5 py-4 sm:flex-row sm:items-center">
        <div className="relative w-full sm:max-w-sm"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden /><Input aria-label="Buscar comprobantes" placeholder={`Buscar ${tipo === "VENTAS" ? "cliente" : "proveedor"}, documento o número…`} value={busqueda} disabled={!libro} onChange={(e) => { setBusqueda(e.target.value); setPagina(1); }} className="pl-9 pr-9" />{busqueda && <button aria-label="Limpiar búsqueda" onClick={() => { setBusqueda(""); setPagina(1); }} className="absolute right-3 top-1/2 -translate-y-1/2"><X className="size-4" /></button>}</div>
        <span className="text-xs text-muted-foreground">Importes en ARS</span>
      </div>
      {cargando ? <div role="status" className="flex min-h-64 items-center justify-center gap-3 text-sm text-muted-foreground"><LoaderCircle className="size-5 animate-spin" />Cargando comprobantes…</div>
        : resultado.error ? <div role="alert" className="m-5 rounded-xl border border-destructive/20 bg-destructive/5 p-5"><p className="font-medium text-destructive">No se pudo preparar el libro de {tipo.toLowerCase()}</p><p className="mt-2 break-words text-sm text-muted-foreground">{resultado.error}</p></div>
          : !visibles.length ? <div className="flex min-h-64 flex-col items-center justify-center gap-3 px-6 text-center"><div className="rounded-2xl bg-muted p-4"><BookOpen className="size-7 text-muted-foreground" /></div><h3 className="font-medium">{busqueda ? "No encontramos coincidencias" : "Sin comprobantes en este período"}</h3><p className="max-w-sm text-sm text-muted-foreground">{busqueda ? "Probá con otro nombre, documento o número." : "Elegí otro mes para consultar sus movimientos."}</p></div>
            : <div className="overflow-x-auto"><table className="w-full min-w-[1000px] text-sm"><caption className="sr-only">Comprobantes de {tipo.toLowerCase()} de {periodoLibro(mes)}</caption><thead className="border-y bg-muted/60 text-xs text-muted-foreground"><tr>{["Fecha", "Comprobante", tipo === "VENTAS" ? "Cliente" : "Proveedor", "Documento", "Neto", "IVA", "Total"].map((titulo, i) => <th key={titulo} scope="col" className={`px-5 py-3 font-medium ${i > 3 ? "text-right" : "text-left"}`}>{titulo}</th>)}</tr></thead><tbody className="divide-y">{visibles.map((fila) => {
              const esNC = fila.tipo === "003" || fila.tipo === "008";
              return <tr key={fila.id} className="transition hover:bg-muted/35"><td className="whitespace-nowrap px-5 py-4 text-muted-foreground">{fechaLibro(fila.fecha)}</td><td className="px-5 py-4"><span className={`inline-block rounded-md px-2 py-1 text-xs font-medium ${esNC ? "bg-warning text-warning-foreground" : "bg-secondary text-foreground"}`}>{tipoComprobanteLibro(fila.tipo)}</span><p className="mt-1.5 whitespace-nowrap font-mono text-xs text-muted-foreground">{fila.pv}-{fila.numero}</p></td><td className="max-w-56 break-words px-5 py-4 font-medium">{fila.denominacion}</td><td className="whitespace-nowrap px-5 py-4 text-xs text-muted-foreground">{fila.tipo_doc === "99" ? "—" : `${fila.tipo_doc === "80" ? "CUIT" : "DNI"} ${fila.numero_doc}`}</td>{(["neto", "iva", "total"] as const).map((campo) => <td key={campo} className={`whitespace-nowrap px-5 py-4 text-right tabular-nums ${esNC ? "text-warning-foreground" : ""} ${campo === "total" ? "font-semibold" : ""}`}>{monedaLibro(fila[campo], false)}</td>)}</tr>;
            })}</tbody><tfoot className="border-t bg-muted/50 font-semibold"><tr><td colSpan={4} className="px-5 py-4 text-xs">TOTAL DEL PERÍODO · {libro?.totales.comprobantes} comprobantes</td>{(["neto", "iva", "total"] as const).map((campo) => <td key={campo} className="whitespace-nowrap px-5 py-4 text-right tabular-nums">{monedaLibro(libro!.totales[campo], false)}</td>)}</tr></tfoot></table></div>}
      {libro && filtradas.length > 0 && <div className="flex flex-wrap items-center justify-between gap-3 border-t px-5 py-4 text-xs text-muted-foreground"><p>{(pagina - 1) * TAMANO_PAGINA + 1}–{Math.min(pagina * TAMANO_PAGINA, filtradas.length)} de {filtradas.length} comprobantes{busqueda ? " encontrados" : ""}</p><div className="flex items-center gap-3"><Button variant="outline" size="icon" aria-label="Página anterior" disabled={pagina === 1} onClick={() => setPagina((p) => p - 1)}><ChevronLeft className="size-4" /></Button><span>{pagina} / {paginas}</span><Button variant="outline" size="icon" aria-label="Página siguiente" disabled={pagina === paginas} onClick={() => setPagina((p) => p + 1)}><ChevronRight className="size-4" /></Button></div></div>}
    </section>
    <p role="status" aria-live="polite" className="text-sm text-muted-foreground">{estado}</p>
    {errorDescarga && <p role="alert" className="break-words rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{errorDescarga}</p>}
  </div>;
}
