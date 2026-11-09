import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

function requireSyncHost(): Plugin {
  return {
    name: 'require-sync-host',
    configResolved(config) {
      if (config.command === 'build' && !config.env.VITE_SYNC_HOST) {
        throw new Error(
          'VITE_SYNC_HOST is not set. A production build needs the realtime Worker host (the custom domain in party/wrangler.jsonc).',
        );
      }
    },
  };
}

function yProviderPagehide(): Plugin {
  const UNLOAD = /window\.(add|remove)EventListener\("unload", this\._unloadHandler\)/g;
  let patched = 0;
  return {
    name: 'y-partyserver-pagehide',
    apply: 'build',
    buildStart() {
      patched = 0;
    },
    transform(code, id) {
      if (!/[\\/]y-partyserver[\\/]dist[\\/]provider[\\/]index\.js$/.test(id) || !code.includes('_unloadHandler')) return null;
      const next = code.replace(UNLOAD, (_, verb: string) => {
        patched += 1;
        return `window.${verb}EventListener("pagehide", this._unloadHandler)`;
      });
      if (next.includes('"unload"')) throw new Error(`y-partyserver still registers an unload listener in ${id}`);
      return { code: next, map: null };
    },
    buildEnd() {
      if (patched !== 2) {
        throw new Error(
          `y-partyserver pagehide patch applied ${patched} times instead of 2; the library changed, review the plugin.`,
        );
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), requireSyncHost(), yProviderPagehide()],
  server: { host: '0.0.0.0', port: 5173 },
  build: { outDir: 'dist', sourcemap: true },
});
