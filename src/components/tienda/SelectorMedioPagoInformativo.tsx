/**
 * @component SelectorMedioPagoInformativo
 * @description HU-E15 (E15-3, docs/modulos/modulo E/HU15_MODULO_E.md D3/P5) —
 * selector INFORMATIVO del medio de pago en "Pago pendiente". Única opción:
 * Mercado Pago; las tarjetas de crédito y débito se cargan dentro de su
 * checkout (CA1 de HU-E2: SWAT nunca recibe datos de tarjeta).
 *
 * Solo visual: no está dentro de ningún formulario, no tiene handlers y su
 * valor no viaja en ningún request — el body de `POST /api/tienda/checkout`
 * no cambia. Control nativo, misma convención que `SegmentoCliente`.
 */
import styles from "@/components/tienda/compra.module.css";

export function SelectorMedioPagoInformativo() {
  return (
    <fieldset className={styles.paymentMethods}>
      <legend className={styles.paymentMethodsLegend}>Medio de pago</legend>
      <label className={styles.paymentMethod}>
        <input type="radio" name="medio_pago_informativo" value="MERCADO_PAGO" checked readOnly />
        <span>
          <strong>Mercado Pago</strong>
          <span className={styles.paymentMethodHint}>
            Incluye tarjeta de crédito y débito dentro del checkout de Mercado Pago.
          </span>
        </span>
      </label>
    </fieldset>
  );
}
