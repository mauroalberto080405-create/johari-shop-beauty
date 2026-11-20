# Configuración de producción: Firebase y Culqi

La tienda funciona de inmediato en **modo demostración** (catálogo, cuentas y carrito en el navegador de cada persona). Para tener inventario compartido, cuentas reales y **pagos en línea**, sigue estos pasos.

> El repositorio no incluye credenciales. Hasta completar estos pasos, la tienda **no** está conectada a ningún backend ni cobra pagos.

## Resumen de la arquitectura

```
Navegador (HTML/CSS/JS)  ──►  Cloud Firestore      catálogo, usuarios, pedidos
        │                ──►  Firebase Auth        cuentas y verificación de correo
        │                ──►  Cloud Functions      createOrder / payOrder
        │                                               │
        └── Checkout Culqi (tokeniza tarjeta/Yape) ─────┴──►  API de Culqi (cobro con llave secreta)
```

- La **llave pública** de Culqi (`pk_…`) va en `js/config.js`.
- La **llave secreta** (`sk_…`) solo vive en Secret Manager y la usa `payOrder`. Nunca va en el HTML ni en el repositorio.
- El **monto se calcula en el servidor** con los precios de Firestore: el navegador no decide cuánto se cobra.
- Los datos de tarjeta van directo a Culqi: la tienda no los ve ni los guarda.

---

## 1. Proyecto de Firebase y app web

1. Crea un proyecto en <https://console.firebase.google.com>.
2. En **Configuración del proyecto → Tus apps**, agrega una app **Web** y copia `firebaseConfig`.
3. En `js/config.js` completa `FIREBASE` y cambia `MODE: 'firebase'`.

Los valores de `firebaseConfig` identifican el proyecto y pueden ser públicos. La seguridad la dan las reglas de Firestore y las Cloud Functions.

## 2. Authentication

1. **Authentication → Método de acceso → Correo electrónico/contraseña → Habilitar**.
2. **Configuración → Dominios autorizados**: agrega el dominio de la tienda (`localhost` ya viene autorizado).
3. Recomendado: protección contra la enumeración de correos y una política de contraseñas de al menos 8 caracteres.

Firebase Auth no funciona con `file://`: sirve la página por http(s) (por ejemplo, `python -m http.server 8080`).

## 3. Firestore y reglas

1. **Firestore Database → Crear base de datos** en modo producción (región sugerida: `southamerica-east1`).
2. Publica las reglas de `firestore.rules`:

```bash
firebase deploy --only firestore:rules
```

| Colección | Lectura | Escritura |
|---|---|---|
| `products` | Pública | Solo la administradora (correo verificado). Se validan campos, categoría, precio y stock. |
| `orders` | Solo la administradora | Nadie desde la web: solo las Cloud Functions. |
| `users/{uid}` | El propio usuario o la administradora | El usuario crea su perfil con `role: 'customer'` y solo puede cambiar su nombre. |
| `admins/{uid}` | El propio usuario | Nadie desde la web: se gestiona en la consola. |

## 4. Cuenta de la administradora

El rol no se concede comparando correos en JavaScript: lo da un documento que solo se crea desde la consola.

1. La dueña crea su cuenta en la tienda (**Ingresar → Crear cuenta**) con su correo y una contraseña elegida por ella.
2. Abre el correo de verificación y hace clic en el enlace.
3. En **Authentication → Usuarios**, copia su **UID**.
4. En **Firestore → Datos**, crea la colección `admins` con un documento cuyo ID sea ese UID (por ejemplo, con el campo `email`).
5. Al volver a ingresar, aparece el botón **Panel Administrador**.

## 5. Cargar el catálogo

En **Panel Administrador → Herramientas de catálogo → Importar productos del PDF que falten** se crean los 86 productos del catálogo inicial (sin duplicar ni sobrescribir). Después ingresa el stock real: los productos con «stock por confirmar» no se pueden comprar.

## 6. Pagos en línea con Culqi

### 6.1 Cuenta y llaves

1. Crea una cuenta en <https://www.culqi.com> y entra al **panel de integración** (ambiente de pruebas).
2. Copia la **llave pública** de pruebas (`pk_test_…`) en `js/config.js` → `CULQI.publicKey`.
3. Guarda la **llave secreta** de pruebas (`sk_test_…`) como secreto. El comando la pide de forma interactiva; no la escribas en ningún archivo:

```bash
firebase functions:secrets:set CULQI_SECRET_KEY
```

### 6.2 Plan Blaze

Cloud Functions y Secret Manager requieren el plan **Blaze** (pago por uso) de Firebase. Una tienda pequeña suele quedar dentro de la capa gratuita, pero configura una **alerta de presupuesto** en Google Cloud.

### 6.3 Desplegar las funciones

```bash
cd functions
```

```bash
npm install
```

```bash
npm test
```

```bash
firebase deploy --only functions
```

Si cambias la región de las funciones, actualiza también `FUNCTIONS_REGION` en `js/config.js`.

### 6.4 Probar en modo de pruebas

Usa las tarjetas y datos de Yape de prueba que publica Culqi en su documentación. En el panel de Culqi verás los cargos de prueba, y en **Panel Administrador → Pedidos pagados**, los pedidos con su estado.

### 6.5 Pasar a producción

Cuando Culqi apruebe la cuenta de la tienda, reemplaza `pk_test_…` por `pk_live_…` en `js/config.js` y actualiza el secreto con la `sk_live_…`.

### Estados de un pedido

| Estado | Significado |
|---|---|
| `pending_payment` | Creado; esperando el pago. |
| `processing` | Cobro en curso. |
| `paid` | Pagado; stock descontado. |
| `paid_stock_conflict` | Pagado, pero otro pedido se llevó el stock al mismo tiempo: la dueña debe coordinar con la clienta. |
| `needs_review` | No se pudo confirmar la respuesta de Culqi: revisar el cargo en el panel de Culqi. |

## 7. Publicar

Con Firebase Hosting (usa `firebase.json`):

```bash
firebase deploy --only hosting
```

También puedes seguir usando Netlify o GitHub Pages para el frontend. Las funciones y Firestore siguen en Firebase.

## Limitaciones conocidas

- **3D Secure:** algunos bancos exigen autenticación 3DS. Si Culqi responde que requiere 3DS, el pago se rechaza con su mensaje y la clienta puede usar otro medio o coordinar por WhatsApp. Integrar Culqi 3DS es una mejora pendiente.
- **Yape:** su disponibilidad en el checkout depende de que Culqi la habilite para la cuenta de la tienda.
- **Envío:** el costo de envío no se cobra en línea: se coordina por WhatsApp después del pago.
- **Imágenes:** las fotos subidas desde el panel se guardan dentro del documento del producto (máximo 1 MB). Para muchas fotos conviene Firebase Storage.
