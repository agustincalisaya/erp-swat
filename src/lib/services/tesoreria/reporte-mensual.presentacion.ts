const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];
const MESES_CORTOS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

export function nombreMesReporte(mesIso: string, abreviado = false): string {
  const indice = Number(mesIso.slice(5, 7)) - 1;
  const nombre = (abreviado ? MESES_CORTOS : MESES)[indice];
  return nombre ? `${nombre}${abreviado ? "" : ` ${mesIso.slice(0, 4)}`}` : mesIso;
}

export function dineroReporte(valor: string): string {
  const signo = valor.startsWith("-") ? "−" : "";
  const [entero, centavos = "00"] = (signo ? valor.slice(1) : valor).split(".");
  return `${signo}$ ${entero.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${centavos}`;
}
