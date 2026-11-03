# PilarBus – Frontend

Sitio web estático (HTML + CSS + JavaScript, sin compilación) pensado para **GitHub Pages**.
Mapa con [Leaflet](https://leafletjs.com/) y teselas de OpenStreetMap.

## Dos modos de funcionamiento

| Modo | Cuándo | Qué hace |
|---|---|---|
| **Demo** (por defecto) | `API_URL` vacía en [js/config.js](js/config.js) | Simula el backend dentro del navegador: colectivos moviéndose, detección automática de desvíos, reclamos con foto, SUBE, login y panel admin. Los datos se guardan en `localStorage`. |
| **Conectado** | `API_URL` con la URL del backend | Usa la API REST y Socket.IO de [`backend/`](../backend). |

GitHub Pages solo sirve archivos estáticos, así que **el backend no puede correr ahí**: para el modo
conectado hay que hostearlo aparte (Render, Railway, Fly.io, una VM…) con HTTPS y `CORS_ORIGIN`
apuntando a la URL de Pages.

Para probar contra otro backend sin tocar el código: `…/pilar-bus/?api=https://mi-backend` (queda guardado;
`?api=demo` vuelve al modo demo).

### Cuentas de prueba (modo demo)

- Pasajero: `pasajero@pilarbus.local` / `pasajero123`
- Admin: `admin@pilarbus.local` / `admin123`

## Funcionalidades

- **Mapa:** líneas, recorrido, paradas y colectivos en tiempo real; al tocar una parada se ven los próximos arribos.
- **Alertas de desvíos:** listado por línea, notificación en pantalla y suscripción a líneas. En demo, el botón *Simular desvío* saca un colectivo de su recorrido para ver la detección automática.
- **Reclamos:** texto + foto opcional, con seguimiento del estado y la respuesta.
- **SUBE:** vincular tarjeta, saldo y últimos viajes (simulados hasta que exista acceso a la API oficial).
- **Admin:** cargar y finalizar desvíos y gestionar los reclamos.

## Correr en local

```bash
# desde la raíz del repo
python -m http.server 8080 --directory frontend
# abrir http://localhost:8080
```

Para el modo conectado con el backend local: `http://localhost:8080/?api=http://localhost:3000`.

## Publicar en GitHub Pages

1. En el repo: **Settings → Pages → Source: GitHub Actions**.
2. Hacer push a `main`: el workflow [`.github/workflows/pages.yml`](../.github/workflows/pages.yml) publica la carpeta `frontend/`.
3. Queda en `https://<usuario-u-organización>.github.io/pilar-bus/`.

Todas las rutas son relativas y la navegación usa `#hash`, por lo que funciona bajo la subruta `/pilar-bus/`
sin configuración extra.

## Estructura

```
index.html          vistas: mapa, reclamos, SUBE, admin, cuenta
css/estilos.css
js/config.js        URL del backend (vacía = demo)
js/app.js           interfaz y navegación
js/geo.js           cálculos de distancia (los mismos que el backend)
js/api/index.js     elige demo o remoto
js/api/demo.js      backend simulado en el navegador
js/api/remoto.js    cliente HTTP + Socket.IO del backend real
js/api/datos-demo.js
```
