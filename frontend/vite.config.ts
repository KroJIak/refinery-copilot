import path from 'node:path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

function backendOrigin(url: string): string {
  return url.replace(/\/api\/?$/, '');
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const target = backendOrigin(
    process.env.VITE_PROXY_TARGET || env.VITE_PROXY_TARGET || env.BACKEND_URL || 'http://localhost:8000',
  );

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: { '@': path.resolve(__dirname, 'src') },
    },
    server: {
      host: '127.0.0.1',
      port: 5173,
      strictPort: true,
      proxy: {
        '/api': {
          target,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, '') || '/',
          proxyTimeout: 0,
        },
      },
    },
  };
});
