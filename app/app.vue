<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui'
import { en_gb } from '@nuxt/ui/locale'

const route = useRoute()

const items = computed<NavigationMenuItem[]>(() => [
  { label: 'Dashboard', icon: 'i-lucide-chart-line', to: '/', active: route.path === '/' },
  { label: 'Assets', icon: 'i-lucide-wallet', to: '/assets', active: route.path.startsWith('/assets') },
  { label: 'Budget', icon: 'i-lucide-piggy-bank', to: '/budget', active: route.path.startsWith('/budget') },
  { label: 'Calculator', icon: 'i-lucide-calculator', to: '/calculator', active: route.path.startsWith('/calculator') },
])
</script>

<template>
  <UApp :locale="en_gb">
    <UHeader title="Finance" to="/">
      <UNavigationMenu :items="items" />

      <template #right>
        <UColorModeButton />
      </template>

      <template #body>
        <UNavigationMenu :items="items" orientation="vertical" class="-mx-2.5" />
      </template>
    </UHeader>

    <UMain>
      <UContainer>
        <NuxtPage />
      </UContainer>
    </UMain>
  </UApp>
</template>
