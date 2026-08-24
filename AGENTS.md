<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# CONSTITUCIÓN DEL PROYECTO - ERP SWAT INDUMENTARIAS (RULES.md)

Este documento establece las reglas arquitectónicas y de dominio transversales de cumplimiento obligatorio para los 6 desarrolladores del equipo y sus respectivos agentes de IA (Claude, ChatGPT, y OpenCode + Claude).

## 1. Principio de Baja Lógica (Soft Delete)

**Regla N.° 1: Restricción Estricta de Borrado Físico**
Queda terminantemente prohibido el uso de sentencias `DELETE` en la base de datos a través del código de la aplicación. Los datos nunca se eliminan físicamente para preservar la integridad referencial, el historial operativo y cumplir con normativas de auditoría.

- **Atributos Obligatorios:** Toda tabla transaccional o de entidades maestras debe incluir de manera obligatoria las siguientes columnas en su esquema:
  - `is_active` (Boolean, por defecto: true)
  - `deleted_at` (Timestamp, anulable/nullable)
  - `created_at` (Timestamp, generado automáticamente en inserción)
  - `updated_at` (Timestamp, actualizado en cada modificación)
- **Comportamiento de Consultas:** Todos los repositorios, ORMs o consultas directas a la base de datos (ej. sentencias `SELECT`) deben filtrar por defecto los registros inactivos (añadiendo implícitamente `WHERE is_active = true` o `WHERE deleted_at IS NULL`), salvo que el módulo solicitante sea explícitamente el área de Auditoría buscando datos históricos.

## 2. Seguridad, Auditoría y Ley N.° 25.326

**Regla N.° 2: Protección de Datos Personales y Trazabilidad Inalterable**
Dado que el sistema gestiona información institucional y personal de efectivos de las Fuerzas de Seguridad, el diseño técnico debe garantizar el cumplimiento irrestricto de la Ley N.° 25.326 de Protección de Datos Personales.

- **Cifrado AES-256 (Datos en Reposo):** Toda información sensible (legajos institucionales, historiales biométricos/talles, datos identificatorios) debe estar cifrada a nivel de base de datos utilizando el estándar AES-256.
- **Log de Auditoría inalterable (Traceability):** Toda acción que modifique el estado del sistema (inserción, actualización, baja lógica, ajustes de stock manuales, cambios de precios) debe registrarse en un log de eventos.
- **Encadenamiento de Hash SHA-256:** Para garantizar que el log de auditoría sea de "solo lectura" y a prueba de manipulaciones internas, cada nuevo registro de auditoría debe calcular y almacenar un hash SHA-256 que incluya los datos de la transacción actual concatenados con el hash del evento inmediatamente anterior (Blockchain-like hashing).

## 3. Stack Tecnológico y Arquitectura

El desarrollo del ERP debe ceñirse estrictamente al siguiente stack autorizado para garantizar mantenibilidad, concurrencia y portabilidad:

- **Frontend:** Next.js (App Router) implementado bajo los lineamientos de una PWA (Progressive Web App). Debe garantizar un diseño Mobile-First adaptable para operaciones tanto en escritorio de gerencia como en dispositivos móviles en el depósito.
- **Backend & APIs:** Entorno de ejecución Node.js con arquitectura modular (REST/GraphQL).
- **Base de Datos:** Motor relacional PostgreSQL 16 o superior.
- **Infraestructura:** Uso obligatorio de Docker y Docker Compose para la contenerización de la aplicación, asegurando paridad total entre los entornos de Desarrollo, Staging y Producción.
- **Directrices de Inyección de Credenciales:** Está absolutamente prohibido incrustar (hardcodear) contraseñas, cadenas de conexión o claves de API en el código fuente. Toda credencial y configuración del entorno debe ser inyectada dinámicamente en tiempo de despliegue mediante variables de entorno y/o gestores de secretos dentro del contenedor Docker.

## 4. Reglas de Integración

**Regla N.° 3: Aislamiento del Dominio mediante Patrones de Diseño**
La lógica central de negocio (Core) no debe acoplarse bajo ninguna circunstancia a librerías, SDKs o APIs de terceros.

- **Patrones Adapter / Gateway:** Cualquier comunicación con servicios externos debe implementarse de forma obligatoria encapsulando la lógica detrás de los patrones _Adapter_ o _Gateway_.
- **Servicios Afectados:** Esta regla aplica, de forma no excluyente, a las siguientes integraciones críticas:
  - **AFIP:** Para la facturación electrónica y consulta de padrones.
  - **Mercado Pago:** Para el procesamiento de transacciones en el POS y E-Commerce.
  - **WhatsApp:** Para el motor de notificaciones y avisos automáticos a clientes.
- El dominio de la aplicación se comunicará únicamente con interfaces abstractas propias; recae en el Adapter la responsabilidad de traducir y mapear las solicitudes al contrato del proveedor externo específico.
