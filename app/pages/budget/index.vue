<script setup lang="ts">
import type { TableColumn, TabsItem } from '@nuxt/ui'
import type { BudgetHistoryDTO, BudgetItemDTO, BudgetMonthDTO } from '#shared/types/api'
import type { BudgetLine, BudgetRangePreset } from '#shared/utils/budget'
import type { ChartRow, ChartSeries } from '~/components/HistoryChart.vue'
import { isValidMonth } from '#shared/utils/budget'
import { parseDecimalToMinor, minorToDecimal } from '#shared/utils/money'

useHead({ title: 'Budget · Finance' })

const route = useRoute()
const router = useRouter()

// The month shown is kept in the URL (?month=YYYY-MM) so it survives reloads and can be bookmarked.
const month = computed({
  get: () => {
    const q = String(route.query.month ?? '')
    return isValidMonth(q) ? q : undefined
  },
  set: (m: string | undefined) => {
    router.replace({ query: { ...route.query, month: m } })
  },
})

const { data: budget, error, refresh: refreshMonth, status } = await useFetch<BudgetMonthDTO>('/api/budget', {
  query: computed(() => (month.value ? { month: month.value } : {})),
})

const range = ref<BudgetRangePreset>('12M')
const { data: history, refresh: refreshHistory } = await useFetch<BudgetHistoryDTO>('/api/budget/history', { query: { range } })
const { data: items, refresh: refreshItems } = await useFetch<BudgetItemDTO[]>('/api/budget/items', { default: () => [] })

async function refreshAll() {
  await Promise.all([refreshMonth(), refreshHistory(), refreshItems()])
}

const shownMonth = computed(() => budget.value?.month ?? month.value ?? '')
const pickerMonth = computed({
  get: () => shownMonth.value,
  set: (m: string) => {
    month.value = m === budget.value?.currentMonth ? undefined : m
  },
})
const isCurrent = computed(() => !!budget.value && budget.value.month === budget.value.currentMonth)
const isFuture = computed(() => !!budget.value && budget.value.month > budget.value.currentMonth)

function go(m: string | undefined) {
  pickerMonth.value = m ?? budget.value?.currentMonth ?? ''
}

// Summary tiles with the change against the previous month.
const minor = (v: string) => parseDecimalToMinor(v)
function delta(now: string, before: string) {
  const d = minor(now) - minor(before)
  return d === 0 ? null : { value: minorToDecimal(d), up: d > 0 }
}

const tiles = computed(() => {
  const b = budget.value
  if (!b) return []
  return [
    { label: 'Income', value: b.totals.income, delta: delta(b.totals.income, b.previousTotals.income), good: (up: boolean) => up, icon: 'i-lucide-arrow-down-left' },
    { label: 'Expenses', value: b.totals.expense, delta: delta(b.totals.expense, b.previousTotals.expense), good: (up: boolean) => !up, icon: 'i-lucide-arrow-up-right' },
    { label: 'Left over', value: b.totals.remaining, delta: delta(b.totals.remaining, b.previousTotals.remaining), good: (up: boolean) => up, icon: 'i-lucide-piggy-bank' },
  ]
})

const savingsRate = computed(() => {
  const b = budget.value
  if (!b || minor(b.totals.income) <= 0) return null
  return Math.round((minor(b.totals.remaining) / minor(b.totals.income)) * 1000) / 10
})

const incomeLines = computed(() => budget.value?.lines.filter(l => l.kind === 'income') ?? [])
const expenseLines = computed(() => budget.value?.lines.filter(l => l.kind === 'expense') ?? [])

// Expense breakdown (donut): the largest items, the rest folded into "Other".
// Validated categorical palette (light / dark steps of the same hues); colors follow items, not their rank.
const SLICE_COLORS = {
  light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300'],
  dark: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300'],
}
const OTHER_COLOR = { light: '#9a9a94', dark: '#6f6f69' }
const MAX_SLICES = 6
const colorMode = useColorMode()
const percent = new Intl.NumberFormat('fr-FR', { style: 'percent', maximumFractionDigits: 1 })

const expenseSlices = computed(() => {
  const mode = colorMode.value === 'dark' ? 'dark' : 'light'
  const lines = expenseLines.value.filter(l => minor(l.amount) > 0).sort((a, b) => minor(b.amount) - minor(a.amount))
  const top = lines.length > MAX_SLICES ? lines.slice(0, MAX_SLICES - 1) : lines
  const rest = lines.slice(top.length)
  // Item IDs are ULIDs, so sorting them gives creation order: an item keeps its color as amounts change.
  const color = new Map([...top].sort((a, b) => (a.id < b.id ? -1 : 1)).map((l, i) => [l.id, SLICE_COLORS[mode][i]!]))
  const slices = top.map(l => ({ id: l.id, name: l.name, cents: minor(l.amount), color: color.get(l.id)! }))
  if (rest.length) {
    slices.push({ id: 'other', name: `Other (${rest.length})`, cents: rest.reduce((s, l) => s + minor(l.amount), 0), color: OTHER_COLOR[mode] })
  }
  const total = slices.reduce((s, x) => s + x.cents, 0)
  return slices.map(x => ({ ...x, value: x.cents / 100, amount: minorToDecimal(x.cents), share: total ? x.cents / total : 0 }))
})

const ULink = resolveComponent('ULink')
const UBadge = resolveComponent('UBadge')

function changeBadge(l: BudgetLine) {
  if (l.change === 'new') return h(UBadge, { color: 'info', variant: 'subtle', size: 'sm', label: 'New' })
  if (l.change === 'stopped') return h(UBadge, { color: 'neutral', variant: 'subtle', size: 'sm', label: 'Set to 0' })
  if (l.change === 'changed' && l.previousAmount !== null) {
    const d = minor(l.amount) - minor(l.previousAmount)
    const sign = d > 0 ? '+' : '−'
    return h(UBadge, { color: 'warning', variant: 'subtle', size: 'sm', label: `${sign}${formatMoney(minorToDecimal(Math.abs(d)))}` })
  }
  return null
}

const lineColumns: TableColumn<BudgetLine>[] = [
  {
    accessorKey: 'name',
    header: 'Item',
    cell: ({ row }) => h('div', { class: 'flex flex-wrap items-center gap-2' }, [
      h(ULink, { to: `/budget/items/${row.original.id}`, class: 'font-medium text-highlighted' }, () => row.original.name),
      changeBadge(row.original),
    ]),
  },
  {
    accessorKey: 'effectiveFrom',
    header: 'Since',
    meta: { class: { th: 'hidden sm:table-cell', td: 'hidden sm:table-cell text-muted' } },
    cell: ({ row }) => formatMonthShort(row.original.effectiveFrom),
  },
  {
    accessorKey: 'amount',
    header: () => h('div', { class: 'text-right' }, 'Monthly'),
    cell: ({ row }) => h('div', { class: ['text-right tabular-nums', row.original.amount === '0.00' ? 'text-muted line-through' : 'text-highlighted'] }, formatMoney(row.original.amount)),
  },
]

// History chart: planned income, expenses and what is left, per month.
const rangeItems: TabsItem[] = [
  { label: '12M', value: '12M' },
  { label: '24M', value: '24M' },
  { label: 'All', value: 'ALL' },
]

const chartSeries: ChartSeries[] = [
  { key: 'income', name: 'Income', color: 'var(--ui-success)' },
  { key: 'expense', name: 'Expenses', color: 'var(--ui-error)' },
  { key: 'remaining', name: 'Left over', color: 'var(--ui-info)' },
]

const chartRows = computed<ChartRow[]>(() => (history.value?.points ?? []).map(p => ({
  date: p.month,
  values: { income: p.income, expense: p.expense, remaining: p.remaining },
  notes: p.month > (history.value?.currentMonth ?? '') ? ['Planned'] : [],
})))

const hasHistory = computed(() => chartRows.value.length > 1 && (history.value?.changes.length ?? 0) > 0)

// All items, including those at 0 and those starting later.
const itemColumns: TableColumn<BudgetItemDTO>[] = [
  {
    accessorKey: 'name',
    header: 'Item',
    cell: ({ row }) => h(ULink, { to: `/budget/items/${row.original.id}`, class: 'font-medium text-highlighted' }, () => row.original.name),
  },
  {
    accessorKey: 'kind',
    header: 'Kind',
    cell: ({ row }) => h(UBadge, { color: row.original.kind === 'income' ? 'success' : 'error', variant: 'subtle', size: 'sm', label: budgetKindLabel(row.original.kind) }),
  },
  {
    accessorKey: 'currentAmount',
    header: () => h('div', { class: 'text-right' }, 'Now'),
    cell: ({ row }) => h('div', { class: 'text-right tabular-nums' }, row.original.status === 'planned' ? '—' : formatMoney(row.original.currentAmount)),
  },
  {
    id: 'status',
    header: 'Status',
    meta: { class: { th: 'hidden sm:table-cell', td: 'hidden sm:table-cell' } },
    cell: ({ row }) => {
      const i = row.original
      const next = i.nextChange ? h('span', { class: 'text-xs text-muted' }, `→ ${formatMoney(i.nextChange.amount)} from ${formatMonthShort(i.nextChange.month)}`) : null
      const badge = i.status === 'active'
        ? null
        : h(UBadge, { color: 'neutral', variant: 'subtle', size: 'sm', label: i.status === 'stopped' ? 'At 0' : 'Starts later' })
      return h('div', { class: 'flex flex-wrap items-center gap-2' }, [badge, next])
    },
  },
]

const createOpen = ref(false)

async function onCreated(item: { id: string }) {
  await refreshAll()
  await navigateTo(`/budget/items/${item.id}`)
}

const description = computed(() => {
  const b = budget.value
  if (!b) return 'Your monthly income and expenses'
  if (isCurrent.value) return `This month · ${formatMonth(b.month)}`
  return `${formatMonth(b.month)}${isFuture.value ? ' · planned' : ''}`
})
</script>

<template>
  <UPage>
    <UPageHeader title="Budget" :description="description">
      <template #links>
        <UButton label="New item" icon="i-lucide-plus" @click="createOpen = true" />
      </template>
    </UPageHeader>

    <UPageBody>
      <UAlert v-if="error" color="error" variant="subtle" icon="i-lucide-triangle-alert" title="Could not load the budget" :description="apiErrorMessage(error)" />

      <UEmpty
        v-else-if="budget && budget.itemCount === 0"
        icon="i-lucide-piggy-bank"
        title="No budget items yet"
        description="Add your monthly income and expenses: salary, rent, subscriptions… Each item keeps the history of its amount."
        :actions="[{ label: 'New item', icon: 'i-lucide-plus', onClick: () => { createOpen = true } }]"
      />

      <template v-else-if="budget">
        <div class="flex flex-wrap items-center gap-2">
          <UButton icon="i-lucide-chevron-left" color="neutral" variant="outline" aria-label="Previous month" @click="go(budget.previousMonth)" />
          <MonthInput v-model="pickerMonth" />
          <UButton icon="i-lucide-chevron-right" color="neutral" variant="outline" aria-label="Next month" @click="go(budget.nextMonth)" />
          <UButton v-if="!isCurrent" label="This month" color="neutral" variant="ghost" @click="go(undefined)" />
          <UBadge v-if="isFuture" color="info" variant="subtle" icon="i-lucide-calendar-clock" label="Planned" />
        </div>

        <div class="grid gap-4 sm:grid-cols-3" :class="status === 'pending' ? 'opacity-60' : undefined">
          <UCard v-for="t in tiles" :key="t.label">
            <div class="flex items-center gap-2 text-sm text-muted">
              <UIcon :name="t.icon" class="size-4" />
              {{ t.label }}
            </div>
            <p class="mt-2 text-2xl font-semibold tabular-nums" :class="t.label === 'Left over' && t.value.startsWith('-') ? 'text-error' : 'text-highlighted'">
              {{ formatMoney(t.value) }}
            </p>
            <p class="mt-1 text-sm tabular-nums" :class="t.delta ? (t.good(t.delta.up) ? 'text-success' : 'text-error') : 'text-muted'">
              <template v-if="t.delta">
                {{ t.delta.up ? '+' : '' }}{{ formatMoney(t.delta.value) }} vs {{ formatMonthShort(budget.previousMonth) }}
              </template>
              <template v-else>
                Same as {{ formatMonthShort(budget.previousMonth) }}
              </template>
            </p>
            <p v-if="t.label === 'Left over' && savingsRate !== null" class="text-xs text-muted">
              {{ savingsRate.toLocaleString('fr-FR') }} % of income
            </p>
          </UCard>
        </div>

        <UCard v-if="expenseSlices.length">
          <template #header>
            <h2 class="font-semibold text-highlighted">
              Where the money goes
            </h2>
            <p class="text-sm text-muted">
              Share of {{ formatMonth(budget.month) }} expenses by item
            </p>
          </template>

          <div class="grid items-center gap-6 md:grid-cols-2">
            <UChart
              type="donut"
              :data="expenseSlices"
              index="name"
              :categories="['value']"
              :colors="expenseSlices.map(s => s.color)"
              :format="(v: number) => formatMoney(v)"
              :height="260"
              :thickness="28"
              :aria-label="`Breakdown of ${formatMonth(budget.month)} expenses by item`"
            >
              <template #center>
                <span class="text-lg font-semibold text-highlighted tabular-nums">{{ formatMoney(budget.totals.expense) }}</span>
                <span class="text-xs text-muted">per month</span>
              </template>
            </UChart>

            <ul class="divide-y divide-default text-sm">
              <li v-for="s in expenseSlices" :key="s.id" class="flex items-center gap-2 py-2">
                <span class="size-2.5 shrink-0 rounded-full" :style="{ backgroundColor: s.color }" />
                <ULink v-if="s.id !== 'other'" :to="`/budget/items/${s.id}`" class="min-w-0 truncate font-medium text-highlighted">
                  {{ s.name }}
                </ULink>
                <span v-else class="min-w-0 truncate font-medium text-highlighted">{{ s.name }}</span>
                <span class="ms-auto ps-3 text-muted tabular-nums">{{ percent.format(s.share) }}</span>
                <span class="w-28 text-right text-highlighted tabular-nums">{{ formatMoney(s.amount) }}</span>
              </li>
            </ul>
          </div>
        </UCard>

        <div class="grid gap-6 lg:grid-cols-2">
          <UCard :ui="{ body: 'p-0 sm:p-0' }">
            <template #header>
              <div class="flex items-center justify-between">
                <h2 class="font-semibold text-highlighted">
                  Income
                </h2>
                <span class="font-semibold text-success tabular-nums">{{ formatMoney(budget.totals.income) }}</span>
              </div>
            </template>
            <UTable :data="incomeLines" :columns="lineColumns">
              <template #empty>
                <UEmpty icon="i-lucide-arrow-down-left" title="No income this month" variant="naked" />
              </template>
            </UTable>
          </UCard>

          <UCard :ui="{ body: 'p-0 sm:p-0' }">
            <template #header>
              <div class="flex items-center justify-between">
                <h2 class="font-semibold text-highlighted">
                  Expenses
                </h2>
                <span class="font-semibold text-error tabular-nums">{{ formatMoney(budget.totals.expense) }}</span>
              </div>
            </template>
            <UTable :data="expenseLines" :columns="lineColumns">
              <template #empty>
                <UEmpty icon="i-lucide-arrow-up-right" title="No expenses this month" variant="naked" />
              </template>
            </UTable>
          </UCard>
        </div>

        <UCard>
          <template #header>
            <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 class="font-semibold text-highlighted">
                  Over time
                </h2>
                <p class="text-sm text-muted">
                  Monthly totals, including planned changes
                </p>
              </div>
              <UTabs v-model="range" :items="rangeItems" :content="false" size="xs" />
            </div>
          </template>

          <HistoryChart
            v-if="hasHistory"
            :rows="chartRows"
            :series="chartSeries"
            legend
            monthly
            :height="280"
            label="Monthly budget totals over time"
          />
          <UEmpty v-else icon="i-lucide-chart-line" title="Not enough history yet" description="The chart fills in as your budget changes over the months." variant="naked" />
        </UCard>

        <div class="grid gap-6 lg:grid-cols-2">
          <UCard>
            <template #header>
              <h2 class="font-semibold text-highlighted">
                Changes
              </h2>
              <p class="text-sm text-muted">
                Amount changes in this period, newest first
              </p>
            </template>
            <ul v-if="history?.changes.length" class="divide-y divide-default">
              <li v-for="c in history.changes.slice(0, 20)" :key="`${c.itemId}-${c.month}`" class="flex items-center justify-between gap-3 py-2 text-sm">
                <div class="min-w-0">
                  <ULink :to="`/budget/items/${c.itemId}`" class="font-medium text-highlighted">
                    {{ c.name }}
                  </ULink>
                  <p class="text-muted">
                    {{ formatMonth(c.month) }}
                  </p>
                </div>
                <div class="text-right tabular-nums">
                  <span v-if="c.previousAmount !== null" class="text-muted">{{ formatMoney(c.previousAmount) }} → </span>
                  <span class="text-highlighted">{{ formatMoney(c.amount) }}</span>
                  <p v-if="c.previousAmount === null" class="text-xs text-muted">
                    Started
                  </p>
                </div>
              </li>
            </ul>
            <UEmpty v-else icon="i-lucide-history" title="No changes in this period" variant="naked" />
          </UCard>

          <UCard :ui="{ body: 'p-0 sm:p-0' }">
            <template #header>
              <h2 class="font-semibold text-highlighted">
                All items
              </h2>
              <p class="text-sm text-muted">
                {{ items.length }} {{ items.length === 1 ? 'item' : 'items' }}, including those at 0
              </p>
            </template>
            <UTable :data="items" :columns="itemColumns" />
          </UCard>
        </div>
      </template>
    </UPageBody>

    <BudgetItemFormModal v-model:open="createOpen" :default-month="shownMonth || undefined" @saved="onCreated" />
  </UPage>
</template>
