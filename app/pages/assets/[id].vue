<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { AssetDetailDTO, ValuationDTO } from '#shared/types/api'
import type { IsoRange } from '~/components/DateRangeInput.vue'
import type { ChartRow } from '~/components/HistoryChart.vue'
import { diffDays, minDate, parisDate } from '#shared/utils/dates'
import { assetHistory, STALE_AFTER_DAYS } from '#shared/utils/finance'

const route = useRoute()
const id = computed(() => String(route.params.id))
const toast = useToast()
const today = parisDate()

const { data: asset, error: assetError, refresh: refreshAsset } = await useFetch<AssetDetailDTO>(() => `/api/assets/${id.value}`)
if (assetError.value?.statusCode === 404) {
  throw createError({ statusCode: 404, statusMessage: 'Asset not found', fatal: true })
}

useHead({ title: () => `${asset.value?.name ?? 'Asset'} · Finance` })

// Full history (for carry-forward in the chart) and the filtered list (for the table).
const { data: allValuations, refresh: refreshAll } = await useFetch<ValuationDTO[]>(() => `/api/assets/${id.value}/valuations`, { default: () => [] })

const filter = ref<IsoRange | null>(null)
const filterQuery = computed(() => (filter.value ? { from: filter.value.from, to: filter.value.to } : {}))
const { data: valuations, refresh: refreshFiltered, status } = await useFetch<ValuationDTO[]>(
  () => `/api/assets/${id.value}/valuations`,
  { query: filterQuery, default: () => [] },
)

async function refreshAllData() {
  await Promise.all([refreshAsset(), refreshAll(), refreshFiltered()])
}

const participatesFrom = computed(() => {
  const created = asset.value ? parisDate(new Date(asset.value.createdAt)) : today
  const earliest = allValuations.value.at(-1)?.date
  return earliest ? minDate(created, earliest) : created
})

const chartRange = computed<IsoRange>(() => filter.value ?? { from: participatesFrom.value, to: today })

const chartRows = computed<ChartRow[]>(() => assetHistory(allValuations.value, {
  ...chartRange.value,
  today,
  participatesFrom: participatesFrom.value,
}).map(p => ({
  date: p.date,
  values: { value: p.value },
  notes: p.stale && p.observedOn ? [`Last observed ${formatDate(p.observedOn)} (stale)`] : [],
})))

const hasChartData = computed(() => chartRows.value.some(r => r.values.value !== null))
const latest = computed(() => asset.value?.latestValuation ?? null)
const latestAge = computed(() => (latest.value ? diffDays(today, latest.value.date) : null))
const latestStale = computed(() => latestAge.value !== null && latestAge.value > STALE_AFTER_DAYS)

// Modals
const editOpen = ref(false)
const valuationOpen = ref(false)
const editingValuation = ref<ValuationDTO | null>(null)
const deleting = ref<ValuationDTO | null>(null)
const deleteOpen = computed({
  get: () => deleting.value !== null,
  set: (v: boolean) => {
    if (!v) deleting.value = null
  },
})
const deleteBusy = ref(false)

function addValuation() {
  editingValuation.value = null
  valuationOpen.value = true
}

function editValuation(v: ValuationDTO) {
  editingValuation.value = v
  valuationOpen.value = true
}

async function confirmDelete() {
  if (!deleting.value) return
  deleteBusy.value = true
  try {
    await $fetch(`/api/valuations/${deleting.value.id}`, { method: 'DELETE' })
    toast.add({ title: 'Valuation deleted', color: 'success', icon: 'i-lucide-check' })
    deleting.value = null
    await refreshAllData()
  }
  catch (e) {
    toast.add({ title: 'Could not delete valuation', description: apiErrorMessage(e), color: 'error', icon: 'i-lucide-triangle-alert' })
  }
  finally {
    deleteBusy.value = false
  }
}

const UButton = resolveComponent('UButton')
const UBadge = resolveComponent('UBadge')

const columns = computed<TableColumn<ValuationDTO>[]>(() => [
  { accessorKey: 'date', header: 'Date', cell: ({ row }) => formatDate(row.original.date) },
  {
    accessorKey: 'value',
    header: () => h('div', { class: 'text-right' }, 'Balance'),
    cell: ({ row }) => h('div', { class: 'text-right tabular-nums' }, formatMoney(row.original.value, asset.value?.currency)),
  },
  {
    accessorKey: 'source',
    header: 'Source',
    cell: ({ row }) => h(UBadge, { color: 'neutral', variant: 'subtle', label: SOURCE_OPTIONS.find(s => s.value === row.original.source)?.label }),
  },
  { accessorKey: 'updatedAt', header: 'Last edited', cell: ({ row }) => formatTimestamp(row.original.updatedAt) },
  {
    id: 'actions',
    header: () => h('span', { class: 'sr-only' }, 'Actions'),
    cell: ({ row }) => h('div', { class: 'flex justify-end gap-1' }, [
      h(UButton, { icon: 'i-lucide-pencil', color: 'neutral', variant: 'ghost', size: 'sm', 'aria-label': 'Correct valuation', onClick: () => editValuation(row.original) }),
      h(UButton, { icon: 'i-lucide-trash-2', color: 'error', variant: 'ghost', size: 'sm', 'aria-label': 'Delete valuation', onClick: () => { deleting.value = row.original } }),
    ]),
  },
])
</script>

<template>
  <UPage v-if="asset">
    <UPageHeader :title="asset.name" :description="asset.description ?? undefined" :headline="categoryLabel(asset.category)">
      <template #links>
        <UButton label="Edit" icon="i-lucide-pencil" color="neutral" variant="outline" @click="editOpen = true" />
        <UButton label="Add valuation" icon="i-lucide-plus" @click="addValuation" />
      </template>
    </UPageHeader>

    <UPageBody>
      <UAlert
        v-if="asset.currency !== 'EUR'"
        color="info"
        variant="subtle"
        icon="i-lucide-info"
        title="Not included in totals"
        :description="`This asset is in ${asset.currency}. Only EUR assets are aggregated on the dashboard.`"
      />
      <UAlert
        v-if="latestStale"
        color="warning"
        variant="subtle"
        icon="i-lucide-clock-alert"
        title="Stale valuation"
        :description="`The latest valuation is ${latestAge} days old. Add a new one to keep totals accurate.`"
      />

      <div class="grid gap-6 lg:grid-cols-3">
        <UCard>
          <template #header>
            <h2 class="font-semibold text-highlighted">
              Latest value
            </h2>
          </template>
          <template v-if="latest">
            <p class="text-3xl font-semibold text-highlighted tabular-nums">
              {{ formatMoney(latest.value, asset.currency) }}
            </p>
            <p class="mt-1 text-sm text-muted">
              {{ formatDate(latest.date) }} · {{ formatAge(latestAge) }}
            </p>
          </template>
          <UEmpty v-else icon="i-lucide-circle-help" title="No valuation yet" description="Value unknown until you record one." variant="naked" :actions="[{ label: 'Add valuation', icon: 'i-lucide-plus', onClick: addValuation }]" />
        </UCard>

        <UCard class="lg:col-span-2">
          <template #header>
            <h2 class="font-semibold text-highlighted">
              Details
            </h2>
          </template>
          <dl class="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            <div>
              <dt class="text-muted">
                Category
              </dt>
              <dd class="text-highlighted">
                {{ categoryLabel(asset.category) }}
              </dd>
            </div>
            <div>
              <dt class="text-muted">
                Currency
              </dt>
              <dd class="flex items-center gap-2 text-highlighted">
                {{ asset.currency }}
                <UBadge v-if="asset.currencyLocked" color="neutral" variant="subtle" size="sm" icon="i-lucide-lock" label="Locked" />
              </dd>
            </div>
            <div>
              <dt class="text-muted">
                Color
              </dt>
              <dd class="flex items-center gap-2 text-highlighted">
                <span class="size-3 rounded-full" :style="{ backgroundColor: asset.displayColor }" />
                {{ asset.color ?? 'Automatic' }}
              </dd>
            </div>
            <div>
              <dt class="text-muted">
                Valuations
              </dt>
              <dd class="text-highlighted">
                {{ asset.valuationCount }}
              </dd>
            </div>
            <div>
              <dt class="text-muted">
                Tracked since
              </dt>
              <dd class="text-highlighted">
                {{ formatDate(participatesFrom) }}
              </dd>
            </div>
            <div>
              <dt class="text-muted">
                Created / updated
              </dt>
              <dd class="text-highlighted">
                {{ formatTimestamp(asset.createdAt) }} / {{ formatTimestamp(asset.updatedAt) }}
              </dd>
            </div>
          </dl>
        </UCard>
      </div>

      <UCard>
        <template #header>
          <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 class="font-semibold text-highlighted">
                History
              </h2>
              <p class="text-sm text-muted">
                Daily balance, carried forward from each valuation
              </p>
            </div>
            <div class="flex items-center gap-2">
              <DateRangeInput :model-value="chartRange" :max="today" @update:model-value="filter = $event" />
              <UButton v-if="filter" color="neutral" variant="ghost" icon="i-lucide-x" aria-label="Clear date filter" @click="filter = null" />
            </div>
          </div>
        </template>

        <HistoryChart
          v-if="hasChartData"
          :rows="chartRows"
          :series="[{ key: 'value', name: asset.name, color: asset.displayColor }]"
          :currency="asset.currency"
          :height="260"
          :label="`${asset.name} value over time`"
        />
        <UEmpty v-else icon="i-lucide-chart-line" title="No data in this range" variant="naked" />
      </UCard>

      <UCard :ui="{ body: 'p-0 sm:p-0' }">
        <template #header>
          <h2 class="font-semibold text-highlighted">
            Valuations
          </h2>
          <p class="text-sm text-muted">
            {{ filter ? `${formatDate(filter.from)} – ${formatDate(filter.to)}` : 'All dates' }} · {{ valuations.length }} shown
          </p>
        </template>
        <UTable :data="valuations" :columns="columns" :loading="status === 'pending'">
          <template #empty>
            <UEmpty icon="i-lucide-list" title="No valuations" :description="filter ? 'Nothing recorded in this date range.' : 'Record the balance of this asset to start its history.'" variant="naked" />
          </template>
        </UTable>
      </UCard>
    </UPageBody>

    <AssetFormModal v-model:open="editOpen" :asset="asset" @saved="refreshAllData" />
    <ValuationFormModal
      v-model:open="valuationOpen"
      :asset-id="asset.id"
      :currency="asset.currency"
      :valuation="editingValuation"
      @saved="refreshAllData"
    />

    <UModal v-model:open="deleteOpen" title="Delete valuation?" :description="deleting ? `${formatDate(deleting.date)} · ${formatMoney(deleting.value, asset.currency)}` : undefined">
      <template #body>
        <p class="text-sm text-muted">
          This permanently removes the valuation. The history will carry forward the previous valuation instead.
        </p>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="outline" label="Cancel" @click="deleting = null" />
          <UButton color="error" label="Delete" :loading="deleteBusy" @click="confirmDelete" />
        </div>
      </template>
    </UModal>
  </UPage>

  <UAlert v-else-if="assetError" color="error" variant="subtle" title="Could not load asset" :description="apiErrorMessage(assetError)" class="my-8" />
</template>
