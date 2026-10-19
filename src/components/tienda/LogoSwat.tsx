/** Marca SWAT vectorial; las formas viven en el SVG público y los colores siguen el tema activo. */
export function LogoSwat() {
  return (
    <svg
      aria-hidden="true"
      className="h-8 w-auto shrink-0 sm:h-11"
      viewBox="0 0 240 62.97"
      xmlns="http://www.w3.org/2000/svg"
      focusable="false"
    >
      <use href="/tienda-assets/logo-swat-tactical.svg#logo-ink" style={{ color: "var(--swat-logo-ink)" }} />
      <use href="/tienda-assets/logo-swat-tactical.svg#logo-olive" style={{ color: "var(--swat-logo-olive)" }} />
    </svg>
  );
}
