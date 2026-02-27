import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

const repoBase = '/greentic-webchat/';

// https://vitejs.dev/config/
export default defineConfig(({ command }) => {
  const isDev = command === 'serve';
  return {
    base: isDev ? '/' : repoBase,
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    build: {
      sourcemap: !isDev
    },
    server: {
      port: 5173,
      open: false,
      proxy: {
        '/token': {
          target: 'http://localhost:8080',
          changeOrigin: true
        },
        '/v3/directline': {
          target: 'http://localhost:8080',
          changeOrigin: true
        }
      }
    }
  };
});
