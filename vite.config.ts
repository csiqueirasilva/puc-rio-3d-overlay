import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteStaticCopy } from 'vite-plugin-static-copy';

const cesiumSource = 'node_modules/cesium/Build/Cesium';

export default defineConfig({
  base: './',
  build: {
    chunkSizeWarningLimit: 5000,
  },
  plugins: [
    react(),
    viteStaticCopy({
      targets: [
        { src: path.join(cesiumSource, 'Workers'), dest: 'cesium' },
        { src: path.join(cesiumSource, 'ThirdParty'), dest: 'cesium' },
        { src: path.join(cesiumSource, 'Assets'), dest: 'cesium' },
        { src: path.join(cesiumSource, 'Widgets'), dest: 'cesium' },
      ],
    }),
  ],
  define: {
    CESIUM_BASE_URL: JSON.stringify('./cesium'),
  },
});
