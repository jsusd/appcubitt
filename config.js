/**
 * Configuracion global de la aplicacion Cubitt POS
 *
 * IMPORTANTE: este repositorio es PÚBLICO. No pongas aquí claves secretas.
 * La API Key de Google Gemini se pega desde la app (Inventario > Facturas > Configurar IA)
 * y queda guardada solo en el navegador de ese dispositivo.
 */
window.CUBITT_CONFIG = {
  // Dejar vacío: la clave se configura desde la interfaz (se guarda en localStorage)
  GEMINI_API_KEY: '',
  // Modelo por defecto: Gemini 3.7 Flash (ultra estable y rapido, con fallback a 3.8 y 3.5)
  GEMINI_DEFAULT_MODEL: 'gemini-3.7-flash',
  // Configuracion de Base de Datos Principal en Google Sheets
  GOOGLE_SHEETS_SPREADSHEET_ID: '18a86QMObmZnX611SmtSBRLVIvZJRYHnqFSr5vFCBtIw',
  GOOGLE_SHEETS_GID_VENTAS: '1352847878',
  GOOGLE_SHEETS_NAME_VENTAS: 'ventas',
  GOOGLE_SHEETS_NAME_BDD: 'BDD',
  // URL del Web App de Google Apps Script (configurable en la UI)
  GOOGLE_APPS_SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbxDwLbsDM-sFYNHRpmmfUkQpOWE6PEWTMaxxWJ04z6GG5Ewhe0_hZiW77P6DOw8SYI/exec'
};
