import { defineConfig } from 'vite'

export default defineConfig({
    base: './',
    server: {
        port: 5173,
        open: true,
        proxy: {
            '/api': {
                target: 'https://api.decolecta.com',
                changeOrigin: true,
                rewrite: (path) => path.replace(/^\/api/, '')
            }
        }
    },
    build: {
        outDir: 'dist',
        assetsDir: 'assets',
        sourcemap: false,
        rollupOptions: {
            input: {
                main: 'index.html',
                menu: 'menu.html'
            }
        }
    }
})
