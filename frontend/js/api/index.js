// Elige la implementación según haya o no backend configurado
import { API_URL } from '../config.js';

const modulo = API_URL ? await import('./remoto.js') : await import('./demo.js');

export const api = modulo.api;
