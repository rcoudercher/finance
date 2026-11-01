<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { AssetDetailDTO, DashboardDTO } from '#shared/types/api'
import { diffDays, parisDate } from '#shared/utils/dates'
import { STALE_AFTER_DAYS } from '#shared/utils/finance'
import { CONVERTED_CURRENCIES } from '#shared/utils/money'

useHead({ title: 'Assets · Finance' })

const route = useRoute()
const router = useRouter()
const { data: assets, refresh, error } = await useFetch<AssetDetailDTO[]>('/api/assets', { default: () => [] })
// Same data as the dashboard's allocation donut.
const { data: dashboard, refresh: refreshDashboard } = await useFetch<DashboardDTO>('/api/dashboard', { query: { range: '1M' }, lazy: true })

const createOpen = ref(route.query.new === '1')
watch(createOpen, (v) => {
  if (!v && route.query.new) router.replace({ query: {} })
})

const today = parisDate()
const isStale = (date: string | undefined) => !!date && diffDays(today, date) > STALE_AFTER_DAYS

const UBadge = resolveComponent('UBadge')
const ULink = resolveComponent('ULink')

const anyPerformance = computed(() => assets.value.some(a => a.performance))

const gainsColumn: TableColumn<AssetDetailDTO> = {
  id: 'gains',
  header: () => h('div', { class: 'text-right' }, 'Gains'),
  cell: ({ row }) => {
    const p = row.original.performance
    if (!p) return h('div', { class: 'text-right text-muted' }, '—')
    return h('div', { class: 'text-right tabular-nums' }, [
      h('div', { class: p.gain.startsWith('-') ? 'text-error' : 'text-success' }, formatMoneySigned(p.gain)),
      h('div', { class: 'text-xs text-muted' }, p.annualReturn !== null ? `${formatPercent(p.annualReturn)} / yr` : formatPercent(p.gainRatio)),
    ])
  },
}

const baseColumns: TableColumn<AssetDetailDTO>[] = [
  {
    accessorKey: 'name',
    header: 'Name',
    cell: ({ row }) => h('div', { class: 'flex items-center gap-2' }, [
      h('span', { class: 'size-2.5 shrink-0 rounded-full', style: { backgroundColor: row.original.displayColor } }),
      h(ULink, { to: `/assets/${row.original.id}`, class: 'font-medium text-highlighted' }, () => row.original.name),
    ]),
  },
  { accessorKey: 'category', header: 'Category', cell: ({ row }) => categoryLabel(row.original.category) },
  { accessorKey: 'currency', header: 'Currency' },
  {
    id: 'latest',
    header: () => h('div', { class: 'text-right' }, 'Latest value'),
    cell: ({ row }) => {
      const native = formatMoney(row.original.latestValuation?.value, row.original.currency)
      const eur = row.original.latestEurValue
      if (!eur) return h('div', { class: 'text-right tabular-nums' }, native)
      return h('div', { class: 'text-right tabular-nums' }, [
        h('div', native),
        h('div', { class: 'text-xs text-muted' }, `≈ ${formatMoney(eur.value)}`),
      ])
    },
  },
  {
    id: 'date',
    header: 'Valued on',
    cell: ({ row }) => {
      const date = row.original.latestValuation?.date
      if (!date) return h(UBadge, { color: 'warning', variant: 'subtle', label: 'No valuation' })
      return h('div', { class: 'flex items-center gap-2' }, [
        formatDate(date),
        // BTC quantities don't go stale; only their BTC-EUR rate can.
        (CONVERTED_CURRENCIES.includes(row.original.currency) ? !!row.original.latestEurValue?.rateStale : isStale(date))
          ? h(UBadge, { color: 'warning', variant: 'subtle', label: 'Stale' })
          : null,
      ])
    },
  },
  { accessorKey: 'valuationCount', header: () => h('div', { class: 'text-right' }, 'Valuations'), cell: ({ row }) => h('div', { class: 'text-right tabular-nums' }, row.original.valuationCount) },
]

// The Gains column only appears once an asset records what was paid in; it goes right after "Latest value".
const columns = computed(() => {
  if (!anyPerformance.value) return baseColumns
  const i = baseColumns.findIndex(c => c.id === 'latest')
  return [...baseColumns.slice(0, i + 1), gainsColumn, ...baseColumns.slice(i + 1)]
})

async function onCreated(asset: { id: string }) {
  await Promise.all([refresh(), refreshDashboard()])
  await navigateTo(`/assets/${asset.id}`)
}
</script>

<template>
  <UPage>
    <UPageHeader title="Assets" description="Accounts, investments and holdings you track.">
      <template #links>
        <UButton label="New asset" icon="i-lucide-plus" @click="createOpen = true" />
      </template>
    </UPageHeader>

    <UPageBody>
      <UAlert v-if="error" color="error" variant="subtle" icon="i-lucide-triangle-alert" title="Could not load assets" :description="apiErrorMessage(error)" />

      <UEmpty
        v-else-if="!assets.length"
        icon="i-lucide-wallet"
        title="No assets yet"
        description="Create an asset, then record its balance over time."
        :actions="[{ label: 'New asset', icon: 'i-lucide-plus', onClick: () => { createOpen = true } }]"
      />

      <template v-else>
        <UCard :ui="{ body: 'p-0 sm:p-0' }">
          <UTable :data="assets" :columns="columns" />
        </UCard>

        <AllocationCard v-if="dashboard" :dashboard="dashboard" />
      </template>
    </UPageBody>

    <AssetFormModal v-model:open="createOpen" @saved="onCreated" />
  </UPage>
</template>
