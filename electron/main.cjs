const { app, BrowserWindow } = require('electron');
const path = require('path');
const url = require('url');

// Mantener la referencia global para evitar que GC cierre la ventana
let win;

function createWindow() {
    win = new BrowserWindow({
        width: 1200,
        height: 800,
        backgroundColor: '#050a14', // Color de fondo futuristic
        webPreferences: {
            nodeIntegration: false, // Seguridad
            contextIsolation: true
        },
        // Icono (si existe en public/icon.ico, electron builder lo empaqueta)
        // icon: path.join(__dirname, '../public/favicon.ico') 
    });

    // Cargar index.html (desde dist tras build)
    const startUrl = url.format({
        pathname: path.join(__dirname, '../dist/index.html'),
        protocol: 'file:',
        slashes: true
    });

    win.loadURL(startUrl);

    // Pantalla completa por defecto
    win.maximize();

    // Eliminar la barra de menú para look de aplicación Kiosco
    win.setMenu(null);

    // Abrir DevTools en desarrollo (opcional)
    // win.webContents.openDevTools();

    win.on('closed', () => {
        win = null;
    });
}

app.on('ready', createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (win === null) {
        createWindow();
    }
});
