/** HU-E8 (spec E §2.8.a): validación presencial y recuperación de cuentas web. Solo rol VENDEDOR. */
export const PERMISO_VALIDAR_IDENTIDAD_CLIENTE_WEB = "ventas:validar_identidad_cliente_web";

/** HU-E4 (spec E §2.4.e): administración de cupones de descuento. Asignado solo al Administrador E-commerce. */
export const PERMISO_GESTIONAR_CUPONES = "ecommerce:gestionar_cupones";

/** HU-E5 (spec E §2.5): visibilidad web y baja lógica del contenido. Asignado solo al Administrador E-commerce. */
export const PERMISO_GESTIONAR_CATALOGO = "ecommerce:gestionar_catalogo";

/** HU-E7 (spec E §2.7): anulación manual de una orden web no abonada. Asignado solo al Administrador E-commerce. */
export const PERMISO_ANULAR_ORDEN_NO_ABONADA = "ecommerce:anular_orden_no_abonada";
