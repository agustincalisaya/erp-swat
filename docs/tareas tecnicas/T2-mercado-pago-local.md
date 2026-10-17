# T2 — Mercado Pago local y plan de demostración

**Tipo:** tarea técnica transversal. **Hito:** prueba integral antes del corte intermedio del 16/10. **Consumidores:** flujo de HU-E2/E15 y registro de cobros de HU-G11; permite demostrar E16 por separado. **Fuente:** `sprint_5_swat_indumentarias_erp.md`, T2.

## Objetivo

Dejar reproducible una compra de prueba de extremo a extremo en desarrollo, tanto con credenciales de sandbox cuando estén disponibles como con el adaptador simulado. El simulador opera por el mismo webhook firmado que usa la aplicación; no se agrega un botón «Simular pago» al producto.

## Configuración documentada

| ID | Condición de cierre |
|---|---|
| T2-1 | La guía indica cómo configurar `MP_MODO`, `APP_PUBLIC_URL`, `ENCRYPTION_KEY_PROVEEDORES` y, para sandbox real, las credenciales del conector de Mercado Pago. Explica qué valores son de desarrollo y dónde se inyectan sin guardarlos en el repositorio. |
| T2-2 | `MP_MODO=simulado` solo funciona fuera de producción; el adaptador y `npm run mp:firmar` rechazan explícitamente `NODE_ENV=production`, antes de escribir `.mp-simulador/pagos.json`, imprimir una firma o contactar el webhook. Hay una prueba automatizada de esa guarda. |
| T2-3 | La guía muestra el uso de `npm run mp:firmar -- --pago <id> --estado approved --monto <total> --ref <pedido_id> --url <APP_PUBLIC_URL>`, y explica que genera el pago local, la firma y los encabezados del POST al webhook. El total y la referencia deben coincidir con el pedido de prueba. La firma tiene vigencia limitada; ante expiración se genera otra. |
| T2-4 | La prueba con el simulador crea pedido/reserva, muestra total y vencimiento de E15, envía el webhook firmado, confirma el pago, registra exactamente un ingreso de G11 y deja el pedido en el estado esperado. Repetir el webhook no duplica venta, cobro, stock ni auditoría. |
| T2-5 | Se prueban al menos rechazo de pago, enlace de checkout ausente y reserva vencida: la interfaz conserva las acciones y mensajes definidos por E2/E15 y no inventa un medio de pago alternativo. |
| T2-6 | Si se usa sandbox, la guía incluye una prueba con credenciales de prueba y la misma secuencia observable. Una falla externa de sandbox queda documentada y se ejecuta el camino simulado para la demostración, sin ocultar el resultado de la prueba real. |

## Secuencia local sugerida

1. Preparar una base de desarrollo aislada, un conector activo de prueba y las variables anteriores. Usar la clave de cifrado requerida por el conector; no copiar claves a evidencias ni archivos versionados.
2. Iniciar aplicación y crear un pedido web con un cliente de prueba. Registrar ID, total congelado y hora de vencimiento.
3. Con `MP_MODO=simulado`, crear y firmar la notificación con `npm run mp:firmar` y los argumentos de T2-3. Enviar de inmediato el POST que imprime el script al endpoint local.
4. Verificar estado de pago, movimiento de Tesorería y ausencia de duplicados tras repetir el POST. Probar las ramas de rechazo y vencimiento en pedidos distintos.

## Riesgo concreto detectado al preparar esta tarea

El archivo actual `scripts/firmar-webhook-mp.ts` llama `guardarPagoSimulado` y genera la firma sin comprobar `NODE_ENV`. La guarda de `src/lib/integraciones/mercadopago/simulador.ts` está en `simuladorActivo()`, pero `guardarPagoSimulado()` no la invoca. **T2-2 requiere agregar una guarda al script antes de considerarlo terminado.** Esta tarea documenta el requisito; no declara que ya esté implementado.

**Evidencia de cierre:** configuración sin secretos, pasos reproducibles, respuesta del webhook y consultas que prueben una sola acreditación, casos de fallo y resultado de la guarda de producción.
