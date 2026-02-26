import './style.css';
import { auth, db } from './firebase.js';
import { signOut } from 'firebase/auth';
import { collection, addDoc, query, orderBy, limit, onSnapshot, serverTimestamp, where, getDocs, updateDoc, doc, Timestamp, getDoc } from 'firebase/firestore';
import { renderizarGraficos, actualizarTablaDashboard } from './charts.js';
import * as XLSX from 'xlsx';

// Variables de sesión
const userClient = localStorage.getItem('userClient');
const userUnit = localStorage.getItem('userUnit');
const userFullName = `${localStorage.getItem('userName') || ''} ${localStorage.getItem('userLastName') || ''}`.trim();

// Verificar autenticación
// Verificar autenticación
auth.onAuthStateChanged(async (user) => {
  if (!user) {
    window.location.href = '/index.html';
  } else {
    // AUTORECUPERACIÓN: Si hay usuario Auth pero faltan datos en LocalStorage (ej: sesión persistente anterior)
    if (!localStorage.getItem('userClient') || !localStorage.getItem('userUnit')) {
      console.log('Sesión incompleta detectada. Recuperando perfil de Firestore...');
      try {
        const userId = user.email.split('@')[0];
        const userDocRef = doc(db, 'usuarios', userId);
        const userSnapshot = await getDoc(userDocRef);

        if (userSnapshot.exists()) {
          const data = userSnapshot.data();
          localStorage.setItem('userEmail', user.email);
          localStorage.setItem('userId', userId);
          localStorage.setItem('userName', data.nombres || '');
          localStorage.setItem('userLastName', data.apellidos || '');
          localStorage.setItem('userClient', data.cliente || '');
          localStorage.setItem('userUnit', data.unidad || '');
          localStorage.setItem('userType', data.tipo || '');

          // VALIDACIÓN DE ROL EN AUTO-RECUPERACIÓN
          if (data.tipo !== 'cliente' && data.tipo !== 'admin') {
            console.error('Acceso denegado: Rol no autorizado.');
            await signOut(auth);
            localStorage.clear();
            window.location.href = '/index.html';
            return;
          }

          console.log('Perfil recuperado. Recargando...');
          window.location.reload(); // Recargar para aplicar variables globales
          return;
        } else {
          console.error('Usuario autenticado no tiene perfil en BD.');
          alert('Error: Tu usuario no tiene perfil de unidad asignado.');
        }
      } catch (err) {
        console.error('Error recuperando perfil:', err);
      }
    }

    // Si todo está bien, mostrar datos
    const fullName = `${localStorage.getItem('userName') || ''} ${localStorage.getItem('userLastName') || ''}`.trim();
    const client = localStorage.getItem('userClient') || '---';
    const unit = localStorage.getItem('userUnit') || '---';
    const userRole = localStorage.getItem('userType');

    // VERIFICACIÓN DE SEGURIDAD: SI NO ES CLIENTE NI ADMIN, EXPULSAR
    if (userRole && userRole !== 'cliente' && userRole !== 'admin') {
      console.warn('Rol no autorizado detectado:', userRole);
      await signOut(auth);
      localStorage.clear();
      window.location.href = '/index.html';
      return;
    }

    const userDisplay = document.getElementById('userName');
    if (userDisplay) {
      userDisplay.textContent = `Bienvenido: ${fullName} - ${client} ${unit}`;
    }

    // MOSTRAR NAV ITEMS ADMINISTRATIVOS SOLO SI ES ADMIN
    if (userRole === 'admin') {
      const navUsers = document.getElementById('nav-users');
      const navClients = document.getElementById('nav-clients');
      if (navUsers) navUsers.style.display = 'flex';
      if (navClients) navClients.style.display = 'flex';
    }
  }
});

// Elementos del DOM
const btnLogout = document.getElementById('btnLogout');
const btnBuscarDNI = document.getElementById('btnBuscarDNI');
const btnRegistrar = document.getElementById('btnRegistrar');
const btnLimpiar = document.getElementById('btnLimpiar');
const dniInput = document.getElementById('dni');
const nombreCompletoInput = document.getElementById('nombreCompleto');
const carnetExtranjeriaCheckbox = document.getElementById('carnetExtranjeria');
const tableBody = document.getElementById('tableBody');
const totalIngresosEl = document.getElementById('totalIngresos');
const totalSalidasEl = document.getElementById('totalSalidas');

// Modal Duplicidad
const modalDuplicidad = document.getElementById('modalDuplicidad');
const btnCerrarDuplicidad = document.getElementById('btnCerrarDuplicidad');
const mensajeDuplicidadText = document.getElementById('mensajeDuplicidad');

if (btnCerrarDuplicidad) {
  btnCerrarDuplicidad.addEventListener('click', () => {
    modalDuplicidad.classList.remove('active');
    setTimeout(() => {
      modalDuplicidad.style.display = 'none';

      // También limpiar loading por si acaso
      const loading = document.getElementById('loadingOverlay');
      if (loading) loading.classList.remove('active');
    }, 300);
  });
}

// Estado de la aplicación
let registros = [];
let totalIngresos = 0;
let totalSalidas = 0;
let registroSalidaId = null; // ID del registro que se está cerrando

// Función para mostrar notificaciones
function showNotification(message, type = 'info') {
  // Crear contenedor si no existe
  let notificationContainer = document.getElementById('notificationContainer');
  if (!notificationContainer) {
    notificationContainer = document.createElement('div');
    notificationContainer.id = 'notificationContainer';
    notificationContainer.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 10000;
      max-width: 400px;
    `;
    document.body.appendChild(notificationContainer);
  }

  // Crear notificación
  const notification = document.createElement('div');
  notification.className = `notification notification-${type}`;
  notification.style.cssText = `
    padding: 1rem 1.5rem;
    margin-bottom: 10px;
    border-radius: 0.5rem;
    backdrop-filter: blur(20px);
    border: 1px solid;
    animation: slideIn 0.3s ease-out;
    display: flex;
    align-items: center;
    gap: 10px;
    font-family: 'Rajdhani', sans-serif;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
  `;

  // Colores según tipo
  const colors = {
    success: { bg: 'rgba(0, 217, 100, 0.1)', border: '#00d964', text: '#00ff88' },
    error: { bg: 'rgba(255, 51, 102, 0.1)', border: '#ff3366', text: '#ff6699' },
    warning: { bg: 'rgba(255, 193, 7, 0.1)', border: '#ffc107', text: '#ffeb3b' },
    info: { bg: 'rgba(0, 217, 255, 0.1)', border: '#00d9ff', text: '#00d9ff' }
  };

  const color = colors[type] || colors.info;
  notification.style.background = color.bg;
  notification.style.borderColor = color.border;
  notification.style.color = color.text;

  // Icono
  const icons = {
    success: '✓',
    error: '✕',
    warning: '⚠',
    info: 'ℹ'
  };

  notification.innerHTML = `
    <span style="font-size: 1.2rem; min-width: 20px;">${icons[type]}</span>
    <span>${message}</span>
  `;

  notificationContainer.appendChild(notification);

  // Auto-eliminar después de 4 segundos
  setTimeout(() => {
    notification.style.animation = 'slideOut 0.3s ease-out';
    setTimeout(() => notification.remove(), 300);
  }, 4000);
}

// Cerrar sesión
btnLogout.addEventListener('click', async () => {
  try {
    await signOut(auth);
    localStorage.clear(); // Limpieza total de sesión
    window.location.href = './index.html';
  } catch (error) {
    console.error('Error al cerrar sesión:', error);
    showNotification('Error al cerrar sesión', 'error');
  }
});

// Listener para cambio de Tipo de Acceso
const radiosTipoAcceso = document.querySelectorAll('input[name="tipoAcceso"]');
radiosTipoAcceso.forEach(radio => {
  radio.addEventListener('change', (e) => {
    limpiarFormulario(); // Limpiar todo al cambiar modo

    if (e.target.value === 'salida') {
      toggleModoSalida(true);
    } else {
      toggleModoSalida(false);
    }
  });
});

// Función para cambiar la UI según modo Salida
function toggleModoSalida(esSalida) {
  // Campos a bloquear/desbloquear
  const campos = [
    'nombreCompleto',
    'motivoIngreso',
    'empresa',
    'personaContacto',
    'observaciones'
  ];

  // Radios de Tipo de Persona
  const radiosTipoPersona = document.querySelectorAll('input[name="tipoPersona"]');

  if (esSalida) {
    // Modo SALIDA
    btnRegistrar.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
        <polyline points="16 17 21 12 16 7"></polyline>
        <line x1="21" y1="12" x2="9" y2="12"></line>
      </svg>
      REGISTRAR SALIDA
    `;

    // Bloquear campos
    campos.forEach(id => {
      document.getElementById(id).readOnly = true;
    });

    // Deshabilitar radios de tipo persona (se llenarán auto)
    radiosTipoPersona.forEach(r => r.disabled = true);

    // Checkbox extranjería
    carnetExtranjeriaCheckbox.disabled = true;

    showNotification('Modo SALIDA: Busque por DNI para cargar datos', 'info');

  } else {
    // Modo INGRESO (Restaurar)
    btnRegistrar.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
        <polyline points="17 21 17 13 7 13 7 21"></polyline>
        <polyline points="7 3 7 8 15 8"></polyline>
      </svg>
      Registrar
    `;

    // Desbloquear campos
    campos.forEach(id => {
      // nombreCompleto sigue readonly siempre (se llena por RENIEC)
      if (id !== 'nombreCompleto') document.getElementById(id).readOnly = false;
    });

    // Habilitar radios
    radiosTipoPersona.forEach(r => r.disabled = false);
    carnetExtranjeriaCheckbox.disabled = false;
  }
}

// === LÓGICA CARNET EXTRANJERÍA ===
if (carnetExtranjeriaCheckbox) {
  carnetExtranjeriaCheckbox.addEventListener('change', () => {
    const isChecked = carnetExtranjeriaCheckbox.checked;

    if (isChecked) {
      // MODO CARNET: Alfanumérico, Manual, Sin Búsqueda
      dniInput.placeholder = "Ingrese Documento (Alfanumérico)";
      dniInput.removeAttribute('maxlength');
      dniInput.removeAttribute('pattern');

      btnBuscarDNI.disabled = true;
      btnBuscarDNI.style.opacity = "0.5";
      btnBuscarDNI.style.cursor = "not-allowed";

      nombreCompletoInput.readOnly = false;
      nombreCompletoInput.placeholder = "Escriba Nombres y Apellidos";
      nombreCompletoInput.focus();

      showNotification('Modo Carnet Extranjería: Ingreso manual habilitado', 'info');
    } else {
      // MODO DNI: Numérico, 8 dígitos, Búsqueda obligatoria
      dniInput.placeholder = "Ingrese DNI";
      dniInput.setAttribute('maxlength', '8');
      dniInput.setAttribute('pattern', '[0-9]{8}');
      dniInput.value = dniInput.value.replace(/\D/g, '').substring(0, 8); // Limpiar si había texto

      btnBuscarDNI.disabled = false;
      btnBuscarDNI.style.opacity = "1";
      btnBuscarDNI.style.cursor = "pointer";

      nombreCompletoInput.readOnly = true;
      nombreCompletoInput.placeholder = "Nombres y Apellidos";
      nombreCompletoInput.value = "";
    }
  });

  // Forzar Mayúsculas en tiempo real para DNI y Nombre Completo
  [dniInput, nombreCompletoInput].forEach(input => {
    input.addEventListener('input', () => {
      if (carnetExtranjeriaCheckbox.checked) {
        input.value = input.value.toUpperCase();
      }
    });
  });
}

// Funciones de Overlay de Carga
const loadingOverlay = document.getElementById('loadingOverlay');

function showLoading() {
  if (loadingOverlay) {
    loadingOverlay.style.display = 'flex';
    // Forzar reflow para animación
    loadingOverlay.offsetHeight;
    loadingOverlay.classList.add('active');
  }
}

function hideLoading() {
  if (loadingOverlay) {
    loadingOverlay.classList.remove('active');
    setTimeout(() => {
      loadingOverlay.style.display = 'none';
    }, 300); // Coincide con transición CSS
  }
}

// Buscar DNI (Estrategia Híbrida: Firestore Cache -> RENIEC)
btnBuscarDNI.addEventListener('click', async () => {
  const dni = dniInput.value.trim();

  if (!dni) {
    showNotification('Por favor, ingrese un número de DNI', 'warning');
    dniInput.focus();
    return;
  }

  // Si es Carnet de Extranjería, no debería llegar aquí porque el botón está disabled,
  // pero agregamos el chequeo por seguridad.
  if (carnetExtranjeriaCheckbox.checked) return;

  if (dni.length !== 8 || !/^\d+$/.test(dni)) {
    showNotification('El DNI debe tener 8 dígitos numéricos', 'warning');
    dniInput.focus();
    return;
  }

  // UI Loading
  btnBuscarDNI.disabled = true;
  showLoading(); // Mostrar Overlay Espiral

  try {
    const tipoAcceso = document.querySelector('input[name="tipoAcceso"]:checked').value;

    if (tipoAcceso === 'ingreso') {
      // === MODO INGRESO: Buscamos primero en historial local (Ahorro de API) ===
      console.log('Modo INGRESO: Buscando en historial local...');

      const qHistorial = query(
        collection(db, 'accesos'),
        where('numeroDocumento', '==', dni),
        orderBy('timestamp', 'desc'),
        limit(1)
      );

      const snapshotHistorial = await getDocs(qHistorial);

      if (!snapshotHistorial.empty) {
        // ENCONTRADO EN CACHÉ LOCAL
        const data = snapshotHistorial.docs[0].data();
        console.log('Encontrado en historial:', data.nombreCompleto);

        nombreCompletoInput.value = data.nombreCompleto;

        // Opcional: Sugerir datos anteriores (autofill inteligente)
        if (data.empresa) document.getElementById('empresa').value = data.empresa;
        if (data.tipoPersona) {
          const radio = document.querySelector(`input[name="tipoPersona"][value="${data.tipoPersona}"]`);
          if (radio) radio.checked = true;
        }

        showNotification('Datos recuperados del historial ✔', 'success');
        updateTrafficLight('green');

      } else {
        // NO ENCONTRADO -> LLAMAR A RENIEC (VIA CLOUD FUNCTION)
        console.log('No encontrado en historial. Consultando RENIEC vía Cloud Functions...');

        const { functions, httpsCallable } = await import('./firebase.js');
        const buscarDNICallable = httpsCallable(functions, 'buscarDNI');

        const result = await buscarDNICallable({ dni });

        if (result.data && result.data.success) {
          nombreCompletoInput.value = result.data.data.nombre;
          showNotification('DNI válido. Datos obtenidos de RENIEC.', 'success');
          updateTrafficLight('green');
        } else {
          throw new Error('DNI no encontrado o error en RENIEC.');
        }
      }

    } else {
      // === MODO SALIDA: Buscar ingreso activo (FILTRADO POR UNIDAD) ===
      console.log('Modo SALIDA: Buscando ingreso activo para DNI:', dni);

      const q = query(
        collection(db, 'accesos'),
        where('numeroDocumento', '==', dni),
        where('estado', '==', 'Activo'),
        where('cliente', '==', userClient), // Seguridad: Solo mi cliente
        where('unidad', '==', userUnit),     // Seguridad: Solo mi unidad
        orderBy('timestamp', 'desc'),
        limit(1)
      );

      const querySnapshot = await getDocs(q);

      if (querySnapshot.empty) {
        throw new Error('No se encontró un ingreso ACTIVO para este DNI.');
      }

      const doc = querySnapshot.docs[0];
      const data = doc.data();
      registroSalidaId = doc.id;

      // Rellenar campos
      nombreCompletoInput.value = data.nombreCompleto;
      document.getElementById('motivoIngreso').value = data.motivoIngreso || '';
      document.getElementById('empresa').value = data.empresa || '';
      document.getElementById('personaContacto').value = data.personaContacto || '';
      document.getElementById('observaciones').value = data.observaciones || '';
      document.getElementById('nroPase').value = data.nroPase || '';

      if (data.tipoPersona) {
        const radio = document.querySelector(`input[name="tipoPersona"][value="${data.tipoPersona}"]`);
        if (radio) radio.checked = true;
      }

      showNotification('Ingreso activo encontrado. Registre salida.', 'info');
      updateTrafficLight('green');
    }

  } catch (error) {
    console.error('Error al buscar:', error);
    let mensaje = 'Error al realizar la búsqueda.';
    if (error.message) mensaje = error.message;

    showNotification(mensaje, 'error');
    updateTrafficLight('red');
    registroSalidaId = null;

    // Limpiar campos si falló
    if (tipoAcceso === 'ingreso') nombreCompletoInput.value = '';

  } finally {
    // Rehabilitar botón y ocultar overlay
    btnBuscarDNI.disabled = false;
    hideLoading();
  }
});

// Actualizar semáforo
function updateTrafficLight(color) {
  const lights = document.querySelectorAll('.light');
  lights.forEach(light => light.classList.remove('active'));

  const activeLight = document.querySelector(`.light.${color}`);
  if (activeLight) {
    activeLight.classList.add('active');
  }
}

// ==========================================
// LÓGICA DE MODAL SALIDA
// ==========================================
const modalSalida = document.getElementById('modalSalida');
const modalStep1 = document.getElementById('modalStep1');
const modalStep2 = document.getElementById('modalStep2');
const inputObservacionSalida = document.getElementById('inputObservacionSalida');

// Listeners Modal
if (document.getElementById('btnSalidaNo')) {
  document.getElementById('btnSalidaNo').addEventListener('click', () => {
    cerrarModalSalida();
    registrarSalidaFinal('Sin comentarios');
  });
}

if (document.getElementById('btnSalidaSi')) {
  document.getElementById('btnSalidaSi').addEventListener('click', () => {
    modalStep1.style.display = 'none';
    modalStep2.style.display = 'block';
    setTimeout(() => inputObservacionSalida.focus(), 100);
  });
}

if (document.getElementById('btnConfirmarSalida')) {
  document.getElementById('btnConfirmarSalida').addEventListener('click', () => {
    const obs = inputObservacionSalida.value.trim();
    const comentarioFinal = obs ? obs : 'Sin comentarios';
    cerrarModalSalida();
    registrarSalidaFinal(comentarioFinal);
  });
}

if (document.getElementById('btnCancelarSalida')) {
  document.getElementById('btnCancelarSalida').addEventListener('click', cerrarModalSalida);
}

function cerrarModalSalida() {
  if (!modalSalida) return;
  modalSalida.classList.remove('active');
  setTimeout(() => {
    modalSalida.style.display = 'none';
    // Resetear pasos para la próxima
    if (modalStep1) modalStep1.style.display = 'block';
    if (modalStep2) modalStep2.style.display = 'none';
    if (inputObservacionSalida) inputObservacionSalida.value = '';
  }, 300);
}

function abrirModalSalida() {
  if (modalSalida) {
    modalSalida.style.display = 'flex';
    modalSalida.offsetHeight; // Force reflow
    modalSalida.classList.add('active');
  }
}

// Función real para guardar salida en BD
async function registrarSalidaFinal(observacionSalida) {
  showLoading(); // Mostrar spinner
  try {
    const registroRef = doc(db, 'accesos', registroSalidaId);

    await updateDoc(registroRef, {
      estado: 'Cerrado',
      fechaSalida: serverTimestamp(),
      observacionesSalida: observacionSalida,
      usuarioSalidaNombre: userFullName // Auditoría
    });

    showNotification('Salida registrada correctamente.', 'success');
    limpiarFormulario();

  } catch (error) {
    console.error('Error al registrar salida:', error);
    showNotification('Error al guardar salida.', 'error');
  } finally {
    hideLoading();
  }
}


// Registrar acceso (Botón Principal)
btnRegistrar.addEventListener('click', async () => {
  const tipoAcceso = document.querySelector('input[name="tipoAcceso"]:checked').value;
  const tipoPersona = document.querySelector('input[name="tipoPersona"]:checked').value;
  const dni = dniInput.value.trim();
  const nombreCompleto = nombreCompletoInput.value.trim();
  const motivoIngreso = document.getElementById('motivoIngreso').value.trim();
  const empresa = document.getElementById('empresa').value.trim();
  const personaContacto = document.getElementById('personaContacto').value.trim();
  const observaciones = document.getElementById('observaciones').value.trim();
  const nroPase = document.getElementById('nroPase').value.trim();
  const carnetExtranjeria = carnetExtranjeriaCheckbox.checked;

  // Validaciones Generales
  if (!dni) {
    showNotification('Por favor, ingrese el número de documento', 'warning');
    dniInput.focus();
    return;
  }

  // Validación de DNI normal (8 dígitos) solo si NO es carnet de extranjería
  if (!carnetExtranjeria && !/^\d{8}$/.test(dni) && tipoAcceso === 'ingreso') {
    showNotification('El DNI debe tener 8 dígitos numéricos', 'warning');
    dniInput.focus();
    return;
  }

  if (!nombreCompleto) {
    const msg = carnetExtranjeria ? 'Por favor, ingrese el nombre completo' : 'Por favor, busque el DNI primero';
    showNotification(msg, 'warning');
    if (carnetExtranjeria) nombreCompletoInput.focus();
    else btnBuscarDNI.focus();
    return;
  }

  // --- MODO SALIDA: Mostrar Modal ---
  if (tipoAcceso === 'salida') {
    if (!registroSalidaId) {
      showNotification('Primero debe BUSCAR el DNI para encontrar el registro activo.', 'warning');
      return;
    }
    // Abrir modal y esperar la acción del usuario
    abrirModalSalida();
    return;
  }

  // --- MODO INGRESO: Guardar directo ---
  // Deshabilitar botón durante el registro
  btnRegistrar.disabled = true;
  showLoading();

  try {
    // Validar Duplicidad de Ingreso
    console.log(`[DEBUG] Check Duplicado -> DNI: ${dni} | Cliente: ${userClient} | Unidad: ${userUnit}`);

    const qDuplicado = query(
      collection(db, 'accesos'),
      where('numeroDocumento', '==', dni),
      where('estado', '==', 'Activo'),
      where('cliente', '==', userClient),
      where('unidad', '==', userUnit),
      limit(1)
    );

    try {
      const snapDuplicado = await getDocs(qDuplicado);
      console.log(`[DEBUG] Resultados duplicados encontrados: ${snapDuplicado.size}`);

      if (!snapDuplicado.empty) {
        console.log("[DEBUG] Duplicado confirmado. Abriendo modal...");
        const docData = snapDuplicado.docs[0].data();
        const fechaIngreso = docData.timestamp ? docData.timestamp.toDate().toLocaleString() : '---';

        if (mensajeDuplicidadText && modalDuplicidad) {
          mensajeDuplicidadText.innerHTML = `
                        El usuario <strong style="color:white">${docData.nombreCompleto || dni}</strong><br>
                        Ya tiene un ingreso ACTIVO registrado el:<br>
                        <h4 style="color:var(--primary-cyan); margin:10px 0">${fechaIngreso}</h4>
                        Debe registrar su salida antes de permitir un nuevo ingreso.
                    `;

          hideLoading();
          modalDuplicidad.style.display = 'flex';
          // Forzar animación
          void modalDuplicidad.offsetWidth;
          modalDuplicidad.classList.add('active');

          btnRegistrar.disabled = false;
          return; // Detener flujo
        } else {
          console.error("[ERROR] Elementos del modal no encontrados (null)");
          alert(`ADVERTENCIA: Ya existe un ingreso activo para ${dni}`);
          hideLoading();
          btnRegistrar.disabled = false;
          return;
        }
      }
    } catch (err) {
      console.error("[ERROR QUERY] Fallo al consultar duplicados:", err);
      alert("Error de sistema (Índice faltante). Ver consola.");
      hideLoading();
      btnRegistrar.disabled = false;
      return;
    }

    const registro = {
      tipoAcceso,
      tipoPersona,
      numeroDocumento: dni.toUpperCase(),
      nombreCompleto: nombreCompleto.toUpperCase(),
      motivoIngreso: motivoIngreso.toUpperCase(),
      empresa: empresa.toUpperCase(),
      personaContacto: personaContacto.toUpperCase(),
      observaciones: observaciones.toUpperCase(),
      nroPase: nroPase.toUpperCase(),
      carnetExtranjeria,
      timestamp: serverTimestamp(),
      usuario: auth.currentUser ? auth.currentUser.email : 'anon',
      usuarioNombre: userFullName,
      cliente: userClient,
      unidad: userUnit,
      estado: 'Activo'
    };

    await addDoc(collection(db, 'accesos'), registro);
    showNotification('Ingreso registrado exitosamente', 'success');

    limpiarFormulario();

  } catch (error) {
    console.error('Error al guardar registro:', error);
    showNotification('Error al guardar el ingreso.', 'error');
  } finally {
    btnRegistrar.disabled = false;
    hideLoading();
  }
});

// Limpiar formulario
function limpiarFormulario() {
  dniInput.value = '';
  nombreCompletoInput.value = '';
  document.getElementById('motivoIngreso').value = '';
  document.getElementById('empresa').value = '';
  document.getElementById('personaContacto').value = '';
  document.getElementById('observaciones').value = '';
  document.getElementById('nroPase').value = '';

  // Resetear modo Carnet si estaba activo
  if (carnetExtranjeriaCheckbox.checked) {
    carnetExtranjeriaCheckbox.checked = false;
    // Disparar el evento change manualmente para restaurar los campos
    carnetExtranjeriaCheckbox.dispatchEvent(new Event('change'));
  }

  registroSalidaId = null; // Reiniciar ID de salida

  // Limpiar readonly si estamos volviendo a empezar (depende del modo actual)
  const modoActual = document.querySelector('input[name="tipoAcceso"]:checked').value;
  toggleModoSalida(modoActual === 'salida');

  updateTrafficLight('green');
  // Asegurar foco en DNI con un pequeño delay para evitar conflictos de UI
  setTimeout(() => dniInput.focus(), 100);
}

// Escuchar cambios en la colección de accesos
function inicializarListeners() {
  // Foco inicial
  dniInput.focus();

  // Listener botón Limpiar
  if (btnLimpiar) btnLimpiar.addEventListener('click', limpiarFormulario);

  // Listener cambio Tipo Persona (para devolver foco al DNI)
  const radiosTipoPersona = document.querySelectorAll('input[name="tipoPersona"]');
  radiosTipoPersona.forEach(r => {
    r.addEventListener('change', () => {
      dniInput.focus();
    });
  });

  const q = query(
    collection(db, 'accesos'),
    where('cliente', '==', userClient), // Filtrar globalmente
    where('unidad', '==', userUnit),    // Filtrar globalmente
    orderBy('timestamp', 'desc'),
    limit(50)
  );

  onSnapshot(q, (snapshot) => {
    registros = [];
    totalIngresos = 0;
    totalSalidas = 0;

    snapshot.forEach((doc) => {
      const data = doc.data();
      registros.push({ id: doc.id, ...data });

      // Contar como ingreso si el registro original fue un ingreso
      if (data.tipoAcceso === 'ingreso') {
        totalIngresos++;
      }

      // Contar como salida si el estado es Cerrado (ya salió)
      if (data.estado === 'Cerrado') {
        totalSalidas++;
      }
    });

    actualizarTabla();
    actualizarEstadisticas();
  });
}

// Actualizar tabla
function actualizarTabla() {
  tableBody.innerHTML = '';

  if (registros.length === 0) {
    tableBody.innerHTML = `
      <tr>
        <td colspan="9" style="text-align: center; padding: 2rem; color: var(--text-muted);">
          No hay registros disponibles
        </td>
      </tr>
    `;
    return;
  }

  registros.forEach((registro) => {
    const tr = document.createElement('tr');

    // Formatear fecha
    let fechaFormateada = 'N/A';
    if (registro.timestamp) {
      const fecha = registro.timestamp.toDate();
      fechaFormateada = fecha.toLocaleString('es-PE', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    }

    tr.innerHTML = `
      <td data-label="Fecha Ingreso">${fechaFormateada}</td>
      <td data-label="Tipo">${registro.tipoAcceso === 'ingreso' ? 'Ingreso' : 'Salida'}</td>
      <td data-label="Nro Documento">${registro.numeroDocumento}</td>
      <td data-label="Nombre">${registro.nombreCompleto}</td>
      <td data-label="Empresa">${registro.empresa || '-'}</td>
      <td data-label="Área">${registro.tipoPersona || '-'}</td>
      <td data-label="Motivo">${registro.motivoIngreso || '-'}</td>
      <td data-label="Contacto">${registro.personaContacto || '-'}</td>
      <td data-label="Estado">
        <span class="status-badge ${registro.estado === 'Activo' ? 'active' : 'closed'}">
          ${registro.estado}
        </span>
      </td>
    `;

    tableBody.appendChild(tr);
  });
}

// Actualizar estadísticas
function actualizarEstadisticas() {
  totalIngresosEl.textContent = totalIngresos;
  totalSalidasEl.textContent = totalSalidas;
}

// Animación de partículas en el fondo
function createFloatingParticles() {
  const container = document.querySelector('.floating-particles');
  const particleCount = 30;

  for (let i = 0; i < particleCount; i++) {
    const particle = document.createElement('div');
    particle.className = 'particle';
    particle.style.cssText = `
      position: absolute;
      width: ${Math.random() * 3 + 1}px;
      height: ${Math.random() * 3 + 1}px;
      background: ${Math.random() > 0.7 ? '#ff3366' : '#00d9ff'};
      border-radius: 50%;
      left: ${Math.random() * 100}%;
      top: ${Math.random() * 100}%;
      opacity: ${Math.random() * 0.4 + 0.1};
      animation: particleFloat ${Math.random() * 15 + 15}s linear infinite;
      animation-delay: ${Math.random() * 5}s;
      box-shadow: 0 0 8px currentColor;
    `;
    container.appendChild(particle);
  }
}

// Añadir estilos de animación para partículas
const style = document.createElement('style');
style.textContent = `
  @keyframes particleFloat {
    0% {
      transform: translate(0, 0) rotate(0deg);
      opacity: 0;
    }
    10% {
      opacity: 0.4;
    }
    90% {
      opacity: 0.4;
    }
    100% {
      transform: translate(${Math.random() * 300 - 150}px, ${Math.random() * 300 - 150}px) rotate(360deg);
      opacity: 0;
    }
  }
`;
document.head.appendChild(style);

// Inicializar aplicación
createFloatingParticles();
inicializarListeners();
inicializarNavegacion();
inicializarConectividad();

// --- LÓGICA DE CONECTIVIDAD ---
function inicializarConectividad() {
  const statusEl = document.getElementById('connectionStatus');
  if (!statusEl) return;

  function updateStatus() {
    if (navigator.onLine) {
      statusEl.innerHTML = '<span class="status-dot online"></span> En Línea';
    } else {
      statusEl.innerHTML = '<span class="status-dot offline"></span> Desconectado';
    }
  }

  window.addEventListener('online', updateStatus);
  window.addEventListener('offline', updateStatus);
  updateStatus();
}

// Permitir solo números en el campo DNI y BÚSQUEDA AUTOMÁTICA (Scanner)
dniInput.addEventListener('input', (e) => {
  // Limpiar caracteres no numéricos
  const valor = e.target.value.replace(/\D/g, '').slice(0, 8);
  e.target.value = valor;

  // Si llega a 8 dígitos y el botón no está deshabilitado (no está buscando ya)
  if (valor.length === 8 && !btnBuscarDNI.disabled) {
    console.log('DNI completo detectado (Escáner/Manual), buscando...');
    btnBuscarDNI.click();
  }
});

// También escuchar tecla ENTER (común en escáneres)
dniInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    if (dniInput.value.length === 8 && !btnBuscarDNI.disabled) {
      btnBuscarDNI.click();
    }
  }
});

// ==========================================
// LÓGICA DE NAVEGACIÓN Y DASHBOARD
// ==========================================

function inicializarNavegacion() {
  const menuToggle = document.getElementById('menuToggle');
  const sidebarMenu = document.getElementById('sidebarMenu');
  const navItems = document.querySelectorAll('.nav-item');
  const views = document.querySelectorAll('.view-section');

  if (menuToggle) {
    // Toggle Sidebar con Overlay
    menuToggle.addEventListener('click', () => {
      sidebarMenu.classList.toggle('active');
      const sidebarOverlay = document.getElementById('sidebarOverlay');
      if (sidebarOverlay) sidebarOverlay.classList.toggle('active');
    });

    // Cerrar sidebar al hacer click fuera (Overlay)
    const sidebarOverlay = document.getElementById('sidebarOverlay');
    if (sidebarOverlay) {
      sidebarOverlay.addEventListener('click', () => {
        sidebarMenu.classList.remove('active');
        sidebarOverlay.classList.remove('active');
      });
    }
  }

  // Navegación entre vistas
  navItems.forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      // 1. Activar item del menú
      navItems.forEach(n => n.classList.remove('active'));
      item.classList.add('active');

      // 2. Mostrar vista correspondiente
      const targetId = item.getAttribute('data-target') || item.getAttribute('data-view');
      views.forEach(view => {
        if (view.id === targetId) {
          view.style.display = 'block';
          view.classList.add('active');
        } else {
          view.style.display = 'none';
          view.classList.remove('active');
        }
      });

      // 3. SIEMPRE cerrar el menú sidebar al seleccionar una opción
      if (sidebarMenu) {
        sidebarMenu.classList.remove('active');
        const sidebarOverlay = document.getElementById('sidebarOverlay');
        if (sidebarOverlay) sidebarOverlay.classList.remove('active');
      }

      // 4. Carga de datos según la sección
      if (targetId === 'view-dashboard') {
        const dateInput = document.getElementById('filterDate');
        if (dateInput && !dateInput.value) {
          dateInput.valueAsDate = new Date();
        }
        cargarDashboard();
      } else if (targetId === 'view-management') {
        cargarUsuariosTable();
      } else if (targetId === 'view-clients') {
        cargarClientesTable();
      }
    });
  });

  // Listeners del Dashboard
  const btnFilter = document.getElementById('btnFilterDashboard');
  if (btnFilter) btnFilter.addEventListener('click', cargarDashboard);

  const btnExport = document.getElementById('btnExportExcel');
  if (btnExport) btnExport.addEventListener('click', exportarExcel);
}

// Variables globales para dashboard
let dashboardData = []; // Datos crudos para exportar

async function cargarDashboard() {
  const dateInput = document.getElementById('filterDate').value;
  if (!dateInput) return;

  // Como es input date, viene en formato YYYY-MM-DD.
  // Vamos a tomar ese MES para los gráficos.
  // "Indicadores de barra... ingresos y salidas diarias" sugiere ver el mes completo.

  const selectedDate = new Date(dateInput + 'T00:00:00'); // Asegurar hora local

  // Definir rango: Todo el mes seleccionado
  const startOfMonth = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1);
  const endOfMonth = new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 0, 23, 59, 59);

  showNotification('Cargando datos del mes...', 'info');

  try {
    const q = query(
      collection(db, 'accesos'),
      where('cliente', '==', userClient), // Filtrar dashboard
      where('unidad', '==', userUnit),    // Filtrar dashboard
      where('timestamp', '>=', Timestamp.fromDate(startOfMonth)),
      where('timestamp', '<=', Timestamp.fromDate(endOfMonth)),
      orderBy('timestamp', 'desc')
    );

    const snapshot = await getDocs(q);
    dashboardData = [];

    snapshot.forEach(doc => {
      dashboardData.push({ id: doc.id, ...doc.data() });
    });

    actualizarTablaDashboard(dashboardData);
    renderizarGraficos(dashboardData);
    showNotification('Dashboard actualizado', 'success');

  } catch (error) {
    console.error('Error cargando dashboard:', error);
    showNotification('Error al cargar datos. Verifique conexión.', 'error');
  }
}

// La lógica de renderizado se ha movido a src/charts.js

function exportarExcel() {
  if (dashboardData.length === 0) {
    showNotification('No hay datos para exportar', 'warning');
    return;
  }

  // Preparar datos limpios para Excel
  // Preparar datos limpios para Excel
  const datosExcel = dashboardData.map(reg => {
    // Calculo permanencia para Excel
    let permanencia = 'En curso';
    let fechaSalida = '';

    if (reg.fechaSalida) {
      fechaSalida = reg.fechaSalida.toDate().toLocaleString();

      const inicio = reg.timestamp.toDate();
      const fin = reg.fechaSalida.toDate();
      const diffMs = fin - inicio;
      const hours = Math.floor(diffMs / (1000 * 60 * 60));
      const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
      permanencia = `${hours}h ${minutes}m`;
    }

    return {
      Fecha_Ingreso: reg.timestamp ? reg.timestamp.toDate().toLocaleString() : '',
      Fecha_Salida: fechaSalida,
      Tiempo_Permanencia: permanencia,
      Tipo_Acceso: reg.tipoAcceso,
      DNI: reg.numeroDocumento,
      Nombre: reg.nombreCompleto,
      Empresa: reg.empresa,
      Tipo_Persona: reg.tipoPersona,
      Motivo: reg.motivoIngreso,
      Contacto: reg.personaContacto,
      Estado: reg.estado,
      Observaciones_Ingreso: reg.observaciones || '',
      Observaciones_Salida: reg.observacionesSalida || ''
    };
  });

  // Crear libro y hoja
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(datosExcel);
  XLSX.utils.book_append_sheet(wb, ws, "Registros");

  // Guardar y descargar
  XLSX.utils.book_append_sheet(wb, ws, 'Registros');
  XLSX.writeFile(wb, `Reporte_Accesos_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

// ==========================================
// LÓGICA DE BUSCADOR PREDICTIVO (MODALES)
// ==========================================

let searchData = [];
let searchType = ''; // 'cliente' o 'unidad'
let searchCallback = null;

async function abrirModalBusqueda(tipo, callback) {
  const modal = document.getElementById('modalSearch');
  const input = document.getElementById('searchInput');
  const results = document.getElementById('searchResults');

  if (!modal || !input || !results) return;

  searchType = tipo;
  searchCallback = callback;
  input.value = '';
  results.innerHTML = '<div class="search-empty-state">Cargando...</div>';
  modal.style.display = 'flex';
  modal.classList.add('active');
  input.focus();

  try {
    if (tipo === 'cliente') {
      const q = query(collection(db, 'clientes'), orderBy('__name__', 'asc'));
      const snapshot = await getDocs(q);
      searchData = snapshot.docs.map(doc => ({ id: doc.id, text: doc.id.toUpperCase() }));
    } else if (tipo === 'unidad') {
      const clienteId = document.getElementById('userClient').value;
      if (!clienteId) {
        showNotification('Debe seleccionar un cliente primero', 'warning');
        cerrarModalBusqueda();
        return;
      }
      const docSnap = await getDoc(doc(db, 'clientes', clienteId));
      if (docSnap.exists()) {
        const data = docSnap.data();
        searchData = Object.entries(data)
          .filter(([k, v]) => typeof v === 'string')
          .map(([k, v]) => ({ id: v, text: v.toUpperCase() }))
          .sort((a, b) => a.text.localeCompare(b.text));
      }
    }
    renderSearchResults(searchData);
  } catch (error) {
    console.error('Error cargando buscador:', error);
    results.innerHTML = '<div class="search-empty-state">Error al cargar datos</div>';
  }
}

function renderSearchResults(data) {
  const results = document.getElementById('searchResults');
  if (!results) return;

  if (data.length === 0) {
    results.innerHTML = '<div class="search-empty-state">No se encontraron resultados</div>';
    return;
  }

  results.innerHTML = '';
  data.forEach(item => {
    const div = document.createElement('div');
    div.className = 'search-item';
    div.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"></circle>
        <path d="M12 6v6l4 2"></path>
      </svg>
      <span>${item.text}</span>
    `;
    div.onclick = () => {
      if (searchCallback) searchCallback(item);
      cerrarModalBusqueda();
    };
    results.appendChild(div);
  });
}

function filtrarResultados(queryText) {
  const filtered = searchData.filter(item =>
    item.text.toLowerCase().includes(queryText.toLowerCase())
  );
  renderSearchResults(filtered);
}

function cerrarModalBusqueda() {
  const modal = document.getElementById('modalSearch');
  if (modal) {
    modal.classList.remove('active');
    setTimeout(() => { modal.style.display = 'none'; }, 300);
  }
}

// Cerrar modales con Escape y click fuera
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    cerrarModalBusqueda();
    cerrarModalUsuario();
  }
});

document.getElementById('modalSearch')?.addEventListener('click', (e) => {
  if (e.target.id === 'modalSearch') cerrarModalBusqueda();
});

// ==========================================
// LÓGICA DE GESTIÓN DE USUARIOS (CRUD)
// ==========================================

async function cargarClientesSelect() {
  const select = document.getElementById('userClient');
  if (!select) return;

  try {
    const q = query(collection(db, 'clientes'), orderBy('__name__', 'asc'));
    const snapshot = await getDocs(q);

    select.innerHTML = '<option value="">SELECCIONAR CLIENTE</option>';
    snapshot.forEach(docSnap => {
      const option = document.createElement('option');
      option.value = docSnap.id;
      option.textContent = docSnap.id.toUpperCase();
      select.appendChild(option);
    });
  } catch (error) {
    console.error('Error cargando clientes:', error);
  }
}

async function cargarUnidadesSelect(clienteId, unidadActual = null) {
  const select = document.getElementById('userUnit');
  if (!select) return;

  select.innerHTML = '<option value="">Cargando unidades...</option>';

  try {
    const docSnap = await getDoc(doc(db, 'clientes', clienteId));
    select.innerHTML = '<option value="">SELECCIONAR UNIDAD</option>';

    if (docSnap.exists()) {
      const data = docSnap.data();
      // Filtrar campos que no sean metadatos si los hubiera, o simplemente tomar todos los valores
      // Según la imagen, los campos son "1", "2", etc.
      Object.entries(data).sort().forEach(([key, val]) => {
        if (typeof val === 'string') {
          const option = document.createElement('option');
          option.value = val;
          option.textContent = val.toUpperCase();
          select.appendChild(option);
        }
      });

      if (unidadActual) select.value = unidadActual;
    }
  } catch (error) {
    console.error('Error cargando unidades:', error);
    select.innerHTML = '<option value="">Error al cargar</option>';
  }
}

async function cargarUsuariosTable() {
  const tableBody = document.getElementById('usersTableBody');
  if (!tableBody) return;

  tableBody.innerHTML = '<tr><td colspan="7" style="text-align:center;">Cargando usuarios...</td></tr>';

  try {
    const q = query(collection(db, 'usuarios'), orderBy('apellidos', 'asc'));
    const snapshot = await getDocs(q);

    tableBody.innerHTML = '';

    if (snapshot.empty) {
      tableBody.innerHTML = '<tr><td colspan="7" style="text-align:center;">No hay usuarios registrados.</td></tr>';
      return;
    }

    snapshot.forEach(docSnap => {
      const u = docSnap.data();
      const id = docSnap.id;

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${id}</td>
        <td>${u.nombres || '-'}</td>
        <td>${u.apellidos || '-'}</td>
        <td>${u.cliente || '-'}</td>
        <td>${u.unidad || '-'}</td>
        <td><span class="status-badge ${u.tipo}">${u.tipo || 'cliente'}</span></td>
        <td class="actions-cell">
          <button class="btn-icon-only edit-user" data-id="${id}" title="Editar">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
            </svg>
          </button>
          <button class="btn-icon-only delete delete-user" data-id="${id}" title="Eliminar">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
          </button>
        </td>
      `;

      tableBody.appendChild(tr);
    });

    // Listeners para botones de acción
    document.querySelectorAll('.edit-user').forEach(btn => {
      btn.addEventListener('click', () => abrirModalUsuario(btn.dataset.id));
    });

    document.querySelectorAll('.delete-user').forEach(btn => {
      btn.addEventListener('click', () => confirmarEliminarUsuario(btn.dataset.id));
    });

  } catch (error) {
    console.error('Error cargando usuarios:', error);
    showNotification('Error al cargar la lista de usuarios', 'error');
  }
}

let editingUserId = null;

async function abrirModalUsuario(userId = null) {
  const modal = document.getElementById('modalUser');
  const title = document.getElementById('modalUserTitle');
  const form = document.getElementById('formUser');

  if (!modal || !form) return;

  editingUserId = userId;
  form.reset();

  // Limpiar selects (ahora inputs trigger)
  document.getElementById('userClient').value = '';
  document.getElementById('userUnit').value = '';

  if (userId) {
    title.textContent = 'EDITAR USUARIO';
    try {
      const docSnap = await getDoc(doc(db, 'usuarios', userId));
      if (docSnap.exists()) {
        const u = docSnap.data();
        document.getElementById('userDni').value = userId;
        document.getElementById('userDni').readOnly = true;
        document.getElementById('userNames').value = u.nombres || '';
        document.getElementById('userLastNames').value = u.apellidos || '';
        document.getElementById('userClient').value = u.cliente || '';
        document.getElementById('userUnit').value = u.unidad || '';
        document.getElementById('userRole').value = u.tipo || 'cliente';
      }
    } catch (error) {
      console.error('Error cargando datos de usuario:', error);
    }
  } else {
    title.textContent = 'NUEVO USUARIO';
    document.getElementById('userDni').readOnly = false;
  }

  modal.style.display = 'flex';
  modal.classList.add('active');
}

function cerrarModalUsuario() {
  const modal = document.getElementById('modalUser');
  if (modal) {
    modal.classList.remove('active');
    setTimeout(() => { modal.style.display = 'none'; }, 300);
  }
}

async function guardarUsuario(e) {
  e.preventDefault();

  const dni = document.getElementById('userDni').value;
  const pass = document.getElementById('userPass').value;
  const passConfirm = document.getElementById('userPassConfirm').value;

  if (pass !== passConfirm) {
    showNotification('Las contraseñas no coinciden', 'error');
    return;
  }

  const userData = {
    nombres: document.getElementById('userNames').value.toUpperCase(),
    apellidos: document.getElementById('userLastNames').value.toUpperCase(),
    cliente: document.getElementById('userClient').value.toUpperCase(),
    unidad: document.getElementById('userUnit').value.toUpperCase(),
    tipo: document.getElementById('userRole').value
  };

  const loading = document.getElementById('loadingOverlay');
  if (loading) loading.classList.add('active');

  try {
    // 1. Guardar en Firestore (Document ID = DNI)
    await updateDoc(doc(db, 'usuarios', dni), userData).catch(async (err) => {
      // Si no existe (error al actualizar), intentamos setDoc enviando el objeto completo
      const { setDoc } = await import('firebase/firestore');
      return setDoc(doc(db, 'usuarios', dni), userData);
    });

    // 2. Por ahora, si hay password, notificamos que se debe hacer vía Auth manualmente o vía secondaryApp
    if (pass) {
      showNotification('Usuario guardado. Para habilitar acceso Auth, use SecondaryApp o Consola.', 'warning');
    } else {
      showNotification('Usuario guardado correctamente', 'success');
    }

    cerrarModalUsuario();
    cargarUsuariosTable();

  } catch (error) {
    console.error('Error al guardar usuario:', error);
    showNotification('Error al procesar la solicitud', 'error');
  } finally {
    if (loading) loading.classList.remove('active');
  }
}

async function confirmarEliminarUsuario(userId) {
  if (confirm(`¿Estás seguro de eliminar el usuario con DNI ${userId}?`)) {
    const { deleteDoc } = await import('firebase/firestore');

    try {
      await deleteDoc(doc(db, 'usuarios', userId));
      showNotification('Usuario eliminado', 'success');
      cargarUsuariosTable();
    } catch (error) {
      console.error('Error eliminando:', error);
      showNotification('Error al eliminar usuario', 'error');
    }
  }
}

// Listeners del modal usuario
document.getElementById('btnCancelUser')?.addEventListener('click', cerrarModalUsuario);
document.getElementById('formUser')?.addEventListener('submit', guardarUsuario);
document.getElementById('btnNewUser')?.addEventListener('click', () => abrirModalUsuario());

// --- GESTIÓN DE CLIENTES ---

async function cargarClientesTable() {
  const tableBody = document.getElementById('clientsTableBody');
  if (!tableBody) return;

  tableBody.innerHTML = '<tr><td colspan="3" style="text-align:center;">Cargando...</td></tr>';

  try {
    const q = query(collection(db, 'clientes'));
    const snapshot = await getDocs(q);
    tableBody.innerHTML = '';

    snapshot.forEach(docSnap => {
      const clienteId = docSnap.id;
      const data = docSnap.data();

      const unidades = Object.entries(data)
        .filter(([k, v]) => !isNaN(k) && typeof v === 'string')
        .map(([k, v]) => v)
        .sort();

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="font-weight: bold; color: var(--primary-cyan);">${clienteId}</td>
        <td>
          <div style="display: flex; flex-wrap: wrap; gap: 5px;">
            ${unidades.map(u => `<span class="badge" style="background: rgba(0, 217, 255, 0.1); border: 1px solid rgba(0, 217, 255, 0.2); padding: 2px 8px; border-radius: 4px; font-size: 0.8rem;">${u}</span>`).join('')}
          </div>
        </td>
        <td>
          <div style="display: flex; gap: 8px;">
            <button class="btn-icon-only" onclick="abrirModalCliente('${clienteId}')" title="Editar Cliente">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
              </svg>
            </button>
            <button class="btn-icon-only delete" onclick="confirmarEliminarCliente('${clienteId}')" title="Eliminar Cliente">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M3 6h18"></path>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              </svg>
            </button>
          </div>
        </td>
      `;
      tableBody.appendChild(tr);
    });

    if (snapshot.empty) {
      tableBody.innerHTML = '<tr><td colspan="3" style="text-align:center;">No hay clientes registrados</td></tr>';
    }
  } catch (error) {
    console.error('Error cargando clientes:', error);
    tableBody.innerHTML = '<tr><td colspan="3" style="text-align:center; color: var(--accent-red);">Error al cargar datos</td></tr>';
  }
}

// Global para que sea accesible desde el HTML
window.confirmarEliminarCliente = async function (clienteId) {
  if (confirm(`¿Estás seguro de eliminar al cliente ${clienteId} y todas sus unidades?`)) {
    try {
      const { deleteDoc, doc } = await import('firebase/firestore');
      await deleteDoc(doc(db, 'clientes', clienteId));
      showNotification('Cliente eliminado correctamente', 'success');
      cargarClientesTable();
    } catch (error) {
      console.error('Error al eliminar cliente:', error);
      showNotification('Error al eliminar el cliente', 'error');
    }
  }
};

let editingClientId = null;

async function abrirModalCliente(clienteId = null) {
  const modal = document.getElementById('modalClient');
  const form = document.getElementById('formClient');
  const container = document.getElementById('unitsContainer');
  const title = modal?.querySelector('.modal-title');
  const clientInput = document.getElementById('clientName');

  if (!modal || !form || !container) return;

  editingClientId = clienteId;
  form.reset();
  container.innerHTML = '';

  if (clienteId) {
    if (title) title.textContent = 'EDITAR CLIENTE';
    clientInput.value = clienteId;
    clientInput.readOnly = true;

    try {
      const { getDoc, doc } = await import('firebase/firestore');
      const docSnap = await getDoc(doc(db, 'clientes', clienteId));
      if (docSnap.exists()) {
        const data = docSnap.data();
        const units = Object.entries(data)
          .filter(([k, v]) => !isNaN(k) && typeof v === 'string')
          .sort((a, b) => Number(a[0]) - Number(b[0]));

        units.forEach(([k, v], index) => {
          const div = document.createElement('div');
          div.className = 'input-row unit-row';
          div.innerHTML = `
            <input type="text" name="clientUnit" placeholder="UNIDAD ${index + 1}" required class="modern-input" value="${v}">
            <button type="button" class="btn-icon-only remove-unit">${index === 0 ? '' : '&times;'}</button>
          `;
          const removeBtn = div.querySelector('.remove-unit');
          if (index === 0) {
            removeBtn.style.display = 'none';
          } else {
            removeBtn.onclick = () => div.remove();
          }
          container.appendChild(div);
        });
      }
    } catch (error) {
      console.error('Error cargando cliente:', error);
    }
  } else {
    if (title) title.textContent = 'AGREGAR CLIENTE';
    clientInput.readOnly = false;
    container.innerHTML = `
      <div class="input-row unit-row">
        <input type="text" name="clientUnit" placeholder="UNIDAD 1" required class="modern-input">
        <button type="button" class="btn-icon-only remove-unit" style="display:none;">&times;</button>
      </div>
    `;
  }

  modal.style.display = 'flex';
  modal.classList.add('active');
}

function abrirModalUnidadAdd() {
  const modal = document.getElementById('modalUnitAdd');
  const form = document.getElementById('formUnitAdd');
  const targetUnits = document.getElementById('targetUnitsContainer');

  if (!modal || !form) return;

  form.reset();
  targetUnits.style.display = 'none';

  modal.style.display = 'flex';
  modal.classList.add('active');
}

// Listeners Clientes
document.getElementById('btnNewClient')?.addEventListener('click', () => abrirModalCliente());
document.getElementById('btnCancelClient')?.addEventListener('click', () => {
  const modal = document.getElementById('modalClient');
  if (modal) {
    modal.classList.remove('active');
    setTimeout(() => { modal.style.display = 'none'; }, 300);
  }
});

document.getElementById('btnAddUnitRow')?.addEventListener('click', () => {
  const container = document.getElementById('unitsContainer');
  if (!container) return;
  const rowCount = container.querySelectorAll('.unit-row').length;
  const div = document.createElement('div');
  div.className = 'input-row unit-row';
  div.innerHTML = `
      <input type="text" name="clientUnit" placeholder="UNIDAD ${rowCount + 1}" required class="modern-input">
      <button type="button" class="btn-icon-only remove-unit">&times;</button>
    `;
  div.querySelector('.remove-unit').onclick = () => div.remove();
  container.appendChild(div);
});

document.getElementById('formClient')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const clientName = document.getElementById('clientName').value.trim().toUpperCase();
  const unitInputs = document.querySelectorAll('input[name="clientUnit"]');

  if (!clientName) return;

  const data = {};
  unitInputs.forEach((input, index) => {
    if (input.value.trim()) {
      data[String(index + 1)] = input.value.trim().toUpperCase();
    }
  });

  try {
    const { setDoc, doc } = await import('firebase/firestore');
    await setDoc(doc(db, 'clientes', clientName), data);
    showNotification('Cliente guardado con éxito', 'success');

    const modal = document.getElementById('modalClient');
    if (modal) {
      modal.classList.remove('active');
      setTimeout(() => { modal.style.display = 'none'; }, 300);
    }
    cargarClientesTable();
  } catch (error) {
    console.error('Error Guardar Cliente:', error);
    showNotification('Error al guardar cliente', 'error');
  }
});

// Listeners Unidad (Individual)
document.getElementById('btnNewUnit')?.addEventListener('click', abrirModalUnidadAdd);
document.getElementById('btnCancelUnitAdd')?.addEventListener('click', () => {
  const modal = document.getElementById('modalUnitAdd');
  if (modal) {
    modal.classList.remove('active');
    setTimeout(() => { modal.style.display = 'none'; }, 300);
  }
});

document.getElementById('targetClient')?.addEventListener('click', () => {
  abrirModalBusqueda('cliente', (item) => {
    document.getElementById('targetClient').value = item.id;
    document.getElementById('targetUnitsContainer').style.display = 'block';
  });
});

document.getElementById('btnAddMoreUnits')?.addEventListener('click', () => {
  const container = document.getElementById('newUnitsList');
  if (!container) return;
  const div = document.createElement('div');
  div.className = 'input-row unit-row';
  div.innerHTML = `
      <input type="text" name="newUnit" placeholder="NOMBRE DE LA UNIDAD" class="modern-input">
      <button type="button" class="btn-icon-only remove-unit">&times;</button>
    `;
  div.querySelector('.remove-unit').onclick = () => div.remove();
  container.appendChild(div);
});

document.getElementById('formUnitAdd')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const clienteId = document.getElementById('targetClient').value;
  const unitInputs = document.querySelectorAll('input[name="newUnit"]');

  if (!clienteId) return;

  try {
    const { getDoc, updateDoc, doc } = await import('firebase/firestore');
    const docRef = doc(db, 'clientes', clienteId);
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
      const currentData = docSnap.data();
      const nextIndex = Math.max(...Object.keys(currentData).filter(k => !isNaN(k)).map(Number), 0) + 1;

      const updates = {};
      unitInputs.forEach((input, i) => {
        if (input.value.trim()) {
          updates[String(nextIndex + i)] = input.value.trim().toUpperCase();
        }
      });

      await updateDoc(docRef, updates);
      showNotification('Unidades agregadas correctamente', 'success');

      const modal = document.getElementById('modalUnitAdd');
      if (modal) {
        modal.classList.remove('active');
        setTimeout(() => { modal.style.display = 'none'; }, 300);
      }
      cargarClientesTable();
    }
  } catch (error) {
    console.error('Error Update Units:', error);
    showNotification('Error al actualizar unidades', 'error');
  }
});



// Triggers del Buscador
document.getElementById('userClient')?.addEventListener('click', () => {
  abrirModalBusqueda('cliente', (item) => {
    const input = document.getElementById('userClient');
    const unitInput = document.getElementById('userUnit');
    if (input.value !== item.id) {
      input.value = item.id;
      unitInput.value = ''; // Resetear unidad si cambia cliente
    }
  });
});

document.getElementById('userUnit')?.addEventListener('click', () => {
  abrirModalBusqueda('unidad', (item) => {
    document.getElementById('userUnit').value = item.id;
  });
});

// Listeners del Modal Buscador
document.getElementById('btnCloseSearch')?.addEventListener('click', cerrarModalBusqueda);
document.getElementById('searchInput')?.addEventListener('input', (e) => {
  filtrarResultados(e.target.value);
  document.getElementById('btnClearSearch').style.display = e.target.value ? 'block' : 'none';
});
document.getElementById('btnClearSearch')?.addEventListener('click', () => {
  const input = document.getElementById('searchInput');
  input.value = '';
  input.focus();
  filtrarResultados('');
  document.getElementById('btnClearSearch').style.display = 'none';
});
