const functions = require('firebase-functions');
const admin = require('firebase-admin');
const https = require('https');

admin.initializeApp();

/**
 * Cloud Function Callable para consultar DNI en RENIEC
 * Se llama desde JavaScript del cliente sin problemas de CORS
 */
exports.buscarDNI = functions.https.onCall(async (data, context) => {
  console.log('>>> INICIO BUSCAR DNI (Super-Debug Mode) <<<');

  try {
    // 1. Validar DNI
    const { dni } = data;
    if (!dni || dni.length !== 8) {
      console.warn('!!! DNI inválido recibido:', dni);
      throw new functions.https.HttpsError('invalid-argument', 'El DNI debe tener 8 dígitos.');
    }

    // 2. Obtener API Key (Prioridad .env -> hardcoded fallback)
    let apiKey = process.env.DECOLECTA_API_KEY;
    if (!apiKey) {
      console.warn('DECOLECTA_API_KEY no encontrada en process.env. Usando fallback...');
      apiKey = 'sk_13286.LuIyPsunop5MnmBCLhcxoRCCA7StWWZQ';
    }

    // 3. Consulta vía HTTPS nativo
    const options = {
      hostname: 'api.decolecta.com',
      path: `/v1/reniec/dni?numero=${dni}`,
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      timeout: 10000
    };

    console.log(`Llamando a DeColecta: ${options.hostname}${options.path}`);

    return new Promise((resolve, reject) => {
      const req = https.request(options, (res) => {
        let responseData = '';
        console.log('Status code API:', res.statusCode);

        res.on('data', (chunk) => { responseData += chunk; });

        res.on('end', () => {
          try {
            console.log('Respuesta recibida.');

            if (res.statusCode !== 200) {
              return reject(new functions.https.HttpsError('internal', `Error API (${res.statusCode}): ${responseData}`));
            }

            const resJson = JSON.parse(responseData);
            if (!resJson || !resJson.first_name) {
              return reject(new functions.https.HttpsError('not-found', 'DNI no encontrado.'));
            }

            const nombre = `${resJson.first_name} ${resJson.first_last_name || ''} ${resJson.second_last_name || ''}`.trim();
            resolve({
              success: true,
              data: { nombre, ...resJson }
            });
          } catch (parseError) {
            console.error('Error parseando JSON:', parseError);
            reject(new functions.https.HttpsError('internal', 'Error al procesar la respuesta.'));
          }
        });
      });

      req.on('error', (e) => {
        console.error('Error de red HTTPS:', e);
        reject(new functions.https.HttpsError('internal', `Error de conexión: ${e.message}`));
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new functions.https.HttpsError('deadline-exceeded', 'La consulta tardó demasiado.'));
      });

      req.end();
    });

  } catch (error) {
    console.error('Error CRÍTICO en buscarDNI:', error);
    if (error instanceof functions.https.HttpsError) throw error;
    throw new functions.https.HttpsError('internal', error.message || 'Error desconocido');
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

