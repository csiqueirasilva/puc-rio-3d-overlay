import { defineConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import path from 'node:path';

const cesiumSource = 'node_modules/cesium/Build/Cesium';

export default defineConfig({
  plugins: [
    viteStaticCopy({
      targets: [
        { src: path.join(cesiumSource, 'Workers'), dest: 'cesium' },
        { src: path.join(cesiumSource, 'ThirdParty'), dest: 'cesium' },
        { src: path.join(cesiumSource, 'Assets'), dest: 'cesium' },
        { src: path.join(cesiumSource, 'Widgets'), dest: 'cesium' }
      ]
    })
  ],
  define: {
    CESIUM_BASE_URL: JSON.stringify('/cesium')
  }
});
