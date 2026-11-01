<script setup lang="ts">
import type { DashboardDTO } from '#shared/types/api'

// Donut of the current EUR value per asset, shared by the dashboard and the assets list.
const props = defineProps<{ dashboard: DashboardDTO }>()

const allocation = computed(() => props.dashboard.assets
  .filter(a => a.included && a.latestValue !== null && Number(a.latestValue) > 0)
  .map(a => ({ name: a.name, value: Number(a.latestValue), color: a.color })))

const nonPositive = computed(() => props.dashboard.assets
  .filter(a => a.included && a.latestValue !== null && Number(a.latestValue) <= 0))
</script>

<template>
  <UCard>
    <template #header>
      <h2 class="font-semibold text-highlighted">
        Allocation
      </h2>
      <p class="text-sm text-muted">
        Current EUR value of each asset (BTC converted)
      </p>
    </template>

    <UChart
      v-if="allocation.length"
      type="donut"
      :data="allocation"
      index="name"
      :categories="['value']"
      :colors="allocation.map(a => a.color)"
      :format="(v: number) => formatMoney(v)"
      :height="280"
      :thickness="28"
      legend
      aria-label="Allocation of current EUR value by asset"
    >
      <template #center>
        <span class="text-lg font-semibold text-highlighted tabular-nums">{{ formatMoney(dashboard.current.total) }}</span>
        <span class="text-xs text-muted">Total</span>
      </template>
    </UChart>
    <UEmpty v-else icon="i-lucide-chart-pie" title="Nothing to allocate yet" variant="naked" />

    <template v-if="nonPositive.length" #footer>
      <p class="text-sm text-muted">
        Not shown (zero or negative balance): {{ nonPositive.map(a => `${a.name} ${formatMoney(a.latestValue)}`).join(', ') }}
      </p>
    </template>
  </UCard>
</template>
