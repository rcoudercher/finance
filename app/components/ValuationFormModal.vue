<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import { CalendarDate, parseDate } from '@internationalized/date'
import { z } from 'zod'
import type { ValuationDTO } from '#shared/types/api'
import { parisDate } from '#shared/utils/dates'

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
const schema = z.object({
  date: z.string().min(1, 'Date is required').refine(d => d <= today, 'Date cannot be in the future'),
  value: z.string().trim().regex(/^-?\d{1,13}(\.\d{1,2})?$/, 'Use a number with at most two decimals, e.g. 1234.56'),
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
  state.value = v?.value ?? ''
  state.source = v?.source ?? 'manual'
  dateValue.value = parseDate(state.date)
}, { immediate: true })

function onDate(value: unknown) {
  const d = value as CalendarDate | undefined
  dateValue.value = d
  state.date = d ? d.toString() : ''
}

// Accept "1 234,56" style input by normalising spaces and a decimal comma.
function normaliseAmount() {
  if (state.value) state.value = state.value.replace(/[\s  ]/g, '').replace(',', '.')
}

async function onSubmit(event: FormSubmitEvent<Schema>) {
  saving.value = true
  try {
    const saved = props.valuation
      ? await $fetch<ValuationDTO>(`/api/valuations/${props.valuation.id}`, { method: 'PATCH', body: event.data })
      : await $fetch<ValuationDTO>(`/api/assets/${props.assetId}/valuations`, { method: 'POST', body: event.data })
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
    description="The total balance of the asset on that date."
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

        <UFormField label="Balance" name="value" required :help="`Total value in ${currency}, e.g. 1234.56`">
          <UInput v-model="state.value" inputmode="decimal" class="w-full" @blur="normaliseAmount">
            <template #trailing>
              <span class="text-xs text-muted">{{ currency }}</span>
            </template>
          </UInput>
        </UFormField>

        <UFormField label="Source" name="source">
          <USelect v-model="state.source" :items="[...SOURCE_OPTIONS]" class="w-full" />
        </UFormField>
      </UForm>
    </template>

    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton color="neutral" variant="outline" label="Cancel" @click="open = false" />
        <UButton type="submit" form="valuation-form" label="Save" :loading="saving" @click="normaliseAmount" />
      </div>
    </template>
  </UModal>
</template>
