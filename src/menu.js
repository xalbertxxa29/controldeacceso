import './style.css';
import { auth, db, functions, httpsCallable } from './firebase.js';
import { signOut } from 'firebase/auth';
import { collection, addDoc, query, orderBy, limit, onSnapshot, serverTimestamp, where, getDocs, updateDoc, doc, Timestamp, getDoc, or } from 'firebase/firestore';
import { renderizarGraficos, actualizarTablaDashboard } from './charts.js';
import * as XLSX from 'xlsx';

// Variables de sesión (Se actualizarán dinámicamente)
let userClient = localStorage.getItem('userClient');
let userUnit = localStorage.getItem('userUnit');
let userFullName = `${localStorage.getItem('userName') || ''} ${localStorage.getItem('userLastName') || ''}`.trim();
let userType = localStorage.getItem('userType');

// Funciones globales de modales
window.abrirModal = function (id) {
  const modal = document.getElementById(id);
  if (modal) {
    modal.style.display = 'flex';
    // Forzar reflow para animación
    void modal.offsetWidth;
    modal.classList.add('active');
  }
};

window.cerrarModal = function (id) {
  const modal = document.getElementById(id);
  if (modal) {
    modal.classList.remove('active');
    setTimeout(() => {
      modal.style.display = 'none';
    }, 300);
  }
};

// Verificar autenticación
auth.onAuthStateChanged(async (user) => {
  if (!user) {
    window.location.href = '/index.html';
  } else {
    // 1. Recuperar variables de localStorage
    userClient = localStorage.getItem('userClient');
    userUnit = localStorage.getItem('userUnit');
    userFullName = `${localStorage.getItem('userName') || ''} ${localStorage.getItem('userLastName') || ''}`.trim();
    userType = localStorage.getItem('userType');

    console.log('Session state detected:', { userClient, userUnit, userFullName, userType });

    // AUTORECUPERACIÓN: Si hay usuario Auth pero faltan datos en LocalStorage
    if (!userClient || !userUnit) {
      console.log('Sesión incompleta detectada. Recuperando perfil de Firestore...');
      try {
        const userEmail = user.email;
        if (!userEmail) throw new Error('Usuario sin email registrado');

        const userId = userEmail.split('@')[0];
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

          if (data.tipo !== 'cliente' && data.tipo !== 'admin') {
            await signOut(auth);
            localStorage.clear();
            window.location.href = '/index.html';
            return;
          }

          console.log('Perfil recuperado. Recargando...');
          window.location.reload();
          return;
        } else {
          console.error('Usuario autenticado no tiene perfil en BD.');
          mostrarAviso('ERROR DE ACCESO', 'Tu usuario no tiene perfil de unidad asignado en el sistema. Contacte al administrador.', 'error');
        }
      } catch (err) {
        console.error('Error recuperando perfil:', err);
      }
    }

    // 2. Si todo está bien, mostrar datos en Header
    const userDisplay = document.getElementById('userName');
    if (userDisplay) {
      console.log('Updating user display...');
      userDisplay.textContent = `Bienvenido: ${userFullName} - ${userClient || '---'} ${userUnit || '---'}`;
    } else {
      console.warn('userDisplay element (#userName) not found');
    }

    // 3. MOSTRAR NAV ITEMS ADMINISTRATIVOS SOLO SI ES ADMIN
    if (userType === 'admin') {
      const navUsers = document.getElementById('nav-users');
      const navClients = document.getElementById('nav-clients');
      if (navUsers) navUsers.style.display = 'flex';
      if (navClients) navClients.style.display = 'flex';
    }

    // 4. Inicializar datos que dependen de la sesión
    inicializarDatosSession();
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
    if (modalDuplicidad) {
      modalDuplicidad.classList.remove('active');
      setTimeout(() => {
        modalDuplicidad.style.display = 'none';
        const loading = document.getElementById('loadingOverlay');
        if (loading) loading.classList.remove('active');
      }, 300);
    }
  });
}

// Estado de la aplicación
let registros = [];
let totalIngresos = 0;
let totalSalidas = 0;
let registroSalidaId = null; // ID del registro que se está cerrando

// Función para mostrar mensajes del sistema como Modal
window.mostrarAviso = function (titulo, mensaje, tipo = 'warning') {
  const modal = document.getElementById('modalAviso');
  const card = document.getElementById('avisoCard');
  const titleEl = document.getElementById('avisoTitulo');
  const msgEl = document.getElementById('avisoMensaje');
  const iconCont = document.getElementById('avisoIconContainer');

  if (!modal || !card || !titleEl || !msgEl) return;

  // Limpiar clases previas
  card.classList.remove('warning-border', 'error-border', 'success-border');

  // Estilo según tipo
  let iconHtml = '';
  if (tipo === 'error') {
    card.classList.add('error-border');
    titleEl.style.color = 'var(--accent-red)';
    iconHtml = `<svg width="60" height="60" viewBox="0 0 24 24" fill="none" class="error-icon" stroke="var(--accent-red)" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`;
  } else if (tipo === 'success') {
    card.classList.add('success-border');
    titleEl.style.color = '#00d964';
    iconHtml = `<svg width="60" height="60" viewBox="0 0 24 24" fill="none" class="success-icon" stroke="#00d964" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`;
  } else {
    card.classList.add('warning-border');
    titleEl.style.color = 'var(--primary-cyan)';
    iconHtml = `<svg width="60" height="60" viewBox="0 0 24 24" fill="none" class="warning-icon" stroke="var(--primary-cyan)" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
  }

  titleEl.textContent = titulo.toUpperCase();
  msgEl.textContent = mensaje;
  iconCont.innerHTML = iconHtml;

  abrirModal('modalAviso');
};

// Función asincrónica para mostrar modal de confirmación
window.mostrarConfirmacion = function (titulo, mensaje) {
  return new Promise((resolve) => {
    const modal = document.getElementById('modalConfirmacion');
    const titleEl = document.getElementById('confirmTitulo');
    const msgEl = document.getElementById('confirmMensaje');
    const btnSi = document.getElementById('btnConfirmSi');
    const btnNo = document.getElementById('btnConfirmNo');

    if (!modal) {
      resolve(confirm(mensaje)); // fallback
      return;
    }

    titleEl.textContent = titulo.toUpperCase();
    msgEl.textContent = mensaje;

    const hideAndResolve = (result) => {
      window.cerrarModal('modalConfirmacion');
      // Limpiamos los eventos clonando los botones (o removiendo listeners si los guardáramos, pero esta forma es más directa)
      const newBtnSi = btnSi.cloneNode(true);
      const newBtnNo = btnNo.cloneNode(true);
      btnSi.parentNode.replaceChild(newBtnSi, btnSi);
      btnNo.parentNode.replaceChild(newBtnNo, btnNo);

      newBtnSi.addEventListener('click', () => hideAndResolve(true)); // solo por si acaso
      resolve(result);
    };

    // Agregar listeners puros
    btnSi.onclick = () => hideAndResolve(true);
    btnNo.onclick = () => hideAndResolve(false);

    window.abrirModal('modalConfirmacion');
  });
};

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

  // No auto-eliminar si type es error para que el usuario lo vea bien
  if (type !== 'error') {
    setTimeout(() => {
      notification.style.animation = 'slideOut 0.3s ease-out';
      setTimeout(() => notification.remove(), 300);
    }, 4000);
  } else {
    // Botón para cerrar manual si es error
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.style.cssText = 'background:none; border:none; color:inherit; cursor:pointer; font-weight:bold; margin-left:auto;';
    closeBtn.onclick = () => notification.remove();
    notification.appendChild(closeBtn);
  }
}

// Cerrar sesión
if (btnLogout) {
  console.log('Attaching logout listener...');
  btnLogout.addEventListener('click', async () => {
    console.log('Logout clicked');
    try {
      await signOut(auth);
      localStorage.clear();
      window.location.href = './index.html';
    } catch (error) {
      console.error('Error al cerrar sesión:', error);
      showNotification('Error al cerrar sesión', 'error');
    }
  });
} else {
  console.warn('btnLogout not found');
}

// Listener para cambio de Tipo de Acceso
const radiosTipoAcceso = document.querySelectorAll('input[name="tipoAcceso"]');
radiosTipoAcceso.forEach(radio => {
  radio.addEventListener('change', (e) => {
    limpiarFormulario(); // Limpiar todo al cambiar modo
    const rowPase = document.getElementById('row-pase');
    if (e.target.value === 'salida') {
      if (rowPase) rowPase.style.display = 'block';
      showNotification('Modo SALIDA: Busque por Documento y Nro de Pase', 'info');
    } else {
      if (rowPase) rowPase.style.display = 'none';
      if (dniInput) dniInput.placeholder = "Ingrese DNI";
    }
  });
});

// Función para limpiar campos
function limpiarFormulario() {
  if (dniInput) dniInput.value = '';
  const nroPaseBus = document.getElementById('nroPaseBusqueda');
  if (nroPaseBus) nroPaseBus.value = '';

  // Limpiar campos de todos los modales (solo si existen)
  const elements = [
    'motivoIngreso', 'empresa', 'personaContacto', 'observaciones', 'nroPase',
    'mIngresoDni', 'mIngresoNombre', 'mIngresoMotivo', 'mIngresoEmpresa', 'mIngresoContacto', 'mIngresoPase', 'mIngresoObs',
    'mSalidaObsSalida', 'mManualDocumento', 'mManualNombre', 'mManualMotivo', 'mManualEmpresa', 'mManualContacto', 'mManualPase', 'mManualObs'
  ];

  elements.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });

  updateTrafficLight('yellow');
}

// === LÓGICA CARNET EXTRANJERÍA ===
if (carnetExtranjeriaCheckbox) {
  carnetExtranjeriaCheckbox.addEventListener('change', () => {
    const isChecked = carnetExtranjeriaCheckbox.checked;
    const tipoAcceso = document.querySelector('input[name="tipoAcceso"]:checked').value;

    if (isChecked) {
      if (tipoAcceso === 'ingreso') {
        // Abrir modal manual de inmediato para ingreso
        window.abrirModal('modalManual');
        // Reset checkbox
        carnetExtranjeriaCheckbox.checked = false;
      } else {
        // En salida solo cambia el placeholder
        dniInput.placeholder = "Carnet Extranjería";
        showNotification('Modo SALIDA (Carnet): Ingrese Carnet y Nro de Pase', 'info');
      }
    } else {
      dniInput.placeholder = "Ingrese DNI";
    }
  });

  // Forzar Mayúsculas en tiempo real para DNI y Nombre Completo
  [dniInput, nombreCompletoInput].forEach(input => {
    if (input) {
      input.addEventListener('input', () => {
        if (carnetExtranjeriaCheckbox && carnetExtranjeriaCheckbox.checked) {
          input.value = input.value.toUpperCase();
        }
      });
    }
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

// Buscar Documento (Boton Lupa)
btnBuscarDNI.addEventListener('click', async () => {
  const dni = dniInput.value.trim();
  const nroPaseBusqueda = document.getElementById('nroPaseBusqueda').value.trim();
  const tipoAcceso = document.querySelector('input[name="tipoAcceso"]:checked').value;
  const isCarnet = carnetExtranjeriaCheckbox.checked;

  if (tipoAcceso === 'ingreso' && !dni) {
    showNotification('Por favor, ingrese el documento', 'warning');
    dniInput.focus();
    return;
  }

  if (tipoAcceso === 'salida' && !dni && !nroPaseBusqueda) {
    showNotification('Ingrese Documento o Nro de Pase para buscar', 'warning');
    dniInput.focus();
    return;
  }

  showLoading();
  try {
    if (tipoAcceso === 'ingreso') {
      // BUSQUEDA PARA INGRESO
      if (isCarnet) return; // Ya se manejó al marcar el check

      // Buscar en Firestore (Cache)
      const qHistorial = query(collection(db, 'accesos'), where('numeroDocumento', '==', dni), orderBy('timestamp', 'desc'), limit(1));
      const snapshotHistorial = await getDocs(qHistorial);
      let nombreEncontrado = "";

      if (!snapshotHistorial.empty) {
        nombreEncontrado = snapshotHistorial.docs[0].data().nombreCompleto;
        showNotification('Nombre obtenido del historial ✔', 'success');
      } else {
        // Consultar RENIEC
        const { functions, httpsCallable } = await import('./firebase.js');
        const buscarDNICallable = httpsCallable(functions, 'buscarDNI');
        const result = await buscarDNICallable({ dni });
        if (result.data && result.data.success) {
          nombreEncontrado = result.data.data.nombre;
          showNotification('Nombre obtenido de RENIEC ✔', 'success');
        } else {
          mostrarAviso('REGISTRO NO ENCONTRADO', 'No se encontró información para el documento ingresado en el historial ni en RENIEC. Por favor, realice un registro manual si es necesario.', 'warning');
          return;
        }
      }

      // Llenar modal ingreso
      document.getElementById('mIngresoDni').value = dni;
      document.getElementById('mIngresoNombre').value = nombreEncontrado;
      document.getElementById('mIngresoMotivo').value = "";
      document.getElementById('mIngresoEmpresa').value = "";
      document.getElementById('mIngresoContacto').value = "";
      document.getElementById('mIngresoPase').value = "";
      document.getElementById('mIngresoObs').value = "";
      abrirModal('modalIngreso');

    } else {
      // BUSQUEDA PARA SALIDA
      const queries = [
        where('estado', '==', 'Activo'),
        where('cliente', '==', userClient),
        where('unidad', '==', userUnit)
      ];

      // Construir filtro OR dinámico
      if (dni && nroPaseBusqueda) {
        queries.push(or(where('numeroDocumento', '==', dni), where('nroPase', '==', nroPaseBusqueda)));
      } else if (dni) {
        queries.push(where('numeroDocumento', '==', dni));
      } else {
        queries.push(where('nroPase', '==', nroPaseBusqueda));
      }

      const q = query(collection(db, 'accesos'), ...queries, limit(1));

      const snapshot = await getDocs(q);
      if (snapshot.empty) {
        throw new Error('No se encontró un ingreso ACTIVO con esos datos.');
      }

      const docSalida = snapshot.docs[0];
      const data = docSalida.data();
      registroSalidaId = docSalida.id;

      // Llenar modal salida
      document.getElementById('mSalidaDni').value = data.numeroDocumento;
      document.getElementById('mSalidaNombre').value = data.nombreCompleto;
      document.getElementById('mSalidaMotivo').value = data.motivoIngreso || "";
      document.getElementById('mSalidaEmpresa').value = data.empresa || "";
      document.getElementById('mSalidaContacto').value = data.personaContacto || "";
      document.getElementById('mSalidaPase').value = data.nroPase || "";
      document.getElementById('mSalidaObsSalida').value = "";
      abrirModal('modalSalida');
    }
    updateTrafficLight('green');
  } catch (err) {
    mostrarAviso('BÚSQUEDA FALLIDA', err.message, 'error');
    updateTrafficLight('red');
  } finally {
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

// === CONFIRMACIÓN DE INGRESO (MODAL) ===
document.getElementById('btnConfirmarIngreso').addEventListener('click', async () => {
  const dni = document.getElementById('mIngresoDni').value;
  const nombre = document.getElementById('mIngresoNombre').value;
  const motivo = document.getElementById('mIngresoMotivo').value.trim();
  const empresa = document.getElementById('mIngresoEmpresa').value.trim();
  const contacto = document.getElementById('mIngresoContacto').value.trim();
  const pase = document.getElementById('mIngresoPase').value.trim();
  const obs = document.getElementById('mIngresoObs').value.trim();
  const tipoPersona = document.querySelector('input[name="tipoPersona"]:checked').value;

  // Nro de Pase es ahora OPCIONAL

  showLoading();
  try {
    // VALIDAR DUPLICIDAD DE DNI
    const qDni = query(
      collection(db, 'accesos'),
      where('numeroDocumento', '==', dni),
      where('estado', '==', 'Activo'),
      where('cliente', '==', userClient),
      where('unidad', '==', userUnit),
      limit(1)
    );
    const snapDni = await getDocs(qDni);
    if (!snapDni.empty) {
      mostrarAviso('INGRESO ACTIVO DETECTADO', `El usuario con documento ${dni} ya cuenta con un ingreso activo en esta sede. DEBE MARCAR SU SALIDA ANTES DE UN NUEVO INGRESO.`, 'error');
      hideLoading();
      return;
    }

    // VALIDAR PASE DUPLICADO (SOLO SI SE INGRESÓ UNO)
    if (pase) {
      const qPase = query(
        collection(db, 'accesos'),
        where('nroPase', '==', pase.toUpperCase()),
        where('estado', '==', 'Activo'),
        where('cliente', '==', userClient),
        where('unidad', '==', userUnit),
        limit(1)
      );
      const snapPase = await getDocs(qPase);
      if (!snapPase.empty) {
        mostrarAviso('PASE EN USO', `El Nro de Pase ${pase} ya está asignado a otra persona en esta unidad.`, 'error');
        hideLoading();
        return;
      }
    }

    await addDoc(collection(db, 'accesos'), {
      numeroDocumento: dni,
      nombreCompleto: nombre.toUpperCase(),
      motivoIngreso: motivo.toUpperCase(),
      empresa: empresa.toUpperCase(),
      personaContacto: contacto.toUpperCase(),
      nroPase: pase.toUpperCase(),
      observaciones: obs.toUpperCase(),
      tipoPersona: tipoPersona,
      tipoAcceso: 'Ingreso',
      estado: 'Activo',
      timestamp: serverTimestamp(),
      cliente: userClient,
      unidad: userUnit,
      usuarioRegistro: userFullName
    });

    showNotification('Ingreso registrado con éxito', 'success');
    cerrarModal('modalIngreso');
    limpiarFormulario();
  } catch (err) {
    mostrarAviso('ERROR DE REGISTRO', 'Hubo un fallo al intentar guardar el ingreso en la base de datos.', 'error');
  } finally {
    hideLoading();
  }
});

// === CONFIRMACIÓN DE SALIDA (MODAL) ===
document.getElementById('btnConfirmarSalida').addEventListener('click', async () => {
  const obsSalida = document.getElementById('mSalidaObsSalida').value.trim();
  showLoading();
  try {
    const ref = doc(db, 'accesos', registroSalidaId);
    await updateDoc(ref, {
      estado: 'Cerrado',
      fechaSalida: serverTimestamp(),
      observacionesSalida: obsSalida.toUpperCase(),
      usuarioSalida: userFullName
    });
    showNotification('Salida registrada con éxito', 'success');
    cerrarModal('modalSalida');
    limpiarFormulario();
  } catch (err) {
    mostrarAviso('ERROR DE SALIDA', 'No se pudo registrar la salida correctamente.', 'error');
  } finally {
    hideLoading();
  }
});

// === CONFIRMACIÓN MANUAL (MODAL) ===
document.getElementById('btnConfirmarManual').addEventListener('click', async () => {
  const dni = document.getElementById('mManualDocumento').value.trim();
  const nombre = document.getElementById('mManualNombre').value.trim();
  const motivo = document.getElementById('mManualMotivo').value.trim();
  const empresa = document.getElementById('mManualEmpresa').value.trim();
  const contacto = document.getElementById('mManualContacto').value.trim();
  const pase = document.getElementById('mManualPase').value.trim();
  const obs = document.getElementById('mManualObs').value.trim();
  const tipoPersona = document.querySelector('input[name="tipoPersona"]:checked').value;

  if (!dni || !nombre) {
    mostrarAviso('DATOS INCOMPLETOS', 'Debe completar Documento y Nombre para proceder. El pase es opcional.', 'warning');
    return;
  }

  showLoading();
  try {
    // VALIDAR DUPLICIDAD DE DNI
    const qDni = query(
      collection(db, 'accesos'),
      where('numeroDocumento', '==', dni.toUpperCase()),
      where('estado', '==', 'Activo'),
      where('cliente', '==', userClient),
      where('unidad', '==', userUnit),
      limit(1)
    );
    const snapDni = await getDocs(qDni);
    if (!snapDni.empty) {
      mostrarAviso('INGRESO ACTIVO DETECTADO', `El usuario con documento ${dni} ya cuenta con un ingreso activo. Por seguridad, no se permiten duplicados simultáneos.`, 'error');
      hideLoading();
      return;
    }

    // VALIDAR PASE DUPLICADO (SOLO SI SE INGRESÓ UNO)
    if (pase) {
      const qPase = query(
        collection(db, 'accesos'),
        where('nroPase', '==', pase.toUpperCase()),
        where('estado', '==', 'Activo'),
        where('cliente', '==', userClient),
        where('unidad', '==', userUnit),
        limit(1)
      );
      const snapPase = await getDocs(qPase);
      if (!snapPase.empty) {
        mostrarAviso('PASE EN USO', `El Nro de Pase ${pase} ya está en uso por otra persona en esta unidad.`, 'error');
        hideLoading();
        return;
      }
    }

    await addDoc(collection(db, 'accesos'), {
      numeroDocumento: dni.toUpperCase(),
      nombreCompleto: nombre.toUpperCase(),
      motivoIngreso: motivo.toUpperCase(),
      empresa: empresa.toUpperCase(),
      personaContacto: contacto.toUpperCase(),
      nroPase: pase.toUpperCase(),
      observaciones: obs.toUpperCase(),
      tipoPersona: tipoPersona,
      tipoAcceso: 'Ingreso',
      estado: 'Activo',
      timestamp: serverTimestamp(),
      cliente: userClient,
      unidad: userUnit,
      usuarioRegistro: userFullName,
      esManual: true
    });

    showNotification('Registro manual exitoso', 'success');
    cerrarModal('modalManual');
    limpiarFormulario();
  } catch (err) {
    showNotification('Error al registrar manual', 'error');
  } finally {
    hideLoading();
  }
});


// ==========================================
// LÓGICA DE MODAL SALIDA SIMPLE (PASOS)
// ==========================================
const modalSalidaSimple = document.getElementById('modalSalidaSimple');
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

if (document.getElementById('btnConfirmarSalidaSimple')) {
  document.getElementById('btnConfirmarSalidaSimple').addEventListener('click', () => {
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
  if (modalSalidaSimple) {
    modalSalidaSimple.classList.remove('active');
    setTimeout(() => {
      modalSalidaSimple.style.display = 'none';
      // Resetear pasos
      if (modalStep1) modalStep1.style.display = 'block';
      if (modalStep2) modalStep2.style.display = 'none';
      if (inputObservacionSalida) inputObservacionSalida.value = '';
    }, 300);
  }
}

// Ya se implementaron las funciones globales window.abrirModal y window.cerrarModal al inicio

function abrirModalSalida() {
  if (modalSalidaSimple) {
    modalSalidaSimple.style.display = 'flex';
    modalSalidaSimple.offsetHeight; // Force reflow
    modalSalidaSimple.classList.add('active');
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
      mostrarAviso('ERROR DE SISTEMA', 'Fallo crítico al consultar duplicados. Ver consola para más detalles.', 'error');
      hideLoading();
      btnRegistrar.disabled = false;
      return;
    }

    // VALIDAR PASE DUPLICADO (SOLO SI SE INGRESÓ UNO)
    if (nroPase) {
      const qPase = query(
        collection(db, 'accesos'),
        where('nroPase', '==', nroPase.toUpperCase()),
        where('estado', '==', 'Activo'),
        where('cliente', '==', userClient),
        where('unidad', '==', userUnit),
        limit(1)
      );
      const snapPase = await getDocs(qPase);
      if (!snapPase.empty) {
        mostrarAviso('PASE EN USO', `El Nro de Pase ${nroPase} ya está asignado a otra persona en esta sede.`, 'error');
        hideLoading();
        btnRegistrar.disabled = false;
        return;
      }
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


// Escuchar cambios en la colección de accesos (Solo cuando hay sesión)
function inicializarDatosSession() {
  console.log('Iniciando listeners de sesión para:', userClient, userUnit);

  // Foco inicial
  if (dniInput) dniInput.focus();

  // Listener cambio Tipo Persona (para devolver foco al DNI)
  const radiosTipoPersona = document.querySelectorAll('input[name="tipoPersona"]');
  radiosTipoPersona.forEach(r => {
    r.addEventListener('change', () => {
      if (dniInput) dniInput.focus();
    });
  });

  // Query principal filtrada por cliente y unidad
  if (!userClient || !userUnit) {
    console.warn('No se puede iniciar query: faltan cliente/unidad');
    return;
  }

  const q = query(
    collection(db, 'accesos'),
    where('cliente', '==', userClient),
    where('unidad', '==', userUnit),
    orderBy('timestamp', 'desc'),
    limit(50)
  );

  showLoading(); // Iniciar carga inicial
  onSnapshot(q, (snapshot) => {
    hideLoading(); // Ocultar al recibir datos
    registros = [];
    totalIngresos = 0;
    totalSalidas = 0;

    snapshot.forEach((doc) => {
      const data = doc.data();
      registros.push({ id: doc.id, ...data });

      if (data.tipoAcceso === 'Ingreso' || data.tipoAcceso === 'ingreso') {
        totalIngresos++;
      }

      if (data.estado === 'Cerrado') {
        totalSalidas++;
      }
    });

    actualizarTabla();
    actualizarEstadisticas();
  }, (error) => {
    console.error('Error en onSnapshot:', error);
    if (error.code === 'permission-denied') {
      showNotification('Error de permisos al cargar registros', 'error');
    }
  });
}

function inicializarListeners() {
  // Listener botón Limpiar
  if (btnLimpiar) btnLimpiar.addEventListener('click', limpiarFormulario);
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

    // Formatear fecha salida
    let fechaSalidaFormateada = '-';
    if (registro.fechaSalida) {
      const fechaS = registro.fechaSalida.toDate();
      fechaSalidaFormateada = fechaS.toLocaleString('es-PE', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    }

    tr.innerHTML = `
      <td data-label="Fecha Ingreso">${fechaFormateada}</td>
      <td data-label="Fecha Salida">${fechaSalidaFormateada}</td>
      <td data-label="Nro de Pase">${registro.nroPase || '-'}</td>
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
  if (totalIngresosEl) totalIngresosEl.textContent = totalIngresos;
  if (totalSalidasEl) totalSalidasEl.textContent = totalSalidas;
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
inicializarForzadoMayusculas();

// --- LÓGICA DE CONECTIVIDAD ---
function inicializarConectividad() {
  const connectionStatus = document.getElementById('connectionStatus');

  function updateStatus() {
    if (navigator.onLine) {
      if (connectionStatus) {
        connectionStatus.innerHTML = '<span class="status-dot online"></span> En Línea';
        connectionStatus.style.color = 'var(--primary-cyan)';
      }
    } else {
      if (connectionStatus) {
        connectionStatus.innerHTML = '<span class="status-dot offline"></span> Desconectado';
        connectionStatus.style.color = 'var(--accent-red)';
      }
    }
  }

  window.addEventListener('online', updateStatus);
  window.addEventListener('offline', updateStatus);
  updateStatus();
}

// --- FORZADO DE MAYÚSCULAS ---
function inicializarForzadoMayusculas() {
  const selector = 'input[type="text"], textarea, input[type="search"]';

  // Delegación de eventos para capturar incluso elementos dinámicos
  document.addEventListener('input', (e) => {
    if (e.target.matches(selector)) {
      // Excepto campos de contraseña o emails si los hubiera (en este caso no parece haber email inputs)
      if (e.target.id === 'userPass' || e.target.id === 'userPassConfirm') return;

      const start = e.target.selectionStart;
      const end = e.target.selectionEnd;
      e.target.value = e.target.value.toUpperCase();
      e.target.setSelectionRange(start, end);
    }
  });
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

// Función para alternar modo salida (Helper)
function toggleModoSalida(isSalida) {
  const rowPase = document.getElementById('row-pase');
  if (rowPase) rowPase.style.display = isSalida ? 'block' : 'none';
  if (dniInput) dniInput.placeholder = isSalida ? "Documento + Nro Pase" : "Ingrese DNI";
}

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
        const startInput = document.getElementById('filterStartDate');
        const endInput = document.getElementById('filterEndDate');
        const today = new Date().toISOString().split('T')[0];
        if (startInput && !startInput.value) startInput.value = today;
        if (endInput && !endInput.value) endInput.value = today;
        popularFiltrosDashboard();
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

async function popularFiltrosDashboard() {
  const filterClient = document.getElementById('filterClient');
  const filterUnit = document.getElementById('filterUnit');
  const userType = localStorage.getItem('userType');

  if (!filterClient || !filterUnit) return;

  // Limpiar y resetear
  filterClient.innerHTML = '<option value="TODOS">TODOS LOS CLIENTES</option>';
  filterUnit.innerHTML = '<option value="TODOS">TODAS LAS UNIDADES</option>';

  try {
    const q = query(collection(db, 'clientes'));
    const snapshot = await getDocs(q);
    const clientsData = {};

    snapshot.forEach(docSnap => {
      const clientName = docSnap.id;
      const data = docSnap.data();
      const units = Object.entries(data)
        .filter(([k, v]) => !isNaN(k) && typeof v === 'string')
        .map(([k, v]) => v)
        .sort();
      clientsData[clientName] = units;
    });

    // Si es admin, puede ver todo. Si es cliente, solo lo suyo.
    if (userType === 'admin') {
      Object.keys(clientsData).sort().forEach(client => {
        const opt = document.createElement('option');
        opt.value = client;
        opt.textContent = client;
        filterClient.appendChild(opt);
      });

      filterClient.onchange = () => {
        filterUnit.innerHTML = '<option value="TODOS">TODAS LAS UNIDADES</option>';
        const selectedClient = filterClient.value;
        if (selectedClient !== 'TODOS' && clientsData[selectedClient]) {
          clientsData[selectedClient].forEach(unit => {
            const opt = document.createElement('option');
            opt.value = unit;
            opt.textContent = unit;
            filterUnit.appendChild(opt);
          });
        }
      };
    } else {
      // Es rol cliente, restringir
      filterClient.innerHTML = `<option value="${userClient}">${userClient}</option>`;
      filterClient.disabled = true;

      if (clientsData[userClient]) {
        clientsData[userClient].forEach(unit => {
          const opt = document.createElement('option');
          opt.value = unit;
          opt.textContent = unit;
          filterUnit.appendChild(opt);
        });
      }
    }
  } catch (error) {
    console.error('Error populando filtros:', error);
  }
}

async function cargarDashboard() {
  const startDate = document.getElementById('filterStartDate').value;
  const endDate = document.getElementById('filterEndDate').value;
  const clientFilter = document.getElementById('filterClient').value;
  const unitFilter = document.getElementById('filterUnit').value;

  if (!startDate || !endDate) {
    showNotification('Por favor seleccione el rango de fechas', 'warning');
    return;
  }

  // Definir rango: desde las 00:00:00 del inicio hasta las 23:59:59 del fin
  const start = new Date(startDate + 'T00:00:00');
  const end = new Date(endDate + 'T23:59:59');

  if (end < start) {
    showNotification('La fecha final no puede ser anterior a la inicial', 'warning');
    return;
  }

  showNotification('Cargando indicadores...', 'info');

  try {
    let qParts = [
      collection(db, 'accesos'),
      where('timestamp', '>=', Timestamp.fromDate(start)),
      where('timestamp', '<=', Timestamp.fromDate(end))
    ];

    // Aplicar filtros de cliente/unidad si no es "TODOS"
    if (clientFilter !== 'TODOS') {
      qParts.push(where('cliente', '==', clientFilter));
    }
    if (unitFilter !== 'TODOS') {
      qParts.push(where('unidad', '==', unitFilter));
    }

    qParts.push(orderBy('timestamp', 'desc'));

    const q = query(...qParts);
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
    if (error.code === 'failed-precondition') {
      showNotification('Error: Falta índice en Firestore para estos filtros.', 'error');
    } else {
      showNotification('Error al cargar datos. Verifique conexión.', 'error');
    }
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

  // Generar nombre de archivo
  const fechaStr = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `Reporte_Accesos_${fechaStr}.xlsx`);

  showNotification('Excel generado correctamente', 'success');
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

let currentUsersData = [];
let usersCurrentPage = 1;
const USERS_ITEMS_PER_PAGE = 20;
let usersSearchQuery = '';
let usersPaginationListenersAttached = false;

async function cargarUsuariosTable() {
  showLoading();
  const tableBody = document.getElementById('usersTableBody');
  if (!tableBody) return;

  try {
    const q = query(collection(db, 'usuarios'), orderBy('apellidos', 'asc'));
    const snapshot = await getDocs(q);

    currentUsersData = [];
    snapshot.forEach(docSnap => {
      const u = docSnap.data();
      currentUsersData.push({ id: docSnap.id, ...u });
    });

    usersCurrentPage = 1;

    // Attach search listener if not already
    const searchInput = document.getElementById('searchInputUsers');
    if (searchInput && !searchInput.dataset.listenerAttached) {
      searchInput.addEventListener('input', (e) => {
        usersSearchQuery = e.target.value.toLowerCase();
        usersCurrentPage = 1;
        renderUsersTablePage();
      });
      searchInput.dataset.listenerAttached = 'true';
    }

    renderUsersTablePage();
  } catch (error) {
    console.error('Error cargando usuarios:', error);
    showNotification('Error al cargar la lista de usuarios', 'error');
  } finally {
    hideLoading();
  }
}

function renderUsersTablePage() {
  const tableBody = document.getElementById('usersTableBody');
  if (!tableBody) return;

  const pagination = document.getElementById('usersPagination');
  tableBody.innerHTML = '';

  // Filter Data
  const filteredData = currentUsersData.filter(u => {
    if (!usersSearchQuery) return true;
    const combinada = `${u.id} ${u.nombres || ''} ${u.apellidos || ''}`.toLowerCase();
    return combinada.includes(usersSearchQuery);
  });

  if (filteredData.length === 0) {
    tableBody.innerHTML = '<tr><td colspan="8" style="text-align:center;">No se encontraron usuarios.</td></tr>';
    if (pagination) pagination.style.display = 'none';
    return;
  }

  const totalPages = Math.ceil(filteredData.length / USERS_ITEMS_PER_PAGE);
  const startIndex = (usersCurrentPage - 1) * USERS_ITEMS_PER_PAGE;
  const endIndex = startIndex + USERS_ITEMS_PER_PAGE;
  const displayData = filteredData.slice(startIndex, endIndex);

  displayData.forEach(u => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${u.id}</td>
      <td>${u.nombres || '-'}</td>
      <td>${u.apellidos || '-'}</td>
      <td>${u.cliente || '-'}</td>
      <td>${u.unidad || '-'}</td>
      <td>${u.puesto || '-'}</td>
      <td><span class="status-badge ${u.tipo}">${u.tipo || 'cliente'}</span></td>
      <td class="actions-cell">
        <button class="btn-icon-only edit-user" data-id="${u.id}" title="Editar">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
          </svg>
        </button>
        <button class="btn-icon-only delete delete-user" data-id="${u.id}" title="Eliminar">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          </svg>
        </button>
      </td>
    `;
    tableBody.appendChild(tr);
  });

  // Attach actions
  document.querySelectorAll('.edit-user').forEach(btn => {
    btn.addEventListener('click', () => abrirModalUsuario(btn.dataset.id));
  });
  document.querySelectorAll('.delete-user').forEach(btn => {
    btn.addEventListener('click', () => confirmarEliminarUsuario(btn.dataset.id));
  });

  // Pagination UI
  if (pagination) {
    if (totalPages > 1) {
      pagination.style.display = 'flex';
      document.getElementById('userPageIndicator').textContent = `Página ${usersCurrentPage} de ${totalPages}`;
      document.getElementById('btnPrevUserPage').disabled = usersCurrentPage === 1;
      document.getElementById('btnNextUserPage').disabled = usersCurrentPage === totalPages;

      if (!usersPaginationListenersAttached) {
        document.getElementById('btnPrevUserPage').addEventListener('click', () => {
          if (usersCurrentPage > 1) {
            usersCurrentPage--;
            renderUsersTablePage();
          }
        });
        document.getElementById('btnNextUserPage').addEventListener('click', () => {
          if (usersCurrentPage < Math.ceil(filteredData.length / USERS_ITEMS_PER_PAGE)) {
            usersCurrentPage++;
            renderUsersTablePage();
          }
        });
        usersPaginationListenersAttached = true;
      }
    } else {
      pagination.style.display = 'none';
    }
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
    document.getElementById('userPass').removeAttribute('required');
    try {
      const docSnap = await getDoc(doc(db, 'usuarios', userId));
      if (docSnap.exists()) {
        const u = docSnap.data();
        document.getElementById('userDni').value = userId;
        document.getElementById('userDni').readOnly = true;
        document.getElementById('userNames').value = u.nombres || '';
        document.getElementById('userLastNames').value = u.apellidos || '';
        document.getElementById('userPuesto').value = u.puesto || '';
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
    document.getElementById('userPass').setAttribute('required', 'true');
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
    window.mostrarAviso('ERROR', 'Las contraseñas no coinciden', 'error');
    return;
  }

  const userData = {
    nombres: document.getElementById('userNames').value.toUpperCase(),
    apellidos: document.getElementById('userLastNames').value.toUpperCase(),
    puesto: document.getElementById('userPuesto').value.toUpperCase(),
    cliente: document.getElementById('userClient').value.toUpperCase(),
    unidad: document.getElementById('userUnit').value.toUpperCase(),
    tipo: document.getElementById('userRole').value
  };

  showLoading();

  try {
    // 1. Gestionar en Firebase Auth a través de la Cloud Function
    const actionAuth = document.getElementById('userDni').readOnly ? 'update' : 'create';

    // Si es nuevo o hay contraseña se envia a Auth
    if (actionAuth === 'create' || pass !== '') {
      const gestionarAuth = httpsCallable(functions, 'gestionarUsuarioAuth');
      await gestionarAuth({
        action: actionAuth,
        dni: dni,
        password: pass
      });
    }

    // 2. Guardar en Firestore (Document ID = DNI)
    await updateDoc(doc(db, 'usuarios', dni), userData).catch(async (err) => {
      // Si no existe (error al actualizar), intentamos setDoc enviando el objeto completo
      const { setDoc } = await import('firebase/firestore');
      return setDoc(doc(db, 'usuarios', dni), userData);
    });

    window.mostrarAviso('ÉXITO', actionAuth === 'create' ? 'Usuario creado correctamente' : 'Usuario actualizado correctamente', 'success');

    cerrarModalUsuario();
    cargarUsuariosTable();

  } catch (error) {
    console.error('Error al guardar usuario:', error);
    const errorMsg = error.message || 'Error al procesar la solicitud';
    window.mostrarAviso('ERROR', errorMsg, 'error');
  } finally {
    hideLoading();
  }
}

async function confirmarEliminarUsuario(userId) {
  const isConfirmed = await window.mostrarConfirmacion(
    'CONFIRMAR ELIMINACIÓN',
    `¿Estás seguro de eliminar el usuario con DNI ${userId}?`
  );

  if (isConfirmed) {
    showLoading();
    const { deleteDoc } = await import('firebase/firestore');

    try {
      // Eliminar de Auth
      const gestionarAuth = httpsCallable(functions, 'gestionarUsuarioAuth');
      await gestionarAuth({
        action: 'delete',
        dni: userId
      });

      // Eliminar de Firestore
      await deleteDoc(doc(db, 'usuarios', userId));

      showNotification('Usuario eliminado', 'success');
      cargarUsuariosTable();
    } catch (error) {
      console.error('Error eliminando:', error);
      window.mostrarAviso('ERROR', 'Error al eliminar usuario', 'error');
    } finally {
      hideLoading();
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
            ${unidades.map(u => `
              <span class="badge-with-delete" style="background: rgba(0, 217, 255, 0.1); border: 1px solid rgba(0, 217, 255, 0.2); padding: 4px 10px; border-radius: 6px; font-size: 0.8rem;">
                ${u}
                <button class="badge-delete-btn" onclick="eliminarUnidadCliente('${clienteId}', '${u}')" title="Eliminar Unidad">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M18 6L6 18M6 6l12 12"></path>
                  </svg>
                </button>
              </span>
            `).join('')}
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
  const isConfirmed = await window.mostrarConfirmacion(
    'CONFIRMAR ELIMINACIÓN',
    `¿Estás seguro de eliminar al cliente ${clienteId} y todas sus unidades?`
  );

  if (isConfirmed) {
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

window.eliminarUnidadCliente = async function (clienteId, unidadAElminar) {
  const isConfirmed = await window.mostrarConfirmacion(
    'ELIMINAR UNIDAD',
    `¿Está seguro de eliminar la unidad "${unidadAElminar}" del cliente ${clienteId}?`
  );

  if (isConfirmed) {
    showLoading();
    try {
      const { getDoc, setDoc, doc } = await import('firebase/firestore');
      const docRef = doc(db, 'clientes', clienteId);
      const snap = await getDoc(docRef);
      if (snap.exists()) {
        const data = snap.data();
        const units = Object.entries(data)
          .filter(([k, v]) => !isNaN(k) && typeof v === 'string')
          .map(([k, v]) => v)
          .filter(u => u !== unidadAElminar);

        const newData = {};
        units.forEach((u, i) => { newData[String(i + 1)] = u; });

        await setDoc(docRef, newData);
        showNotification(`Unidad ${unidadAElminar} eliminada`, 'success');
        cargarClientesTable();
      }
    } catch (e) {
      console.error(e);
      window.mostrarAviso('ERROR', 'No se pudo eliminar la unidad', 'error');
    } finally {
      hideLoading();
    }
  }
};

let editingClientId = null;

window.abrirModalCliente = async function (clienteId = null) {
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

  showLoading();
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
  } finally {
    hideLoading();
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

  showLoading();
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
  } finally {
    hideLoading();
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
