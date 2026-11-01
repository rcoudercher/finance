<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import { CalendarDate, parseDate } from '@internationalized/date'
import { z } from 'zod'
import type { ValuationDTO } from '#shared/types/api'
import { parisDate } from '#shared/utils/dates'
import { currencyDecimals, minorToDecimal } from '#shared/utils/money'

const props = defineProps<{
  assetId: string
  currency: string
  /** Valuation to correct; omit to record a new one. */
  valuation?: ValuationDTO | null
}>()

const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ saved: [ValuationDTO] }>()
const toast = useToast()

const today = parisDate()
const decimals = computed(() => currencyDecimals(props.currency))
/** Largest amount the API accepts: 9 999 999 999 999.99 EUR, 9 999 999.99999999 BTC. */
const maxAmount = computed(() => (10 ** 15 - 1) / 10 ** decimals.value)
const schema = z.object({
  date: z.string().min(1, 'Date is required').refine(d => d <= today, 'Date cannot be in the future'),
  value: z.number({ error: 'Balance is required' })
    .refine(v => Math.abs(v) <= maxAmount.value, 'Amount is out of range'),
  source: z.enum(['manual', 'import', 'api']),
})
type Schema = z.output<typeof schema>

const state = reactive<Partial<Schema>>({})
const dateValue = shallowRef<CalendarDate | undefined>()
const saving = ref(false)

watch(open, (isOpen) => {
  if (!isOpen) return
  const v = props.valuation
  state.date = v?.date ?? today
  state.value = v ? Number(v.value) : undefined
  state.source = v?.source ?? 'manual'
  dateValue.value = parseDate(state.date)
}, { immediate: true })

function onDate(value: unknown) {
  const d = value as CalendarDate | undefined
  dateValue.value = d
  state.date = d ? d.toString() : ''
}

// French number format: comma decimals and space grouping ("1 234,56 €", "0,1 BTC"). The parser rejects a dot.
const amountFormat = computed(() => amountFormatOptions(props.currency))

/** The API takes amounts as exact decimal strings; round to the currency's minor unit (cent, satoshi) first. */
function toDecimalString(value: number): string {
  return minorToDecimal(Math.round(value * 10 ** decimals.value), decimals.value)
}

const balanceHelp = computed(() => (decimals.value === 2
  ? `Total value in ${props.currency}, with a decimal comma, e.g. 1 234,56`
  : `Total quantity in ${props.currency} (up to ${decimals.value} decimals), with a decimal comma, e.g. 0,1. Converted to EUR with the daily rate.`))

async function onSubmit(event: FormSubmitEvent<Schema>) {
  saving.value = true
  try {
    const saved = props.valuation
      ? await $fetch<ValuationDTO>(`/api/valuations/${props.valuation.id}`, { method: 'PATCH', body: { ...event.data, value: toDecimalString(event.data.value) } })
      : await $fetch<ValuationDTO>(`/api/assets/${props.assetId}/valuations`, { method: 'POST', body: { ...event.data, value: toDecimalString(event.data.value) } })
    toast.add({ title: props.valuation ? 'Valuation updated' : 'Valuation added', color: 'success', icon: 'i-lucide-check' })
    open.value = false
    emit('saved', saved)
  }
  catch (e) {
    toast.add({ title: 'Could not save valuation', description: apiErrorMessage(e), color: 'error', icon: 'i-lucide-triangle-alert' })
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="open"
    :title="valuation ? 'Correct valuation' : 'Add valuation'"
    :description="decimals === 2 ? 'The total balance of the asset on that date.' : `The ${currency} you held on that date.`"
  >
    <template #body>
      <UForm id="valuation-form" :schema="schema" :state="state" class="space-y-4" @submit="onSubmit">
        <UFormField label="Date" name="date" required>
          <UInputDate
            :model-value="dateValue as any"
            locale="en-GB"
            :max-value="parseDate(today)"
            class="w-full"
            @update:model-value="onDate"
          />
        </UFormField>

        <UFormField :label="decimals === 2 ? 'Balance' : 'Quantity'" name="value" required :help="balanceHelp">
          <UInputNumber
            v-model.optional="state.value"
            locale="fr-FR"
            :format-options="amountFormat"
            :step="1 / 10 ** decimals"
            :step-snapping="false"
            :increment="false"
            :decrement="false"
            disable-wheel-change
            inputmode="decimal"
            :placeholder="decimals === 2 ? '0,00' : '0'"
            class="w-full"
          />
        </UFormField>

        <UFormField label="Source" name="source">
          <USelect v-model="state.source" :items="[...SOURCE_OPTIONS]" class="w-full" />
        </UFormField>
      </UForm>
    </template>

    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton color="neutral" variant="outline" label="Cancel" @click="open = false" />
        <UButton type="submit" form="valuation-form" label="Save" :loading="saving" />
      </div>
    </template>
  </UModal>
</template>
