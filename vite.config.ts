import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        ticket: resolve(__dirname, 'ticket.html'),
        door: resolve(__dirname, 'door.html'),
        admin: resolve(__dirname, 'admin.html'),
      },
    },
  },
});
