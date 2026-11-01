<script setup lang="ts">
import type { BudgetAmountDTO, BudgetItemDetailDTO } from '#shared/types/api'
import { parisDate } from '#shared/utils/dates'
import { monthOf } from '#shared/utils/budget'
import { minorToDecimal } from '#shared/utils/money'

const props = defineProps<{
  item: BudgetItemDetailDTO
  /** Existing change to correct (its month is fixed); omit to set a new amount. */
  amount?: BudgetAmountDTO | null
}>()

const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ saved: [BudgetItemDetailDTO] }>()
const toast = useToast()

const month = ref(monthOf(parisDate()))
const value = ref<number | undefined>()
const saving = ref(false)

watch(open, (isOpen) => {
  if (!isOpen) return
  month.value = props.amount?.month ?? monthOf(parisDate())
  value.value = props.amount ? Number(props.amount.amount) : undefined
}, { immediate: true })

const existing = computed(() => (props.amount ? null : props.item.amounts.find(a => a.month === month.value) ?? null))
const isFirst = computed(() => !props.item.startMonth || month.value <= props.item.startMonth)

const error = computed(() => {
  if (value.value === undefined || value.value === null) return 'Amount is required'
  if (value.value < 0) return 'Amount cannot be negative'
  if (value.value > 9_999_999_999_999.99) return 'Amount is out of range'
  if (value.value === 0 && isFirst.value) return 'The first amount must be greater than zero'
  return null
})
const touched = ref(false)

async function save() {
  touched.value = true
  if (error.value) return
  saving.value = true
  try {
    const saved = await $fetch<BudgetItemDetailDTO>(`/api/budget/items/${props.item.id}/amounts/${month.value}`, {
      method: 'PUT',
      body: { amount: minorToDecimal(Math.round(value.value! * 100)) },
    })
    toast.add({ title: value.value === 0 ? `${props.item.name} set to 0` : 'Amount saved', color: 'success', icon: 'i-lucide-check' })
    open.value = false
    touched.value = false
    emit('saved', saved)
  }
  catch (e) {
    toast.add({ title: 'Could not save amount', description: apiErrorMessage(e), color: 'error', icon: 'i-lucide-triangle-alert' })
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="open"
    :title="amount ? `Correct ${formatMonth(amount.month)}` : 'Change amount'"
    :description="`${item.name}: the monthly amount from this month on, until the next change.`"
  >
    <template #body>
      <form id="budget-amount-form" class="space-y-4" @submit.prevent="save">
        <UFormField v-if="!amount" label="From" required>
          <MonthInput v-model="month" />
        </UFormField>

        <UFormField
          label="Monthly amount"
          required
          :error="touched ? error ?? undefined : undefined"
          help="In EUR. Set 0 when it stops; the history is kept."
        >
          <UInputNumber
            v-model.optional="value"
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
            autofocus
          />
        </UFormField>

        <UAlert
          v-if="existing"
          color="info"
          variant="subtle"
          icon="i-lucide-info"
          :description="`There is already an amount from ${formatMonth(existing.month)} (${formatMoney(existing.amount)}). Saving replaces it.`"
        />
      </form>
    </template>

    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton color="neutral" variant="outline" label="Cancel" @click="open = false" />
        <UButton type="submit" form="budget-amount-form" label="Save" :loading="saving" />
      </div>
    </template>
  </UModal>
</template>
