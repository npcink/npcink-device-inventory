import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { createRequire } from "node:module";
//配置路径
import path from "node:path";
import { fileURLToPath } from "node:url";
const projectDir = fileURLToPath(new URL(".", import.meta.url));
// https://vitejs.dev/config/

const site = "/wp-content/plugins/npcink-device-inventory/";

// WordPress owns the production React instance. Keep Vite's standalone dev runtime.
function wordpressReact(): Plugin {
  const require = createRequire(import.meta.url);
  const modules = new Map([
    ["react", ["window.React", Object.keys(require("react"))]],
    ["react-dom", ["window.ReactDOM", Object.keys(require("react-dom"))]],
    ["react-dom/client", ["window.wp.element", ["createRoot", "hydrateRoot"]]],
  ] as const);
  const prefix = "\0wordpress-react:";
  return {
    name: "wordpress-react",
    enforce: "pre",
    apply: "build",
    resolveId(source) {
      if (modules.has(source)) return prefix + source;
    },
    load(id) {
      if (!id.startsWith(prefix)) return;
      const [global, names] = modules.get(id.slice(prefix.length))!;
      return `const runtime = ${global};\nexport default runtime;\n` + names
        .filter((name) => !name.startsWith("__"))
        .map((name) => `export const ${name} = runtime.${name};`)
        .join("\n");
    },
    generateBundle(_options, bundle) {
      const entry = Object.values(bundle).find((chunk) => chunk.type === "chunk" && chunk.isEntry);
      if (!entry) this.error("Missing WordPress admin application entry");
      // WP versions index.js with a query parameter. Lazy chunks must resolve
      // the same unversioned, content-hashed module as this loader.
      this.emitFile({ type: "asset", fileName: "index.js", source: `import ${JSON.stringify(`./${entry.fileName}`)};\n` });
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== "chunk") continue;
        for (const id of Object.keys(chunk.modules)) {
          if (/[/\\]node_modules[/\\](react|react-dom)[/\\]/.test(id)) {
            this.error(`Production must use WordPress React, found bundled module: ${id}`);
          }
        }
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  const isProd = mode === "production";
  const devProxyTarget = process.env.WP_DEV_PROXY_TARGET;

  return {
    plugins: [react(isProd ? { jsxRuntime: "classic" } : {}), ...(isProd ? [wordpressReact()] : [])],
    ...(isProd ? { oxc: { jsx: { pragma: "window.React.createElement", pragmaFrag: "window.React.Fragment" } } } : {}),
    build: {
      manifest: true,
      rollupOptions: {
        output: {
          // 指定 chunk 文件名（含导出的代码）
          //chunkFileNames: 'js/[name].js',
          // 指定静态资源文件名（不含导出的代码）
          //assetFileNames: 'assets/[name].[ext]',
          entryFileNames: isProd ? "admin-[hash].js" : "index.js",
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
