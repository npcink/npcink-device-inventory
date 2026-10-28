import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
//配置路径
import path from "node:path";
import { fileURLToPath } from "node:url";
const projectDir = fileURLToPath(new URL(".", import.meta.url));
// https://vitejs.dev/config/

const site = "/wp-content/plugins/npcink-device-inventory/";

export default defineConfig(({ mode }) => {
  const isProd = mode === "production";
  const devProxyTarget = process.env.WP_DEV_PROXY_TARGET;

  return {
    plugins: [react()],
    build: {
      manifest: true,
      rollupOptions: {
        output: {
          // 指定 chunk 文件名（含导出的代码）
          //chunkFileNames: 'js/[name].js',
          // 指定静态资源文件名（不含导出的代码）
          //assetFileNames: 'assets/[name].[ext]',
          entryFileNames: "index.js",
          assetFileNames: "[name][extname]",
          chunkFileNames: "[name]-[hash].js",
        },
      },
      // Lazy-load business workspaces; keep Ant Design splitting automatic to avoid vendor cycles.
      chunkSizeWarningLimit: 1300,
      //sourcemap: true,//保留映射关系，方便调试
    },
    //配置路径别名
    resolve: {
      alias: [
        ...(isProd
          ? [
              {
                find: "@/utils/demoConfig",
                replacement: path.resolve(
                  projectDir,
                  "src/utils/demoConfig.prod.ts"
                ),
              },
            ]
          : []),
        { find: "@", replacement: path.resolve(projectDir, "src") },
      ],
    },

    //媒体资源打包前缀，避免图片无法正常显示
    base: site + "vite-admin/dist/",

    //代理
    server: {
      //host: "0.0.0.0",
      //port: 3000,
      //open: true,
      ...(devProxyTarget
        ? {
            proxy: {
              "/wp-json": {
                target: devProxyTarget,
                changeOrigin: true,
              },
              "/api": {
                target: devProxyTarget,
                changeOrigin: true,
                rewrite: (path) => path.replace(/^\/api/, ""),
              },
            },
          }
        : {}),
    },
  };
});
