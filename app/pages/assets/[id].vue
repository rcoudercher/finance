<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { AssetDetailDTO, RateDTO, ValuationDTO } from '#shared/types/api'
import type { IsoRange } from '~/components/DateRangeInput.vue'
import type { ChartRow } from '~/components/HistoryChart.vue'
import { diffDays, minDate, parisDate } from '#shared/utils/dates'
import { assetHistory, isAggregated, latestOnOrBefore, STALE_AFTER_DAYS } from '#shared/utils/finance'
import { CONVERTED_CURRENCIES, convertMinor, currencyDecimals, minorToDecimal, parseDecimalToMinor } from '#shared/utils/money'

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

// BTC assets: balances are in BTC; EUR values use the daily BTC-EUR rates.
const converted = computed(() => !!asset.value && CONVERTED_CURRENCIES.includes(asset.value.currency))
const { data: rateList, refresh: refreshRates } = await useFetch<RateDTO[]>('/api/rates', {
  query: { currency: computed(() => asset.value?.currency) },
  immediate: converted.value,
  default: () => [],
})

async function refreshAllData() {
  await Promise.all([refreshAsset(), refreshAll(), refreshFiltered(), converted.value ? refreshRates() : undefined])
}

const participatesFrom = computed(() => {
  const created = asset.value ? parisDate(new Date(asset.value.createdAt)) : today
  const earliest = allValuations.value.at(-1)?.date
  return earliest ? minDate(created, earliest) : created
})

const chartRange = computed<IsoRange>(() => filter.value ?? { from: participatesFrom.value, to: today })

const chartCurrency = computed(() => (converted.value ? 'EUR' : asset.value?.currency ?? 'EUR'))

// "Paid in" (EUR), carried forward from the valuations that record it.
const paidInList = computed(() => allValuations.value
  .filter(v => v.paidIn !== null && v.date <= today)
  .map(v => ({ date: v.date, paidIn: v.paidIn! }))
  .sort((a, b) => (a.date < b.date ? -1 : 1)))
const tracksPaidIn = computed(() => paidInList.value.length > 0)
/** Latest recorded paid in, to pre-fill the next valuation. */
const previousPaidIn = computed(() => paidInList.value.at(-1)?.paidIn ?? null)
const perf = computed(() => asset.value?.performance ?? null)

const chartRows = computed<ChartRow[]>(() => assetHistory(allValuations.value, {
  ...chartRange.value,
  today,
  participatesFrom: participatesFrom.value,
}).map((p) => {
  const row = valueRow(p)
  if (tracksPaidIn.value) row.values.paidIn = latestOnOrBefore(paidInList.value, p.date)?.paidIn ?? null
  return row
}))

function valueRow(p: ReturnType<typeof assetHistory>[number]): ChartRow {
  if (!converted.value || p.value === null) {
    const notes = p.stale && p.observedOn ? [`Last observed ${formatDate(p.observedOn)} (stale)`] : []
    return { date: p.date, values: { value: p.value }, notes }
  }
  // EUR value = BTC balance carried forward x latest rate on or before that day.
  const currency = asset.value!.currency
  const rate = latestOnOrBefore(rateList.value, p.date)
  if (!rate) return { date: p.date, values: { value: null }, notes: [`${formatMoney(p.value, currency)}, no ${currency}-EUR rate yet`] }
  const decimals = currencyDecimals(currency)
  const eur = minorToDecimal(convertMinor(parseDecimalToMinor(p.value, decimals), decimals, rate.rate))
  const rateNote = diffDays(p.date, rate.date) > STALE_AFTER_DAYS ? [`Rate from ${formatDate(rate.date)} (stale)`] : []
  return { date: p.date, values: { value: eur }, notes: [`${formatMoney(p.value, currency)} × ${formatMoney(rate.rate)}`, ...rateNote] }
}

const chartSeries = computed(() => {
  const series = [{ key: 'value', name: asset.value?.name ?? 'Value', color: asset.value?.displayColor ?? 'var(--ui-primary)' }]
  if (tracksPaidIn.value) series.push({ key: 'paidIn', name: 'Paid in', color: 'var(--ui-text-dimmed)' })
  return series
})

const returnTile = computed(() => {
  const p = perf.value
  if (!p) return null
  if (p.annualReturn !== null) return { label: 'Annual return', value: `${formatPercent(p.annualReturn)} / yr`, hint: `Since ${formatDate(p.since)}, weighted by when money was added` }
  if (p.periodReturn !== null) return { label: `Return since ${formatDate(p.since)}`, value: formatPercent(p.periodReturn), hint: 'Shown per year once there is a year of data' }
  return { label: 'Return', value: '—', hint: 'Needs a second valuation with paid in' }
})

const hasChartData = computed(() => chartRows.value.some(r => r.values.value !== null))
const latest = computed(() => asset.value?.latestValuation ?? null)
const latestAge = computed(() => (latest.value ? diffDays(today, latest.value.date) : null))
// A BTC quantity stays valid until you buy or sell; for those assets only the rate can be stale.
const latestStale = computed(() => !converted.value && latestAge.value !== null && latestAge.value > STALE_AFTER_DAYS)

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

// Delete the whole asset (and all its valuations).
const deleteAssetOpen = ref(false)
const deleteAssetBusy = ref(false)

async function confirmDeleteAsset() {
  if (!asset.value) return
  const name = asset.value.name
  deleteAssetBusy.value = true
  try {
    await $fetch(`/api/assets/${asset.value.id}`, { method: 'DELETE' })
    deleteAssetOpen.value = false
    toast.add({ title: 'Asset deleted', description: `${name} and its valuations were removed.`, color: 'success', icon: 'i-lucide-check' })
    await navigateTo('/assets')
  }
  catch (e) {
    toast.add({ title: 'Could not delete asset', description: apiErrorMessage(e), color: 'error', icon: 'i-lucide-triangle-alert' })
  }
  finally {
    deleteAssetBusy.value = false
  }
}

const UButton = resolveComponent('UButton')
const UBadge = resolveComponent('UBadge')

const columns = computed<TableColumn<ValuationDTO>[]>(() => [
  { accessorKey: 'date', header: 'Date', cell: ({ row }) => formatDate(row.original.date) },
  {
    accessorKey: 'value',
    header: () => h('div', { class: 'text-right' }, converted.value ? 'Quantity' : 'Balance'),
    cell: ({ row }) => h('div', { class: 'text-right tabular-nums' }, formatMoney(row.original.value, asset.value?.currency)),
  },
  ...(tracksPaidIn.value
    ? [{
        accessorKey: 'paidIn',
        header: () => h('div', { class: 'text-right' }, 'Paid in'),
        cell: ({ row }: { row: { original: ValuationDTO } }) => h('div', { class: 'text-right tabular-nums text-muted' }, formatMoney(row.original.paidIn)),
      } satisfies TableColumn<ValuationDTO>]
    : []),
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
        v-if="!isAggregated(asset.currency)"
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
      <UAlert
        v-if="asset.latestEurValue?.rateStale"
        color="warning"
        variant="subtle"
        icon="i-lucide-clock-alert"
        :title="`Stale ${asset.currency}-EUR rate`"
        :description="`The latest rate is from ${formatDate(asset.latestEurValue.rateDate)}. Check the daily rate job (~/logs/btc-rate.log).`"
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
            <template v-if="converted">
              <p v-if="asset.latestEurValue" class="mt-3 text-xl font-semibold text-highlighted tabular-nums">
                ≈ {{ formatMoney(asset.latestEurValue.value) }}
              </p>
              <p v-if="asset.latestEurValue" class="text-sm text-muted">
                at {{ formatMoney(asset.latestEurValue.rate) }} / {{ asset.currency }} on {{ formatDate(asset.latestEurValue.rateDate) }}
              </p>
              <p v-else class="mt-3 text-sm text-muted">
                No {{ asset.currency }}-EUR rate yet, so the EUR value is unknown.
              </p>
            </template>
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

      <UCard v-if="perf && returnTile">
        <template #header>
          <h2 class="font-semibold text-highlighted">
            Performance
          </h2>
          <p class="text-sm text-muted">
            As of {{ formatDate(perf.asOf) }}, from the amounts you have paid in
          </p>
        </template>
        <div class="grid gap-6 sm:grid-cols-3">
          <div>
            <p class="text-sm text-muted">
              Paid in
            </p>
            <p class="mt-1 text-2xl font-semibold text-highlighted tabular-nums">
              {{ formatMoney(perf.paidIn) }}
            </p>
            <p class="mt-1 text-xs text-muted">
              Value {{ formatMoney(perf.value) }}
            </p>
          </div>
          <div>
            <p class="text-sm text-muted">
              Gains
            </p>
            <p class="mt-1 text-2xl font-semibold tabular-nums" :class="perf.gain.startsWith('-') ? 'text-error' : 'text-success'">
              {{ formatMoneySigned(perf.gain) }}
            </p>
            <p class="mt-1 text-xs text-muted">
              {{ perf.gainRatio === null ? 'Value minus paid in' : `${formatPercent(perf.gainRatio)} on what you paid in` }}
            </p>
          </div>
          <div>
            <p class="text-sm text-muted">
              {{ returnTile.label }}
            </p>
            <p class="mt-1 text-2xl font-semibold text-highlighted tabular-nums">
              {{ returnTile.value }}
            </p>
            <p class="mt-1 text-xs text-muted">
              {{ returnTile.hint }}
            </p>
          </div>
        </div>
      </UCard>
      <UAlert
        v-else-if="isAggregated(asset.currency) && asset.valuationCount > 0"
        color="neutral"
        variant="subtle"
        icon="i-lucide-trending-up"
        title="See your gains and return"
        description="Add the total you have paid in (e.g. your broker's &quot;Versements&quot;) when you record a valuation."
      />

      <UCard>
        <template #header>
          <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 class="font-semibold text-highlighted">
                History
              </h2>
              <p class="text-sm text-muted">
                {{ converted ? `Daily EUR value: ${asset.currency} held × ${asset.currency}-EUR rate` : 'Daily balance, carried forward from each valuation' }}
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
          :series="chartSeries"
          :legend="tracksPaidIn"
          :currency="chartCurrency"
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

      <UAlert
        color="error"
        variant="subtle"
        icon="i-lucide-triangle-alert"
        title="Delete this asset"
        :description="`Permanently removes ${asset.name} and all ${asset.valuationCount} of its valuations. Its history disappears from the dashboard and totals. This cannot be undone.`"
        orientation="horizontal"
        :actions="[{ label: 'Delete asset', color: 'error', icon: 'i-lucide-trash-2', onClick: () => { deleteAssetOpen = true } }]"
      />
    </UPageBody>

    <AssetFormModal v-model:open="editOpen" :asset="asset" @saved="refreshAllData" />
    <ValuationFormModal
      v-model:open="valuationOpen"
      :asset-id="asset.id"
      :currency="asset.currency"
      :valuation="editingValuation"
      :previous-paid-in="previousPaidIn"
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

    <UModal v-model:open="deleteAssetOpen" :title="`Delete ${asset.name}?`" :dismissible="!deleteAssetBusy">
      <template #body>
        <div class="space-y-3 text-sm text-muted">
          <p>
            This permanently deletes the asset and
            <strong class="text-highlighted">{{ asset.valuationCount }} {{ asset.valuationCount === 1 ? 'valuation' : 'valuations' }}</strong>.
            It will no longer count in the dashboard totals or history, including past dates.
          </p>
          <p>There is no undo. The only way back is restoring a database backup.</p>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="outline" label="Cancel" :disabled="deleteAssetBusy" @click="deleteAssetOpen = false" />
          <UButton color="error" icon="i-lucide-trash-2" label="Delete asset and valuations" :loading="deleteAssetBusy" @click="confirmDeleteAsset" />
        </div>
      </template>
    </UModal>
  </UPage>

  <UAlert v-else-if="assetError" color="error" variant="subtle" title="Could not load asset" :description="apiErrorMessage(assetError)" class="my-8" />
</template>
