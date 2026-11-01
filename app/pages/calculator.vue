<script setup lang="ts">
import type { BudgetMonthDTO, DashboardDTO } from '#shared/types/api'
import type { ChartRow, ChartSeries } from '~/components/HistoryChart.vue'
import { COMPOUND_LIMITS, compoundProjection, type CompoundInput } from '#shared/utils/compound'

useHead({ title: 'Compound interest · Finance' })

const route = useRoute()
const router = useRouter()

// Inputs live in the URL, with the same parameter names as the usual calculator links:
// ?initial_capital=10000&monthly_savings=100&investment_horizon=20&interest_rate=5
const PARAMS: Record<keyof CompoundInput, string> = {
  initialCapital: 'initial_capital',
  monthlySavings: 'monthly_savings',
  years: 'investment_horizon',
  annualRatePercent: 'interest_rate',
}
const DEFAULTS: CompoundInput = { initialCapital: 10_000, monthlySavings: 100, years: 20, annualRatePercent: 5 }

function fromQuery(key: keyof CompoundInput): number {
  const raw = Number(route.query[PARAMS[key]])
  const { min, max } = COMPOUND_LIMITS[key]
  if (route.query[PARAMS[key]] === undefined || !Number.isFinite(raw)) return DEFAULTS[key]
  const clamped = Math.min(max, Math.max(min, raw))
  return key === 'years' ? Math.round(clamped) : clamped
}

const form = reactive<Record<keyof CompoundInput, number | undefined>>({
  initialCapital: fromQuery('initialCapital'),
  monthlySavings: fromQuery('monthlySavings'),
  years: fromQuery('years'),
  annualRatePercent: fromQuery('annualRatePercent'),
})

// The last complete, in-range input: an empty or out-of-range field never blanks the chart.
const input = computed<CompoundInput | null>(() => {
  const out = {} as CompoundInput
  for (const key of Object.keys(PARAMS) as (keyof CompoundInput)[]) {
    const v = form[key]
    const { min, max } = COMPOUND_LIMITS[key]
    if (v === undefined || v === null || !Number.isFinite(v) || v < min || v > max) return null
    out[key] = key === 'years' ? Math.round(v) : v
  }
  return out
})
const lastValid = shallowRef<CompoundInput>(input.value ?? DEFAULTS)
watch(input, (v) => {
  if (!v) return
  lastValid.value = v
  router.replace({ query: Object.fromEntries((Object.keys(PARAMS) as (keyof CompoundInput)[]).map(k => [PARAMS[k], String(v[k])])) })
})

// "Use my numbers": current net worth as the initial capital, this month's budget left-over as the monthly saving.
const { data: dashboardNow } = await useFetch<DashboardDTO>('/api/dashboard', { query: { range: '1M' }, lazy: true })
const { data: budgetNow } = await useFetch<BudgetMonthDTO>('/api/budget', { lazy: true })

const mine = computed(() => {
  const total = dashboardNow.value?.current.total ?? null
  const remaining = budgetNow.value && budgetNow.value.itemCount > 0 ? budgetNow.value.totals.remaining : null
  return {
    capital: total === null ? null : Number(total),
    capitalPartial: !!dashboardNow.value && !dashboardNow.value.current.complete,
    savings: remaining === null ? null : Number(remaining),
    month: budgetNow.value?.month ?? null,
  }
})
const canUseMine = computed(() => mine.value.capital !== null || mine.value.savings !== null)
const usingMine = ref(false)

function useMyNumbers() {
  const m = mine.value
  if (m.capital !== null) form.initialCapital = Math.min(COMPOUND_LIMITS.initialCapital.max, Math.max(0, m.capital))
  // A negative left-over (expenses above income) can't be invested: use 0.
  if (m.savings !== null) form.monthlySavings = Math.min(COMPOUND_LIMITS.monthlySavings.max, Math.max(0, m.savings))
  usingMine.value = true
}

// Editing either amount by hand means the figures are no longer "mine".
watch(() => [form.initialCapital, form.monthlySavings], ([capital, savings]) => {
  if (!usingMine.value) return
  const m = mine.value
  const sameCapital = m.capital === null || capital === Math.max(0, m.capital)
  const sameSavings = m.savings === null || savings === Math.max(0, m.savings)
  if (!sameCapital || !sameSavings) usingMine.value = false
})

const capitalHelp = computed(() => {
  if (!usingMine.value || mine.value.capital === null) return undefined
  return `Your net worth today${mine.value.capitalPartial ? ' (partial: some assets have no known value)' : ''}`
})
const savingsHelp = computed(() => {
  if (!usingMine.value || mine.value.savings === null || !mine.value.month) return undefined
  return mine.value.savings < 0
    ? `Your ${formatMonth(mine.value.month)} budget is negative (${fmt(mine.value.savings)}), so 0 is used`
    : `Left over in your ${formatMonth(mine.value.month)} budget`
})

const points = computed(() => compoundProjection(lastValid.value))
const final = computed(() => points.value.at(-1)!)
const interest = computed(() => final.value.balance - final.value.contributions)

const euros = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
const fmt = (v: number) => euros.format(Math.round(v))

// Validated categorical slots 1 and 2 (blue, orange), stepped for each color mode.
const colorMode = useColorMode()
const series = computed<ChartSeries[]>(() => {
  const dark = colorMode.value === 'dark'
  return [
    { key: 'balance', name: 'With interest', color: dark ? '#3987e5' : '#2a78d6' },
    { key: 'contributions', name: 'Paid in only', color: dark ? '#d95926' : '#eb6834' },
  ]
})

const rows = computed<ChartRow[]>(() => points.value.map(p => ({
  date: String(p.year),
  values: { balance: (Math.round(p.balance * 100) / 100).toFixed(2), contributions: p.contributions.toFixed(2) },
  notes: p.year > 0 ? [`Interest: ${fmt(p.balance - p.contributions)}`] : [],
})))

const yearLabel = (key: string) => (key === '0' ? 'Start' : `Year ${key}`)

const tiles = computed(() => [
  { label: 'Final capital', value: fmt(final.value.balance), hint: `after ${lastValid.value.years} ${lastValid.value.years === 1 ? 'year' : 'years'}` },
  { label: 'Total paid in', value: fmt(final.value.contributions), hint: `${fmt(lastValid.value.initialCapital)} + ${fmt(lastValid.value.monthlySavings)} × ${lastValid.value.years * 12} months` },
  { label: 'Interest earned', value: fmt(interest.value), hint: final.value.contributions > 0 ? `${Math.round((interest.value / final.value.contributions) * 100)} % of what you paid in` : '' },
])
</script>

<template>
  <UPage>
    <UPageHeader title="Compound interest" description="How a starting capital and a monthly saving grow over time." />

    <UPageBody>
      <div class="grid gap-6 lg:grid-cols-3">
        <UCard>
          <template #header>
            <div class="flex items-center justify-between gap-2">
              <h2 class="font-semibold text-highlighted">
                Your plan
              </h2>
              <UButton
                v-if="canUseMine"
                label="Use my numbers"
                icon="i-lucide-wand-sparkles"
                size="sm"
                :color="usingMine ? 'primary' : 'neutral'"
                :variant="usingMine ? 'subtle' : 'outline'"
                @click="useMyNumbers"
              />
            </div>
          </template>
          <div class="space-y-4">
            <UFormField label="Initial capital" :help="capitalHelp">
              <UInputNumber
                v-model.optional="form.initialCapital"
                locale="fr-FR"
                :format-options="{ style: 'currency', currency: 'EUR', maximumFractionDigits: 2 }"
                :min="COMPOUND_LIMITS.initialCapital.min"
                :max="COMPOUND_LIMITS.initialCapital.max"
                :step="1000"
                inputmode="decimal"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Monthly savings" :help="savingsHelp">
              <UInputNumber
                v-model.optional="form.monthlySavings"
                locale="fr-FR"
                :format-options="{ style: 'currency', currency: 'EUR', maximumFractionDigits: 2 }"
                :min="COMPOUND_LIMITS.monthlySavings.min"
                :max="COMPOUND_LIMITS.monthlySavings.max"
                :step="50"
                inputmode="decimal"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Investment horizon" help="In years">
              <UInputNumber
                v-model.optional="form.years"
                :min="COMPOUND_LIMITS.years.min"
                :max="COMPOUND_LIMITS.years.max"
                :step="1"
                :format-options="{ maximumFractionDigits: 0 }"
                inputmode="numeric"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Annual interest rate (%)" help="Yearly return, compounded monthly; savings are added at the end of each month.">
              <UInputNumber
                v-model.optional="form.annualRatePercent"
                locale="fr-FR"
                :format-options="{ maximumFractionDigits: 2 }"
                :min="COMPOUND_LIMITS.annualRatePercent.min"
                :max="COMPOUND_LIMITS.annualRatePercent.max"
                :step="0.5"
                :step-snapping="false"
                inputmode="decimal"
                class="w-full"
              />
            </UFormField>
          </div>
        </UCard>

        <div class="space-y-6 lg:col-span-2">
          <div class="grid gap-4 sm:grid-cols-3">
            <UCard v-for="t in tiles" :key="t.label">
              <p class="text-sm text-muted">
                {{ t.label }}
              </p>
              <p class="mt-2 text-2xl font-semibold text-highlighted tabular-nums">
                {{ t.value }}
              </p>
              <p class="mt-1 text-xs text-muted">
                {{ t.hint }}
              </p>
            </UCard>
          </div>

          <UCard>
            <template #header>
              <h2 class="font-semibold text-highlighted">
                Growth over {{ lastValid.years }} {{ lastValid.years === 1 ? 'year' : 'years' }}
              </h2>
              <p class="text-sm text-muted">
                Value at the end of each year
              </p>
            </template>
            <HistoryChart
              :rows="rows"
              :series="series"
              :format-x="yearLabel"
              legend
              :height="320"
              label="Capital with interest and amount paid in, by year"
            />
          </UCard>
        </div>
      </div>
    </UPageBody>
  </UPage>
</template>
