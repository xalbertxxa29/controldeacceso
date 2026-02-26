import './style.css';
import { auth, db } from './firebase.js';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';

// Elementos del DOM
const loginForm = document.getElementById('loginForm');
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const btnLogin = document.getElementById('btnLogin');
const errorMessage = document.getElementById('errorMessage');
const loadingOverlay = document.getElementById('loadingOverlay');

// Simular carga inicial
window.addEventListener('load', () => {
    if (loadingOverlay) {
        loadingOverlay.classList.add('active');
        setTimeout(() => loadingOverlay.classList.remove('active'), 1000);
    }
});

// Verificar si ya hay sesión activa
auth.onAuthStateChanged((user) => {
    if (user) {
        // Usuario ya autenticado, redirigir al menú
        window.location.href = 'menu.html';
    }
});

// Manejar el envío del formulario
loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    localStorage.clear(); // Prevenir contaminación de sesión cruzada

    let email = emailInput.value.trim();
    const password = passwordInput.value;
    let userId = email; // Por defecto es lo ingresado

    // Auto-completar dominio si es necesario (asumimos DNI)
    if (!email.includes('@')) {
        userId = email; // Guardamos el ID original (DNI)
        email += '@liderman.com.pe';
    } else {
        userId = email.split('@')[0];
    }

    // Validar campos
    if (!userId || !password) {
        showError('Por favor, complete todos los campos');
        return;
    }

    // Deshabilitar botón durante el proceso
    btnLogin.disabled = true;
    btnLogin.querySelector('.btn-text').textContent = 'INICIANDO...';
    if (loadingOverlay) {
        loadingOverlay.classList.add('active');
        loadingOverlay.querySelector('.loader-text').textContent = 'AUTENTICANDO...';
    }

    try {
        // Intentar iniciar sesión en Firebase
        const userCredential = await signInWithEmailAndPassword(auth, email, password);

        // Consultar datos extendidos del usuario en Firestore (Colección 'usuarios')
        const userDocRef = doc(db, 'usuarios', userId);
        const userDoc = await getDoc(userDocRef);

        if (userDoc.exists()) {
            const userData = userDoc.data();

            // === VALIDACIÓN DE ROL: TIPO CLIENTE O ADMIN ===
            if (userData.tipo !== 'cliente' && userData.tipo !== 'admin') {
                await auth.signOut();
                throw new Error('Acceso denegado: Tu perfil no tiene permisos autorizados.');
            }

            // Guardar información completa en LocalStorage
            if (loadingOverlay) loadingOverlay.querySelector('.loader-text').textContent = 'ACCESO CONCEDIDO';

            localStorage.setItem('userEmail', email);
            localStorage.setItem('userId', userId);
            localStorage.setItem('userName', userData.nombres || '');
            localStorage.setItem('userLastName', userData.apellidos || '');
            localStorage.setItem('userClient', userData.cliente || '');
            localStorage.setItem('userUnit', userData.unidad || '');
            localStorage.setItem('userType', userData.tipo || '');

            // Redirigir al menú
            window.location.href = './menu.html';
        } else {
            // Usuario en Auth pero no en DB -> Error de integridad
            await auth.signOut(); // Cerrar sesión fantasma
            throw new Error('Usuario no registrado en la base de datos de personal.');
        }

    } catch (error) {
        console.error('Error de autenticación:', error);

        let errorMsg = 'Error al iniciar sesión';

        switch (error.code) {
            case 'auth/invalid-email':
                errorMsg = 'Correo electrónico inválido';
                break;
            case 'auth/user-disabled':
                errorMsg = 'Usuario deshabilitado';
                break;
            case 'auth/user-not-found':
                errorMsg = 'Usuario no encontrado';
                break;
            case 'auth/wrong-password':
                errorMsg = 'Contraseña incorrecta';
                break;
            case 'auth/invalid-credential':
                errorMsg = 'Credenciales inválidas';
                break;
            case 'auth/too-many-requests':
                errorMsg = 'Demasiados intentos. Intente más tarde';
                break;
            default:
                errorMsg = 'Error de conexión. Verifique su internet';
        }

        showError(errorMsg);

    } finally {
        // Rehabilitar botón
        if (loadingOverlay) loadingOverlay.classList.remove('active');
        btnLogin.disabled = false;
        btnLogin.querySelector('.btn-text').textContent = 'INICIAR SESIÓN';
    }
});

// Función para mostrar errores
function showError(message) {
    errorMessage.textContent = message;
    errorMessage.classList.add('show');

    setTimeout(() => {
        errorMessage.classList.remove('show');
    }, 5000);
}

// Animación de partículas en el fondo
function createFloatingParticles() {
    const container = document.querySelector('.floating-particles');
    const particleCount = 20;

    for (let i = 0; i < particleCount; i++) {
        const particle = document.createElement('div');
        particle.className = 'particle';
        particle.style.cssText = `
      position: absolute;
      width: ${Math.random() * 4 + 1}px;
      height: ${Math.random() * 4 + 1}px;
      background: ${Math.random() > 0.5 ? '#00d9ff' : '#ff3366'};
      border-radius: 50%;
      left: ${Math.random() * 100}%;
      top: ${Math.random() * 100}%;
      opacity: ${Math.random() * 0.5 + 0.2};
      animation: particleFloat ${Math.random() * 10 + 10}s linear infinite;
      animation-delay: ${Math.random() * 5}s;
      box-shadow: 0 0 10px currentColor;
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
      opacity: 0.5;
    }
    90% {
      opacity: 0.5;
    }
    100% {
      transform: translate(${Math.random() * 200 - 100}px, ${Math.random() * 200 - 100}px) rotate(360deg);
      opacity: 0;
    }
  }
`;
document.head.appendChild(style);

// Inicializar partículas
createFloatingParticles();
