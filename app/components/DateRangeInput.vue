<script setup lang="ts">
import { CalendarDate, parseDate } from '@internationalized/date'

export interface IsoRange {
  from: string
  to: string
}

const props = defineProps<{
  /** The range currently applied; the inputs resync whenever it changes. */
  modelValue: IsoRange | null
  /** Latest selectable date (YYYY-MM-DD). */
  max?: string
}>()

const emit = defineEmits<{ 'update:modelValue': [IsoRange] }>()

const inputDate = useTemplateRef('inputDate')

interface Range { start?: CalendarDate, end?: CalendarDate }

function toRange(r: IsoRange | null): Range {
  return r ? { start: parseDate(r.from), end: parseDate(r.to) } : {}
}

const local = shallowRef<Range>(toRange(props.modelValue))
const maxValue = computed(() => (props.max ? parseDate(props.max) : undefined))

watch(() => props.modelValue, (v) => {
  local.value = toRange(v)
})

// Apply immediately once a complete, valid range exists. Incomplete or invalid input keeps the current chart.
function onChange(value: unknown) {
  const r = (value ?? {}) as Range
  local.value = r
  if (!r.start || !r.end) return
  if (r.start.compare(r.end) > 0) return
  if (maxValue.value && r.end.compare(maxValue.value) > 0) return
  const next = { from: r.start.toString(), to: r.end.toString() }
  if (next.from === props.modelValue?.from && next.to === props.modelValue?.to) return
  emit('update:modelValue', next)
}
</script>

<template>
  <UInputDate
    ref="inputDate"
    :model-value="local as any"
    range
    locale="en-GB"
    :max-value="maxValue"
    class="w-full sm:w-auto"
    @update:model-value="onChange"
  >
    <template #trailing>
      <UPopover :reference="inputDate?.inputsRef[0]?.$el" :content="{ align: 'end', collisionPadding: 8 }">
        <UButton
          color="neutral"
          variant="link"
          size="sm"
          icon="i-lucide-calendar"
          aria-label="Select a date range"
          class="px-0"
        />
        <template #content>
          <UCalendar
            :model-value="local as any"
            range
            locale="en-GB"
            :number-of-months="2"
            :max-value="maxValue"
            class="p-2"
            @update:model-value="onChange"
          />
        </template>
      </UPopover>
    </template>
  </UInputDate>
</template>
