# HU-2 — Registro de Ingreso de Mercadería por Escaneo (Módulo A)

**Estado:** Implementado y verificado — incluye soporte dual de escaneo (Barcode Detection API nativa + fallback ZXing), fallback de carga manual, control transaccional de stock por estado de destino y registro inmutable de auditoría.
**Metodología:** Specification-Driven Development (SDD).
**Documentos fuente:** `Documento Alcance Funcional Tecnico SWAT.docx`, `Product Backlog SWAT Indumentarias.xlsx`, `RULES.md`.

---

# PARTE 1 — Referencia Técnica (estado actual, verificado)

> Esta sección describe **cómo funciona la funcionalidad hoy**, confirmado con pruebas reales de backend y frontend (PWA en Next.js, Server Actions, transacciones de Prisma y eventos de dominio).

## 1.1. Alcance funcional

**Actor:** Encargado de Depósito.  
**Ruta:** `/inventario/movimientos`

**Objetivo:** Registrar el ingreso físico de mercadería mediante escaneo de códigos de barras (EAN-13 / Code128) o códigos QR (incluyendo soporte conceptual de serializados para artículos críticos como chalecos antibalas), impactando atómicamente el stock y generando un registro inmutable en `movimientos_stock`.

## 1.2. Semántica de dominio e impacto en stock

El sistema discrimina el inventario por depósito y estado comercial. La tabla de inventario `StockDeposito.cantidad` representa el stock **disponible / vendible** y se actualiza según la dirección definida por el `estado_destino`:
SUMA DISPONIBLE (+)  <--- [DISPONIBLE, DEVUELTO]
RESTA DISPONIBLE (-) <--- [RESERVADO, VENDIDO, BAJA_MERMA, EN_TRANSITO]

La regla está tipada exhaustivamente mediante `IMPACTO_STOCK_POR_ESTADO_DESTINO` en `inventario.schema.ts`.

## 1.3. Modelo de datos y entidades afectadas

* **`VarianteSKU`:** Búsqueda por `sku` o `ean_qr`, exigiendo `is_active = true` y `deleted_at = null`. Se revalida dentro de la transacción Prisma para evitar condiciones de carrera.
* **`StockDeposito`:**
  * Si el estado **SUMA**: Ejecuta `upsert` sobre `[variante_sku_id, deposito_id]`, incrementando la cantidad disponible.
  * Si el estado **RESTA**: Aplica un `updateMany` condicionado a `cantidad: { gte: input.cantidad }` de forma atómica en PostgreSQL. Si el disponible es insuficiente, la transacción aborta con `ServiceError("STOCK_INSUFICIENTE")`.
* **`MovimientoStock`:** Creación de fila inmutable (`tipo_movimiento = 'INGRESO'`, `deposito_origen_id = null`, `deposito_destino_id = deposito_id`, `estado_destino`, `cantidad`, `comprobante_referencia`, `registrado_por_id`).
* **`Usuario`:** `registrado_por_id = getServerSession().userId`.

## 1.4. Endpoints y Server Actions implementados

| Endpoint / Action | Método / Tipo | Estado | Verificación |
|---|---|---|---|
| `/api/inventario/escaner/resolver` | `POST` | ✅ Implementado | Resolución de SKU por código óptico o tipeado manual; validación de variantes activas (`200`, `400`, `404`) |
| `resolverCodigoEscaneoAction()` | Server Action | ✅ Implementado | Consumo directo desde el hook de escaneo de la PWA |
| `registrarIngresoStockAction()` | Server Action | ✅ Implementado | Ejecución transaccional completa (`prisma.$transaction`), persistencia inmutable y disparo de eventos de dominio |

## 1.5. Criterios de Aceptación Verificados (Gherkin)

```gherkin
Feature: Ingreso de mercadería por escaneo (HU-2)

  Scenario: Ingreso exitoso mediante escaneo con cámara
    Given el Encargado de Depósito tiene una sesión activa en la PWA
    And apunta la cámara a una etiqueta con código EAN-13 de una variante activa
    When el motor de escaneo (BarcodeDetector nativo o ZXing) decodifica el código
    And el sistema resuelve una VarianteSKU activa para ese código
    Then se muestra la ficha del producto (SKU, talle, color) en el panel de confirmación
    And el estado del panel pasa a "confirmando"

  Scenario: Confirmación y registro transaccional estado que suma disponible
    Given el panel de confirmación muestra una variante resuelta con estado_destino = DISPONIBLE (o DEVUELTO)
    And se indicó depósito destino, cantidad y comprobante de referencia
    When el Encargado de Depósito confirma el ingreso
    Then se incrementa StockDeposito.cantidad para esa variante y depósito dentro de una transacción
    And se crea un registro inmutable en movimientos_stock con tipo_movimiento = "INGRESO"
    And se emite el evento de dominio inventario:ingreso_stock_registrado
    And el panel vuelve automáticamente a modo escaneo para el siguiente ítem

  Scenario: Confirmación y registro estado que resta disponible
    Given el panel de confirmación muestra una variante resuelta con estado_destino en RESERVADO, VENDIDO, BAJA_MERMA o EN_TRANSITO
    And el depósito seleccionado tiene disponible suficiente para la cantidad indicada
    When el Encargado de Depósito confirma el ingreso
    Then se decrementa StockDeposito.cantidad de forma atómica
    And se crea el registro inmutable en movimientos_stock con tipo_movimiento = "INGRESO"
    And si el resultado cae al punto de pedido o por debajo, se emite stock:umbral_critico_alcanzado

  Scenario: Stock disponible insuficiente para restar
    Given el estado_destino elegido resta disponible (ej. VENDIDO)
    And la cantidad solicitada supera el StockDeposito.cantidad actual del depósito
    When el Encargado de Depósito confirma el ingreso
    Then la transacción aborta con ServiceError("STOCK_INSUFICIENTE")
    And no se crea ningún registro en movimientos_stock (rollback completo)
    And el disponible del depósito queda intacto

  Scenario: Código no registrado en el catálogo activo
    Given el Encargado de Depósito escanea o carga manualmente un código
    When ninguna VarianteSKU activa coincide (ni por sku ni por ean_qr)
    Then el sistema responde "Código no registrado en catálogo activo."
    And el panel permanece en modo escaneo sin abrir la confirmación

  Scenario: Permiso de cámara denegado
    Given el navegador deniega el permiso de cámara
    When se intenta iniciar el escaneo
    Then el visor muestra "Permiso de cámara denegado. Habilitalo en la configuración del navegador."
    And el campo de carga manual sigue disponible como vía alternativa

  Scenario: Cantidad inválida
    Given el Encargado de Depósito está confirmando un ingreso
    When ingresa una cantidad <= 0, decimal o vacía
    Then el formulario rechaza el envío con "La cantidad debe ser mayor a 0"
    And no se crea ningún movimiento de inventario

  Scenario: Comprobante de referencia demasiado extenso
    Given el Encargado de Depósito completa el comprobante de referencia
    When el texto supera los 100 caracteres
    Then el formulario rechaza el envío con "Máximo 100 caracteres"

  Scenario: Detección duplicada dentro de la ventana de debounce
    Given la cámara decodificó un código hace menos de 1500 ms
    When el mismo código vuelve a detectarse en un frame posterior
    Then la detección se descarta silenciosamente
    And no se dispara una nueva resolución de SKU