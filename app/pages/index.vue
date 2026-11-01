<script setup lang="ts">
import type { TabsItem } from '@nuxt/ui'
import type { DashboardDTO } from '#shared/types/api'
import type { RangePreset } from '#shared/utils/finance'
import type { ChartRow, ChartSeries } from '~/components/HistoryChart.vue'
import type { IsoRange } from '~/components/DateRangeInput.vue'

useHead({ title: 'Dashboard · Finance' })

const mode = ref<'total' | 'assets'>('total')
const selection = ref<{ preset: RangePreset } | { custom: IsoRange }>({ preset: '1Y' })

const query = computed(() => ('preset' in selection.value
  ? { range: selection.value.preset }
  : { from: selection.value.custom.from, to: selection.value.custom.to }))

const { data, error, status } = await useFetch<DashboardDTO>('/api/dashboard', { query })

// Keep the last good response so a failed request never blanks the chart.
const view = shallowRef<DashboardDTO | null>(data.value ?? null)
watch(data, (d) => {
  if (d) view.value = d
})

const periodItems = computed<TabsItem[]>(() => {
  const items: TabsItem[] = [
    { label: '1M', value: '1M' },
    { label: '3M', value: '3M' },
    { label: '6M', value: '6M' },
    { label: '1Y', value: '1Y' },
    { label: 'All', value: 'ALL' },
  ]
  if ('custom' in selection.value) items.push({ label: 'Custom', value: 'CUSTOM' })
  return items
})

const period = computed({
  get: () => ('preset' in selection.value ? selection.value.preset : 'CUSTOM'),
  set: (v: string) => {
    if (v !== 'CUSTOM') selection.value = { preset: v as RangePreset }
  },
})

const modeItems: TabsItem[] = [
  { label: 'Total', value: 'total' },
  { label: 'By asset', value: 'assets' },
]

// Presets show the dates the server resolved; custom ranges show exactly what was chosen.
const displayedRange = computed<IsoRange | null>(() => {
  if ('custom' in selection.value) return selection.value.custom
  return view.value ? { from: view.value.range.from, to: view.value.range.to } : null
})

function onRange(r: IsoRange) {
  selection.value = { custom: r }
}

const assetName = (id: string) => view.value?.assets.find(a => a.id === id)?.name ?? id

const chartSeries = computed<ChartSeries[]>(() => {
  if (!view.value) return []
  if (mode.value === 'total') return [{ key: 'total', name: 'Total', color: 'var(--ui-primary)' }]
  return view.value.series.map(s => ({ key: s.id, name: s.name, color: s.color }))
})

const chartRows = computed<ChartRow[]>(() => (view.value?.history ?? []).map((h) => {
  const notes: string[] = []
  if (h.participating > h.known) notes.push(`${h.participating - h.known} of ${h.participating} assets unknown`)
  if (h.stale > 0) notes.push(`${h.stale} stale (> 30 days old)`)
  return {
    date: h.date,
    values: mode.value === 'total' ? { total: h.total } : h.values,
    notes,
  }
}))

const hasAssets = computed(() => (view.value?.assets.length ?? 0) > 0)
const hasHistory = computed(() => view.value?.history.some(h => h.known > 0) ?? false)

const warnings = computed(() => {
  const v = view.value
  if (!v) return []
  const list: { title: string, description: string, color: 'warning' | 'info', icon: string }[] = []
  if (v.current.unknownAssetIds.length) {
    list.push({
      title: 'Unknown values',
      description: `No known EUR value yet for ${v.current.unknownAssetIds.map(assetName).join(', ')} (no valuation, or no BTC-EUR rate yet). The total only includes assets with a known value.`,
      color: 'warning',
      icon: 'i-lucide-circle-help',
    })
  }
  if (v.current.staleAssetIds.length) {
    list.push({
      title: 'Stale valuations',
      description: `Last valuation is more than 30 days old for ${v.current.staleAssetIds.map(assetName).join(', ')}. They are still counted in the total.`,
      color: 'warning',
      icon: 'i-lucide-clock-alert',
    })
  }
  if (v.excluded.length) {
    list.push({
      title: 'Excluded currencies',
      description: `Only EUR and BTC assets are aggregated. Not included: ${v.excluded.map(e => `${e.name} (${e.currency})`).join(', ')}.`,
      color: 'info',
      icon: 'i-lucide-info',
    })
  }
  if (v.completeness.incompleteDays > 0 && hasHistory.value) {
    list.push({
      title: 'Incomplete history',
      description: `${v.completeness.incompleteDays} of ${v.completeness.days} days in this range lack a value for at least one asset; totals on those days are partial.`,
      color: 'info',
      icon: 'i-lucide-chart-no-axes-column',
    })
  }
  return list
})

const description = computed(() => {
  const v = view.value
  if (!v) return 'Net worth across your EUR and BTC assets'
  const total = v.current.total === null ? 'unknown' : formatMoney(v.current.total)
  return `Current EUR total ${total} · as of ${formatDate(v.today)}${v.current.complete ? '' : ' (partial)'}`
})
</script>

<template>
  <UPage>
    <UPageHeader title="Dashboard" :description="description" />

    <UPageBody>
      <UAlert
        v-if="error"
        color="error"
        variant="subtle"
        icon="i-lucide-triangle-alert"
        title="Could not update the dashboard"
        :description="apiErrorMessage(error)"
      />

      <UEmpty
        v-if="view && !hasAssets"
        icon="i-lucide-wallet"
        title="No assets yet"
        description="Add your first asset and record a valuation to start tracking your net worth."
        :actions="[{ label: 'Add an asset', icon: 'i-lucide-plus', to: '/assets?new=1' }]"
      />

      <template v-else-if="view">
        <UAlert
          v-for="w in warnings"
          :key="w.title"
          :color="w.color"
          variant="subtle"
          :icon="w.icon"
          :title="w.title"
          :description="w.description"
        />

        <UCard>
          <template #header>
            <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <UTabs v-model="mode" :items="modeItems" :content="false" size="xs" />
              <div class="flex flex-col gap-3 sm:flex-row sm:items-center">
                <UTabs v-model="period" :items="periodItems" :content="false" size="xs" />
                <DateRangeInput :model-value="displayedRange" :max="view.today" @update:model-value="onRange" />
              </div>
            </div>
          </template>

          <HistoryChart
            v-if="hasHistory"
            :rows="chartRows"
            :series="chartSeries"
            :legend="mode === 'assets'"
            :label="mode === 'total' ? 'Total EUR value over time' : 'EUR value per asset over time'"
            :class="status === 'pending' ? 'opacity-60' : undefined"
          />
          <UEmpty
            v-else
            icon="i-lucide-chart-line"
            title="No data in this range"
            description="There are no known valuations for this period."
            variant="naked"
          />
        </UCard>

        <AllocationCard :dashboard="view" />
      </template>
    </UPageBody>
  </UPage>
</template>
