const functions = require('firebase-functions');
const admin = require('firebase-admin');
const https = require('https');

admin.initializeApp();

/**
 * Cloud Function Callable para consultar DNI en RENIEC
 * Se llama desde JavaScript del cliente sin problemas de CORS
 */
exports.buscarDNI = functions.https.onCall(async (data, context) => {
  console.log('>>> INICIO BUSCAR DNI (Modern Fetch Mode) <<<');

  try {
    // 1. Validar DNI
    const { dni } = data;
    if (!dni || dni.length !== 8) {
      console.warn('!!! DNI inválido recibido:', dni);
      throw new functions.https.HttpsError('invalid-argument', 'El DNI debe tener 8 dígitos numéricos.');
    }

    // 2. Obtener API Key
    let apiKey = process.env.DECOLECTA_API_KEY;
    if (!apiKey) {
      console.warn('DECOLECTA_API_KEY no encontrada en process.env. Usando fallback...');
      apiKey = 'sk_13286.LuIyPsunop5MnmBCLhcxoRCCA7StWWZQ';
    }

    const apiUrl = `https://api.decolecta.com/v1/reniec/dni?numero=${dni}`;
    console.log(`Consultando: ${apiUrl}`);

    // 3. Consulta vía Fetch (Node 20+)
    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      signal: AbortSignal.timeout(10000) // Timeout de 10s
    });

    const responseText = await response.text();
    console.log('Status API:', response.status);

    if (!response.ok) {
      console.error(`Error de API (${response.status}):`, responseText);

      if (response.status === 401 || response.status === 403) {
        throw new functions.https.HttpsError('unauthenticated', 'Error de autenticación con el servicio RENIEC. Verifique la API Key.');
      }

      if (response.status === 404) {
        throw new functions.https.HttpsError('not-found', 'DNI no encontrado en la base de datos de RENIEC.');
      }

      throw new functions.https.HttpsError('internal', `Servicio RENIEC devolvió error ${response.status}: ${responseText}`);
    }

    let resJson;
    try {
      resJson = JSON.parse(responseText);
    } catch (e) {
      console.error('Error al parsear respuesta JSON:', e);
      throw new functions.https.HttpsError('internal', 'La respuesta del servicio RENIEC no es un JSON válido.');
    }

    if (!resJson || !resJson.first_name) {
      console.warn('Respuesta vacía o sin nombre:', resJson);
      throw new functions.https.HttpsError('not-found', 'No se encontraron datos para el DNI proporcionado.');
    }

    const nombre = `${resJson.first_name} ${resJson.first_last_name || ''} ${resJson.second_last_name || ''}`.trim();
    console.log('Nombre obtenido:', nombre);

    return {
      success: true,
      data: { nombre, ...resJson }
    };

  } catch (error) {
    console.error('Error en buscarDNI:', error);

    // Si ya es un HttpsError de Firebase, relanzarlo
    if (error instanceof functions.https.HttpsError) throw error;

    // Manejar errores de Fetch (timeout/red)
    if (error.name === 'TimeoutError') {
      throw new functions.https.HttpsError('deadline-exceeded', 'La consulta a RENIEC tardó demasiado. Reintente en un momento.');
    }

    throw new functions.https.HttpsError('internal', error.message || 'Error inesperado al consultar RENIEC.');
  }
});

/**
 * Cloud Function Callable para obtener registros de acceso
 */
exports.obtenerRegistros = functions.https.onCall(async (data, context) => {
  try {
    const { limit = 50 } = data || {};
    const limitNum = Math.min(Math.max(parseInt(limit) || 50, 1), 500);

    const snapshot = await admin
      .firestore()
      .collection('accesos')
      .orderBy('timestamp', 'desc')
      .limit(limitNum)
      .get();

    const registros = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    return {
      success: true,
      data: registros
    };

  } catch (error) {
    console.error('Error en obtenerRegistros:', error);
    throw new functions.https.HttpsError(
      'internal',
      'Error al obtener registros'
    );
  }
});

