// URL del backend. Vacía = modo demo (todo se simula en el navegador, ideal para GitHub Pages).
// Ejemplo: 'https://pilarbus-api.onrender.com'
const API_URL_POR_DEFECTO = '';

// También se puede cambiar sin tocar el código: ?api=https://mi-backend  (o ?api=demo para volver)
const parametro = new URLSearchParams(location.search).get('api');
if (parametro !== null) {
  if (parametro === 'demo' || parametro === '') localStorage.removeItem('pilarbus-api');
  else localStorage.setItem('pilarbus-api', parametro.replace(/\/$/, ''));
}

export const API_URL = localStorage.getItem('pilarbus-api') ?? API_URL_POR_DEFECTO;
