<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import { z } from 'zod'
import type { BudgetItemDetailDTO, BudgetItemDTO } from '#shared/types/api'
import { parisDate } from '#shared/utils/dates'
import { monthOf } from '#shared/utils/budget'
import { minorToDecimal } from '#shared/utils/money'

const props = defineProps<{
  /** Item to edit; omit to create a new one (which also takes its first monthly amount). */
  item?: BudgetItemDTO | null
  /** Default first month for a new item. */
  defaultMonth?: string
}>()

const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ saved: [BudgetItemDetailDTO] }>()
const toast = useToast()

const schema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100),
  kind: z.enum(['income', 'expense']),
  notes: z.string().max(1000).optional(),
  month: z.string().regex(/^\d{4}-\d{2}$/),
  amount: z.number({ error: 'Amount is required' }).optional(),
})
type Schema = z.output<typeof schema>

const state = reactive<Partial<Schema>>({})
const saving = ref(false)

watch(open, (isOpen) => {
  if (!isOpen) return
  const i = props.item
  state.name = i?.name ?? ''
  state.kind = i?.kind ?? 'expense'
  state.notes = i?.notes ?? ''
  state.month = props.defaultMonth ?? monthOf(parisDate())
  state.amount = undefined
}, { immediate: true })

function validate(s: Partial<Schema>) {
  if (props.item) return []
  if (s.amount === undefined || s.amount === null) return [{ name: 'amount', message: 'Amount is required' }]
  if (s.amount <= 0) return [{ name: 'amount', message: 'The first amount must be greater than zero' }]
  if (s.amount > 9_999_999_999_999.99) return [{ name: 'amount', message: 'Amount is out of range' }]
  return []
}

async function onSubmit(event: FormSubmitEvent<Schema>) {
  saving.value = true
  const fields = { name: event.data.name, kind: event.data.kind, notes: event.data.notes?.trim() || null }
  try {
    const saved = props.item
      ? await $fetch<BudgetItemDetailDTO>(`/api/budget/items/${props.item.id}`, { method: 'PATCH', body: fields })
      : await $fetch<BudgetItemDetailDTO>('/api/budget/items', {
          method: 'POST',
          body: { ...fields, month: event.data.month, amount: minorToDecimal(Math.round(event.data.amount! * 100)) },
        })
    toast.add({ title: props.item ? 'Budget item updated' : 'Budget item created', color: 'success', icon: 'i-lucide-check' })
    open.value = false
    emit('saved', saved)
  }
  catch (e) {
    toast.add({ title: 'Could not save budget item', description: apiErrorMessage(e), color: 'error', icon: 'i-lucide-triangle-alert' })
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="open"
    :title="item ? 'Edit budget item' : 'New budget item'"
    :description="item ? item.name : 'A recurring monthly income or expense, like a salary, rent or a subscription.'"
  >
    <template #body>
      <UForm id="budget-item-form" :schema="schema" :validate="validate" :state="state" class="space-y-4" @submit="onSubmit">
        <UFormField label="Name" name="name" required>
          <UInput v-model="state.name" class="w-full" autofocus />
        </UFormField>

        <UFormField label="Kind" name="kind" required>
          <URadioGroup v-model="state.kind" :items="[...BUDGET_KIND_OPTIONS]" orientation="horizontal" />
        </UFormField>

        <template v-if="!item">
          <UFormField label="From" name="month" required help="The first month this amount applies.">
            <MonthInput v-model="state.month!" />
          </UFormField>

          <UFormField label="Monthly amount" name="amount" required help="In EUR, with a decimal comma, e.g. 950 or 12,99">
            <UInputNumber
              v-model.optional="state.amount"
              locale="fr-FR"
              :format-options="amountFormatOptions('EUR')"
              :step="0.01"
              :step-snapping="false"
              :increment="false"
              :decrement="false"
              :min="0"
              disable-wheel-change
              inputmode="decimal"
              placeholder="0,00"
              class="w-full"
            />
          </UFormField>
        </template>

        <UFormField label="Notes" name="notes">
          <UTextarea v-model="state.notes" :rows="2" autoresize class="w-full" />
        </UFormField>
      </UForm>
    </template>

    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton color="neutral" variant="outline" label="Cancel" @click="open = false" />
        <UButton type="submit" form="budget-item-form" label="Save" :loading="saving" />
      </div>
    </template>
  </UModal>
</template>
