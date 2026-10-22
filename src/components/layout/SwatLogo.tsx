import { cn } from "@/lib/utils";

type SwatLogoProps = {
  variant: "full" | "icon";
  className?: string;
};

// Trazados de la marca ya vectorizada en tienda-assets/logo-swat-tactical.svg.
// El PNG LogoLayout.png define los colores de esta versión para el ERP.
const emblemaMarfil =
  "M4.54,18.68 4.54,11.07 4.80,10.81 26.95,0.00 26.95,8.81 12.54,15.74 12.54,23.75Z M30.28,0.13 52.70,10.81 52.83,18.68 44.82,23.88 44.82,15.61 30.28,8.81Z M11.61,46.03 28.68,57.50 45.63,46.03 45.89,46.03 45.89,50.83 28.68,62.97 12.01,51.23 11.61,50.83Z";
const emblemaMenta =
  "M16.28,26.28 28.55,12.14 41.09,26.02 40.82,26.55 37.22,28.55 28.55,22.28 20.14,28.55Z M0.00,18.41 26.28,35.22 26.68,35.62 26.68,43.09 0.27,26.82 0.00,26.55Z M30.82,43.09 30.82,35.62 31.08,35.35 57.63,18.41 57.50,26.68 31.75,42.82Z M4.54,31.75 26.68,45.49 26.68,53.10 4.80,39.22 4.54,38.96Z M30.82,53.10 30.82,45.63 31.22,45.23 52.83,31.75 52.96,38.69 52.70,39.22Z";
const letrasMarfil =
  "M56.56,52.03 64.17,43.36 93.79,43.23 93.79,39.62 93.39,39.49 71.37,39.49 63.90,32.95 63.90,26.02 71.91,17.74 99.66,17.88 103.79,27.22 74.71,27.35 74.84,30.82 96.99,30.82 98.59,30.95 100.59,32.95 105.66,38.16 105.79,44.56 105.66,45.23 98.72,51.76 98.19,52.16Z M102.99,17.74 115.13,17.74 122.87,34.55 131.01,17.74 137.68,17.88 145.41,34.55 153.82,17.74 166.89,17.88 149.55,52.03 141.15,52.16 134.07,37.49 126.87,51.76 126.47,52.16 120.60,52.16 118.20,52.03Z M154.49,52.16 173.96,17.74 188.24,17.88 207.05,51.76 206.38,52.16 193.97,52.03 180.90,28.15 167.69,52.03Z M192.51,17.74 236.80,17.74 240.00,24.41 236.93,27.35 222.66,27.35 222.66,52.03 209.98,52.16 209.98,27.35 197.58,27.22Z";
const acentoA = "M171.96,52.03 181.03,35.89 189.84,52.03Z";

/** Marca decorativa: el elemento que la contiene aporta el nombre accesible. */
export function SwatLogo({ variant, className }: SwatLogoProps) {
  const full = variant === "full";
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox={full ? "0 0 240 62.97" : "0 0 57.63 62.97"}
      className={cn("block h-auto shrink-0", className)}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path fill="#F5F5ED" d={emblemaMarfil} />
      <path fill="#6CF0AB" d={emblemaMenta} />
      {full && <path fill="#F5F5ED" d={letrasMarfil} />}
      {full && <path fill="#6CF0AB" d={acentoA} />}
    </svg>
  );
}
