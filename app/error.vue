<script setup lang="ts">
import type { NuxtError } from '#app'
import { en_gb } from '@nuxt/ui/locale'

defineProps<{ error: NuxtError }>()
</script>

<template>
  <UApp :locale="en_gb">
    <UError :error="error" :clear="{ label: 'Back to dashboard', to: '/' }" />
  </UApp>
</template>
