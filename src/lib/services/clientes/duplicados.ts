/** Comparación informativa: ignora tildes, separadores y orden de palabras;
 * admite una errata en nombres de al menos seis caracteres. */
export function nombresSimilares(a: string, b: string) {
  const normalizar = (v: string) => v.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9\s]/g, " ").trim().split(/\s+/).sort().join(" ");
  const x = normalizar(a), y = normalizar(b);
  if (x === y) return true;
  if (Math.min(x.length, y.length) < 6 || Math.abs(x.length - y.length) > 1) return false;
  let anterior = Array.from({ length: y.length + 1 }, (_, i) => i);
  for (let i = 1; i <= x.length; i++) {
    const fila = [i];
    for (let j = 1; j <= y.length; j++) fila[j] = Math.min(fila[j - 1] + 1, anterior[j] + 1, anterior[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    anterior = fila;
  }
  return anterior[y.length] <= 1;
}
