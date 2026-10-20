import { diaNegocioIso, rangoMesNegocio } from "@/lib/utils/fecha-negocio";

/** Devuelve null ante una query inválida; jamás usa la fecha del navegador. */
export function interpretarMesReporte(valor: string | null | undefined, ahora: Date = new Date()) {
  const mesIso = valor ?? diaNegocioIso(ahora).slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mesIso)) return null;
  const anio = Number(mesIso.slice(0, 4));
  const mes = Number(mesIso.slice(5, 7));
  try {
    rangoMesNegocio(anio, mes);
  } catch {
    return null;
  }
  return { anio, mes, mesIso };
}
