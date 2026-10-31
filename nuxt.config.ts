// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2026-10-31',
  modules: ['@nuxt/ui'],
  css: ['~/assets/css/main.css'],
  devtools: { enabled: false },
  telemetry: false,
  ssr: true,
  app: {
    head: {
      title: 'Finance',
      htmlAttrs: { lang: 'en-GB' },
      meta: [{ name: 'robots', content: 'noindex, nofollow' }],
    },
  },
  ui: {
    fonts: false,
  },
  icon: {
    serverBundle: { collections: ['lucide'] },
    clientBundle: { scan: true },
    provider: 'none',
    fallbackToApi: false,
  },
  typescript: {
    strict: true,
    typeCheck: false,
  },
  nitro: {
    preset: 'node-server',
    externals: { external: ['better-sqlite3'] },
  },
})
