const functions = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp();

/**
 * Cloud Function Callable para consultar DNI en RENIEC
 * Se llama desde JavaScript del cliente sin problemas de CORS
 */
exports.buscarDNI = functions.https.onCall(async (data, context) => {
  try {
    const { dni } = data;

    console.log('=== buscarDNI CALLABLE ===');
    console.log('DNI recibido:', dni);

    // Validaciones
    if (!dni) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'DNI no proporcionado'
      );
    }

    if (dni.length !== 8 || !/^\d+$/.test(dni)) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'DNI inválido. Debe tener 8 dígitos'
      );
    }

    // Obtener API key (Hardcoded temporalmente para asegurar funcionamiento)
    const apiKey = 'sk_13286.LuIyPsunop5MnmBCLhcxoRCCA7StWWZQ';

    console.log(`Buscando DNI: ${dni}`);

    // Llamar a la API de DeColecta
    const url = `https://api.decolecta.com/v1/reniec/dni?numero=${dni}`;
    console.log('URL:', url);

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      }
    });

    console.log('Response status:', response.status);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('Error DeColecta:', errorData);

      if (response.status === 404) {
        throw new functions.https.HttpsError(
          'not-found',
          'DNI no encontrado en RENIEC'
        );
      }

      if (response.status === 401 || response.status === 403) {
        throw new functions.https.HttpsError(
          'unauthenticated',
          'Error de autenticación con DeColecta'
        );
      }

      throw new functions.https.HttpsError(
        'internal',
        errorData.message || 'Error al consultar RENIEC'
      );
    }

    const data_response = await response.json();
    console.log('Datos recibidos:', data_response);

    // Validar campos
    if (!data_response.first_name || !data_response.first_last_name) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'Datos incompletos en RENIEC'
      );
    }

    const nombreCompleto = `${data_response.first_name} ${data_response.first_last_name} ${data_response.second_last_name || ''}`.trim();
    console.log('Nombre completo:', nombreCompleto);

    return {
      success: true,
      data: {
        nombre: nombreCompleto,
        nombres: data_response.first_name,
        primer_apellido: data_response.first_last_name,
        segundo_apellido: data_response.second_last_name || '',
        fecha_nacimiento: data_response.date_of_birth || null,
        sexo: data_response.gender || null,
        estado_civil: data_response.marital_status || null,
        nacionalidad: data_response.nationality || null
      }
    };

  } catch (error) {
    console.error('ERROR DETALLADO en buscarDNI:', {
      message: error.message,
      stack: error.stack,
      code: error.code
    });

    if (error instanceof functions.https.HttpsError) {
      throw error;
    }

    throw new functions.https.HttpsError(
      'internal',
      `Error en Cloud Function: ${error.message}`
    );
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

/**
 * Cloud Function Callable para Crear/Actualizar/Eliminar usuarios en Firebase Auth
 */
exports.gestionarUsuarioAuth = functions.https.onCall(async (data, context) => {
  try {
    const { action, dni, password } = data;

    if (!dni || !action) {
      throw new functions.https.HttpsError('invalid-argument', 'Faltan parámetros requeridos: action y dni');
    }

    const email = `${dni}@liderman.com.pe`;

    if (action === 'create' || action === 'update') {
      if (!password) {
        throw new functions.https.HttpsError('invalid-argument', 'La contraseña es obligatoria para crear o actualizar');
      }

      try {
        // Intentar actualizar si existe
        await admin.auth().updateUser(dni, {
          email: email,
          password: password,
        });
        console.log(`Usuario ${dni} actualizado exitosamente en Auth`);
      } catch (err) {
        if (err.code === 'auth/user-not-found') {
          // Si no existe, crearlo
          await admin.auth().createUser({
            uid: dni,
            email: email,
            password: password,
          });
          console.log(`Usuario ${dni} creado exitosamente en Auth`);
        } else {
          throw err;
        }
      }
    } else if (action === 'delete') {
      try {
        await admin.auth().deleteUser(dni);
        console.log(`Usuario ${dni} eliminado exitosamente de Auth`);
      } catch (err) {
        if (err.code !== 'auth/user-not-found') {
          throw err;
        }
        console.log(`Usuario ${dni} no encontrado en Auth, no se requiere eliminación`);
      }
    } else {
      throw new functions.https.HttpsError('invalid-argument', 'Acción no válida');
    }

    return { success: true };
  } catch (error) {
    console.error('Error en gestionarUsuarioAuth:', error);
    throw new functions.https.HttpsError('internal', `Error gestionando Auth: ${error.message}`);
  }
});
