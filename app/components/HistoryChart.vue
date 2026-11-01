<script setup lang="ts">
import { colorLegend, colorLegendItems, defineChart, lineY } from '@tanstack/charts'
import { crosshair } from '@tanstack/charts/crosshair'
import { scaleLinear } from '@tanstack/charts/scales/linear'
import { scaleOrdinal } from '@tanstack/charts/scales/ordinal'
import { scalePoint } from '@tanstack/charts/scales/point'

export interface ChartSeries {
  key: string
  name: string
  color: string
}

export interface ChartRow {
  /** YYYY-MM-DD, or YYYY-MM when `monthly` is set. */
  date: string
  /** Decimal strings; null = unknown (rendered as a gap). */
  values: Record<string, string | null>
  /** Optional extra lines shown under the values in the tooltip (e.g. completeness warnings). */
  notes?: string[]
}

const props = withDefaults(defineProps<{
  rows: ChartRow[]
  series: ChartSeries[]
  currency?: string
  legend?: boolean
  height?: number
  label: string
  /** Rows are months (YYYY-MM) rather than days. */
  monthly?: boolean
  /** Custom label for a row key (axis ticks and tooltip title), for rows that are not dates. */
  formatX?: (key: string) => string
}>(), { currency: 'EUR', legend: false, height: 320, monthly: false })

interface Point {
  date: string
  key: string
  value: number | undefined
}

const points = computed<Point[]>(() => props.rows.flatMap(row => props.series.map((s) => {
  const raw = row.values[s.key]
  return { date: row.date, key: s.key, value: raw == null ? undefined : Number(raw) }
})))

const rowByDate = computed(() => new Map(props.rows.map(r => [r.date, r])))

// The vertical axis always includes zero, whatever the range or mode.
const yDomain = computed<[number, number]>(() => {
  let min = 0
  let max = 0
  for (const p of points.value) {
    if (p.value === undefined) continue
    if (p.value < min) min = p.value
    if (p.value > max) max = p.value
  }
  return [min, max === min ? min + 1 : max]
})

const tickValues = computed(() => {
  const dates = props.rows.map(r => r.date)
  if (dates.length <= 1) return dates
  const count = Math.min(6, dates.length)
  const picks = new Set<string>()
  for (let i = 0; i < count; i++) picks.add(dates[Math.round((i * (dates.length - 1)) / (count - 1))]!)
  return [...picks]
})

const tickFormat = computed(() => {
  if (props.formatX) return props.formatX
  if (props.monthly) return formatMonthShort
  const span = props.rows.length
  return span > 190 ? formatMonthYear : formatDateShort
})

const definition = computed(() => {
  const keys = props.series.map(s => s.key)
  const names = new Map(props.series.map(s => [s.key, s.name]))
  return defineChart({
    marks: [
      lineY(points.value, { x: 'date', y: 'value', z: 'key', color: 'key', strokeWidth: 2 }),
      crosshair({ x: true, y: false }),
    ],
    scales: {
      x: {
        scale: () => scalePoint<string>().padding(0),
        axis: { ticks: { values: tickValues.value, format: (d: string) => tickFormat.value(d) }, tickLabels: { thin: true } },
      },
      y: {
        scale: scaleLinear().domain(yDomain.value),
        nice: true,
        grid: true,
        axis: { ticks: { format: (v: number) => formatMoneyCompact(v, props.currency) } },
      },
    },
    color: {
      scale: scaleOrdinal<string, string>().domain(keys).range(props.series.map(s => s.color)),
      legend: props.legend
        ? colorLegend({ items: colorLegendItems({ justify: 'center', gap: 16, label: { format: (v: unknown) => names.get(String(v)) ?? String(v) } }) })
        : undefined,
    },
    focus: 'group-x',
    maxFocusDistance: Number.POSITIVE_INFINITY,
  })
})

function tooltipRow(focused: readonly { datum: unknown }[]) {
  const date = (focused[0]?.datum as Point | undefined)?.date
  return date ? rowByDate.value.get(date) : undefined
}
</script>

<template>
  <UChart :definition="definition" :height="height" :aria-label="label">
    <template #tooltip="{ points: focused }">
      <template v-if="tooltipRow(focused)">
        <p class="font-medium text-highlighted">
          {{ formatX ? formatX(tooltipRow(focused)!.date) : monthly ? formatMonth(tooltipRow(focused)!.date) : formatDate(tooltipRow(focused)!.date) }}
        </p>
        <div v-for="s in series" :key="s.key" class="flex items-center gap-1.5">
          <span class="size-2 shrink-0 rounded-full" :style="{ backgroundColor: s.color }" />
          <span class="truncate text-muted">{{ s.name }}</span>
          <span class="ms-auto ps-4 font-medium text-highlighted tabular-nums">
            {{ tooltipRow(focused)!.values[s.key] == null ? 'Unknown' : formatMoney(tooltipRow(focused)!.values[s.key], currency) }}
          </span>
        </div>
        <p v-for="note in tooltipRow(focused)!.notes ?? []" :key="note" class="text-warning">
          {{ note }}
        </p>
      </template>
    </template>
  </UChart>
</template>
