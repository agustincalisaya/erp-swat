# HU-H4 — Recepción de Mercadería
## Documentación funcional y técnica completa

**Proyecto:** ERP SWAT  
**Módulo:** H — Compras / Proveedores  
**Historia de Usuario:** HU-H4 — Recepción de Mercadería  
**Versión funcional final:** H4 V2.1  
**Estado:** Implementada, validada y documentada  
**Rama final:** `feature/HU-H4-v2-1-recepcion`

---

# 1. Propósito de la HU

HU-H4 permite registrar la recepción física de mercadería asociada a una Orden de Compra confirmada.

El flujo final fue deliberadamente simplificado por decisión del Product Owner para representar únicamente el control operativo necesario:

```text
OC CONFIRMADA
→ visualizar materiales
→ seleccionar depósito destino
→ confirmar recepción
→ ingresar todo lo solicitado al stock
→ OC RECIBIDA_COMPLETA
```

La aplicación asume que la mercadería recibida llega completa y en condiciones correctas.

---

# 2. Evolución de la historia

## 2.1. Diseño inicial

La primera versión contemplaba:

- recepciones parciales;
- cantidades recibidas;
- cantidades aceptadas;
- saldos pendientes;
- discrepancias;
- recepción de una misma OC en múltiples oportunidades;
- productos no recibidos;
- transición a `RECEPCION_PARCIAL`.

Se desarrolló inicialmente una solución robusta que contemplaba esos casos.

## 2.2. Primera simplificación — H4 V2

El Product Owner indicó que no era necesario modelar:

```text
NO_RECIBIDO
DIFERIDO
PENDIENTE
```

y solicitó simplificar el nivel de abstracción.

Se eliminó del flujo operativo:

- saldo pendiente;
- múltiples recepciones;
- nuevas transiciones a `RECEPCION_PARCIAL`;
- producto diferido/no recibido como estado.

El flujo quedó:

```text
CONFIRMADA
→ recepción/control único
→ RECIBIDA_COMPLETA
```

## 2.3. Simplificación final — H4 V2.1

Durante la validación de la interfaz se decidió simplificar aún más:

- se asume recepción perfecta;
- se reciben todos los ítems de la OC;
- el usuario no ingresa cantidades;
- el usuario no ingresa discrepancias;
- se elimina remito;
- se eliminan observaciones;
- el backend deriva materiales y cantidades directamente de la OC;
- la pantalla se convierte en un listado de OC con detalle desplegable.

Esta es la versión funcional vigente.

---

# 3. Actor y permisos

Actores operativos:

- `ADMINISTRADOR`
- `ENCARGADO_DEPOSITO`

Permiso H4:

```text
recepciones:registrar
```

H4 no reutiliza:

```text
inventario:confirmar_recepcion
```

porque pertenece al flujo de transferencias internas del Módulo A.

También se preserva el permiso H3:

```text
ordenes_compra:leer
```

como permiso independiente.

---

# 4. Precondiciones

Una Orden de Compra es recepcionable únicamente si:

```text
estado = CONFIRMADA
is_active = true
deleted_at = null
```

y posee al menos un `OrdenCompraItem` activo.

Una OC sin ítems activos no debe aparecer en el listado y tampoco puede ser confirmada por API.

Error de dominio defensivo:

```text
ORDEN_SIN_ITEMS_RECEPCIONABLES
```

---

# 5. Flujo funcional vigente

```text
1. Usuario abre Recepción de Mercadería.
2. El sistema lista OC confirmadas.
3. Usuario puede filtrar por proveedor y fecha de emisión.
4. El listado se pagina de a 10 órdenes.
5. Usuario despliega una OC.
6. Sistema muestra todos los materiales.
7. Usuario selecciona depósito destino.
8. Usuario confirma.
9. Backend carga nuevamente la OC dentro de la transacción.
10. Backend deriva todos los ítems y cantidades.
11. Se crea Recepcion.
12. Se crean RecepcionItem.
13. Se actualiza StockDeposito.
14. Se crea MovimientoStock.
15. La OC pasa a RECIBIDA_COMPLETA.
16. Se confirma la transacción.
17. Se emiten efectos post-commit.
18. H5 registra evaluación de proveedor.
```

---

# 6. Regla de cantidades

Las cantidades no son una decisión del usuario.

Para cada `OrdenCompraItem` activo:

```text
cantidad_recibida = cantidad_solicitada
cantidad_aceptada = cantidad_solicitada
```

Ejemplo:

```text
OC:
Camisa táctica = 10
Borcegos       = 5

Recepción:
Camisa:
  recibida = 10
  aceptada = 10

Borcegos:
  recibida = 5
  aceptada = 5
```

El navegador no envía cantidades.

La Orden de Compra persistida es la fuente de verdad.

---

# 7. Productos incluidos

Una nueva recepción H4 V2.1 incluye todos los ítems activos de la OC.

No existe en el flujo vigente:

- omitir una línea;
- recibir cero;
- recibir menos;
- recibir más;
- aceptar menos;
- aceptar parcialmente;
- recibir posteriormente un faltante.

---

# 8. Discrepancias

Las nuevas recepciones H4 V2.1 no crean discrepancias.

No se utilizan operativamente:

```text
CANTIDAD
TALLE
COLOR
CALIDAD
```

Sin embargo, los modelos históricos se conservan:

```text
RecepcionDiscrepancia
TipoDiscrepancia
```

Esto mantiene compatibilidad con datos generados por versiones anteriores de H4.

No se eliminaron datos históricos ni se creó una migración para eliminarlos.

---

# 9. Remito y observaciones

Se eliminaron de la interfaz y del contrato H4 V2.1:

```text
numero_remito_proveedor
observaciones
```

Los campos siguen existiendo en `Recepcion` por compatibilidad histórica.

Las nuevas recepciones los dejan sin valor.

---

# 10. Depósito destino

Es la única decisión operativa ingresada por el usuario.

Debe ser:

- obligatorio;
- seleccionable;
- válido;
- activo según reglas existentes;
- persistido en `Recepcion.deposito_destino_id`.

---

# 11. Estado de la Orden de Compra

Transición H4 vigente:

```text
CONFIRMADA → RECIBIDA_COMPLETA
```

H4 V2.1 no produce nuevas:

```text
RECEPCION_PARCIAL
```

El valor permanece en el enum por compatibilidad con registros históricos.

H3 conserva la transición:

```text
RECIBIDA_COMPLETA → CERRADA
```

---

# 12. Interfaz de usuario

Ruta:

```text
/compras/recepciones/nueva
```

## 12.1. Tabla principal

Columnas:

```text
Orden
Proveedor
Fecha emisión
Ítems
Estado
Acción
```

La acción permite:

```text
Ver materiales
```

## 12.2. Detalle desplegable

Al expandir una OC:

```text
Materiales

Producto
SKU
Cantidad
```

Debajo se muestra:

```text
Recepción

Depósito destino [selector]
[Confirmar recepción]
```

## 12.3. Elementos eliminados

No se muestran:

- selector global de OC;
- remito;
- observaciones;
- cantidad recibida editable;
- cantidad aceptada editable;
- discrepancias;
- recibido anteriormente;
- saldo pendiente;
- recepción parcial.

## 12.4. Ajustes visuales

Se ajustaron:

- márgenes horizontales;
- paddings;
- alineación de Materiales y Recepción;
- separación vertical;
- alineación entre select y botón;
- comportamiento responsive.

---

# 13. Filtros

Los filtros se ejecutan en servidor.

## 13.1. Proveedor

Query param:

```text
proveedor_id
```

La UI ofrece:

```text
Todos los proveedores
```

y proveedores asociados a OC recepcionables.

El filtrado se realiza por ID.

## 13.2. Fecha de emisión

Query param:

```text
fecha_emision
```

Se utiliza:

```text
OrdenCompra.fecha_emision
```

La comparación se realiza por rango de día calendario:

```text
>= inicio del día
< inicio del día siguiente
```

## 13.3. Limpiar filtros

Restaura el listado general y vuelve a la primera página.

---

# 14. Paginación

Se muestran como máximo:

```text
10 OC por página
```

Query param:

```text
page
```

Conceptualmente:

```text
take = 10
skip = (page - 1) * 10
```

La consulta:

1. aplica filtros;
2. obtiene el total;
3. ordena;
4. aplica `skip`;
5. aplica `take`.

Los filtros se preservan al cambiar de página.

Al cambiar filtros:

```text
page = 1
```

---

# 15. Ordenamiento

Las órdenes se presentan de manera estable.

Orden principal:

```text
fecha_emision DESC
```

y se utiliza un desempate estable apropiado para evitar movimientos entre páginas cuando varias OC comparten fecha.

---

# 16. Listado de OC recepcionables

Servicio:

```text
listarOrdenesRecepcionables()
```

Responsabilidades:

- estado `CONFIRMADA`;
- activa;
- no eliminada;
- al menos un ítem activo;
- filtro proveedor;
- filtro fecha;
- orden;
- paginación;
- límite.

Información requerida:

```text
id
numero_orden
fecha_emision
estado
proveedor
items
producto
SKU
cantidad_solicitada
```

---

# 17. Contrato API

Endpoint:

```text
POST /api/ordenes-compra/[id]/recepciones
```

Permiso:

```text
recepciones:registrar
```

Payload final:

```json
{
  "deposito_destino_id": "uuid",
  "clave_idempotencia": "uuid"
}
```

La Orden de Compra se determina por el `[id]` del path.

El schema es estricto.

Se rechazan payloads legacy que intenten enviar:

- `items`;
- `cantidad_recibida`;
- `cantidad_aceptada`;
- `discrepancias`;
- `numero_remito_proveedor`;
- `observaciones`.

---

# 18. Servicio de recepción

El servicio carga dentro de la transacción:

- OrdenCompra;
- proveedor;
- OrdenCompraItem activos;
- VarianteSKU;
- cantidad solicitada.

El backend construye todos los `RecepcionItem`.

No utiliza ítems ni cantidades provenientes del cliente.

---

# 19. Atomicidad

La recepción mantiene en la misma transacción:

```text
Recepcion
+ RecepcionItem
+ StockDeposito
+ MovimientoStock
+ estado OrdenCompra
```

Esto impide estados parciales ante fallos.

Si falla el ingreso de stock:

```text
rollback completo
```

---

# 20. Inventario

Se reutiliza:

```text
registrarIngresoStockTx()
```

sin modificar el núcleo compartido de Inventario.

Para cada SKU:

```text
StockDeposito += cantidad_solicitada
```

Se crea como máximo un `MovimientoStock` por recepción.

---

# 21. Trazabilidad

Se mantiene:

```text
MovimientoStock
→ Recepcion
→ OrdenCompra
→ Proveedor
```

Esto permite identificar el origen comercial de cada ingreso H4.

---

# 22. Idempotencia

Campos existentes:

```text
clave_idempotencia
payload_hash
```

La intención canónica V2.1 contiene:

```text
orden_compra_id
deposito_destino_id
```

No contiene datos derivados del servidor.

Reglas:

```text
misma clave + misma intención
→ misma recepción

misma clave + intención diferente
→ conflicto
```

Se conserva manejo de carrera `P2002`.

Un retry idempotente no repite:

- recepción;
- stock;
- movimiento;
- transición OC;
- auditoría;
- H5.

---

# 23. Concurrencia

Se conserva:

```text
Serializable
retry P2034
updateMany condicionado por CONFIRMADA
```

Si dos usuarios confirman la misma OC:

```text
1 recepción exitosa
1 recepción rechazada
1 Recepcion persistida
1 MovimientoStock
OC = RECIBIDA_COMPLETA
```

No se agregó `UNIQUE(orden_compra_id)` en Prisma.

---

# 24. Auditoría

Se conserva el evento:

```text
recepcion:registrada
```

Debe permitir identificar:

- recepción;
- OC;
- número de orden;
- depósito;
- usuario;
- fecha;
- estado anterior;
- estado nuevo.

Transición auditada:

```text
CONFIRMADA → RECIBIDA_COMPLETA
```

Los retries idempotentes no duplican AuditLog.

---

# 25. Integración con H3

H3 conserva sus contratos.

H4 produce:

```text
RECIBIDA_COMPLETA
```

H3 posteriormente puede ejecutar:

```text
RECIBIDA_COMPLETA → CERRADA
```

Se preservó:

```text
ordenes_compra:leer
```

No se reemplazó por `ordenes_compra:crear`.

---

# 26. Integración con H5

H5 no fue modificada.

Después del commit:

```ts
registrarEvaluacionDesdeRecepcion(recepcionId, usuarioId)
```

Se mantiene una evaluación por recepción.

Las nuevas recepciones V2.1 no generan discrepancias.

Si H5 falla post-commit:

- H4 no se revierte;
- se registra el fallo;
- permanece el comportamiento operativo definido previamente.

---

# 27. Integración con G8

G8 no fue modificado.

Flujo:

```text
H4:
OC → RECIBIDA_COMPLETA

H3:
CERRAR

G8:
CuentaPorPagar → DEFINITIVA
```

No existe efecto G8 directo desde la recepción.

---

# 28. Integración con H9

H9 no fue modificado.

Una OC:

```text
RECIBIDA_COMPLETA
```

o:

```text
CERRADA
```

continúa siendo compatible con el registro de comprobantes.

---

# 29. Prisma

H4 V2.1 no modifica:

```text
prisma/schema.prisma
```

No elimina campos históricos.

No elimina `RECEPCION_PARCIAL`.

No elimina discrepancias.

---

# 30. Migraciones

H4 V2.1 no crea nuevas migraciones.

Se mantienen las migraciones previas ya integradas en `develop`.

---

# 31. Seed

La seed fue actualizada y mergeada previamente por el equipo.

Durante H4 V2.1:

```text
prisma/seed.ts
```

se tomó como fuente de verdad y no se modificó.

No se deben sobrescribir fixtures compartidos de:

- H3;
- H5;
- G8;
- H9;
- A9;
- permisos;
- roles.

---

# 32. Detección de OC sin ítems

Durante prueba visual se detectó una OC confirmada con cero ítems visibles.

Causa:

La relación `items` se filtraba, pero la consulta no exigía existencia de al menos un ítem activo.

Corrección:

```ts
items: {
  some: {
    is_active: true,
    deleted_at: null
  }
}
```

Además se mantiene defensa backend:

```text
ORDEN_SIN_ITEMS_RECEPCIONABLES
```

y defensa visual.

---

# 33. Datos generados por integración

Los tests pueden crear registros:

```text
IT-H4V21-*
```

Estos registros pueden quedar persistidos en la base utilizada para integración.

No deben eliminarse manualmente sin revisar:

- Recepcion;
- MovimientoStock;
- EvaluacionProveedor;
- AuditLog;
- StockDeposito.

La limpieza automática de integración queda separada del alcance funcional H4.

---

# 34. Prueba visual

Se realizaron pruebas manuales de:

- listado;
- OC confirmadas;
- materiales;
- SKU;
- cantidades;
- depósito;
- confirmación;
- bloqueo de OC vacías;
- filtros;
- paginación;
- márgenes;
- alineaciones.

La interfaz fue aprobada visualmente tras los ajustes.

---

# 35. Tests

Se trabajó con pruebas unitarias e integración PostgreSQL.

Cobertura final incluye:

- schema mínimo;
- rechazo de payload legacy;
- derivación de todos los ítems;
- cantidades solicitada/recibida/aceptada coherentes;
- cero discrepancias nuevas;
- OC sin ítems;
- transición final;
- segunda recepción;
- idempotencia;
- P2002;
- P2034;
- concurrencia;
- rollback;
- stock;
- trazabilidad;
- H5;
- AuditLog;
- filtros;
- límite;
- paginación;
- ordenamiento.

---

# 36. Validaciones técnicas ejecutadas

```text
npx prisma validate
npx prisma migrate status
npm run lint
npm test
npm run test:integration:h4
npm run build
npx tsc --noEmit
git diff --check
```

La prueba de integración H4 se ejecutó sin `skip`.

---

# 37. Archivos principales

```text
src/lib/schemas/recepciones.schema.ts
src/lib/services/proveedores/recepcion-idempotencia.ts
src/lib/services/proveedores/recepcion-reglas.ts
src/lib/services/proveedores/recepcion.service.ts
src/app/api/ordenes-compra/[id]/recepciones/route.ts
src/components/compras/FormularioRecepcionMercaderia.tsx
src/app/(dashboard)/compras/recepciones/nueva/page.tsx
src/lib/services/proveedores/recepcion.test.ts
src/lib/services/proveedores/recepcion.integration.test.ts
```

---

# 38. Archivos compartidos preservados

No se modificaron funcionalmente como parte de V2.1:

```text
prisma/schema.prisma
prisma/migrations/**
prisma/seed.ts
orden-compra.service.ts
evaluacion.service.ts
movimiento.service.ts
G8
H9
A9
A11
event-types.ts
audit-log.listener.ts
Sidebar
```

---

# 39. Criterios de aceptación finales

- [x] OC confirmadas visibles.
- [x] OC sin ítems excluidas.
- [x] Materiales desplegables.
- [x] Producto, SKU y cantidad visibles.
- [x] Depósito seleccionable.
- [x] Sin cantidades editables.
- [x] Sin discrepancias.
- [x] Sin remito.
- [x] Sin observaciones.
- [x] Backend deriva todos los ítems.
- [x] Recibida = solicitada.
- [x] Aceptada = solicitada.
- [x] Stock por totalidad solicitada.
- [x] OC `RECIBIDA_COMPLETA`.
- [x] Segunda recepción bloqueada.
- [x] API estricta.
- [x] Idempotencia.
- [x] Concurrencia.
- [x] Rollback.
- [x] Auditoría.
- [x] Trazabilidad.
- [x] H3 preservado.
- [x] H5 preservado.
- [x] G8 preservado.
- [x] H9 preservado.
- [x] Filtro proveedor.
- [x] Filtro fecha.
- [x] 10 OC por página.
- [x] Paginación.
- [x] Validación visual aprobada.
- [x] Prisma sin cambios V2.1.
- [x] Seed sin cambios V2.1.

---

# 40. Estado final

```text
HU-H4 V2.1
IMPLEMENTADA
VALIDADA
DOCUMENTADA
LISTA PARA CIERRE
```
