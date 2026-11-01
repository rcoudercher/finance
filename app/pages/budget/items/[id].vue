<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { BudgetAmountDTO, BudgetItemDetailDTO } from '#shared/types/api'
import type { ChartRow } from '~/components/HistoryChart.vue'
import { addMonthsToMonth, monthOf, monthsBetween } from '#shared/utils/budget'
import { parisDate } from '#shared/utils/dates'
import { minorToDecimal, parseDecimalToMinor } from '#shared/utils/money'

const route = useRoute()
const id = computed(() => String(route.params.id))
const toast = useToast()
const currentMonth = monthOf(parisDate())

const { data: item, error, refresh } = await useFetch<BudgetItemDetailDTO>(() => `/api/budget/items/${id.value}`)
if (error.value?.statusCode === 404) {
  throw createError({ statusCode: 404, statusMessage: 'Budget item not found', fatal: true })
}

useHead({ title: () => `${item.value?.name ?? 'Budget item'} · Finance` })

const kindColor = computed(() => (item.value?.kind === 'income' ? 'success' : 'error'))

// Chart: the amount in effect each month, from the first amount to the later of now and the last change.
const chartRows = computed<ChartRow[]>(() => {
  const i = item.value
  if (!i || !i.startMonth) return []
  const ascending = [...i.amounts].reverse()
  const last = ascending.at(-1)!.month
  const end = last > currentMonth ? last : currentMonth
  // Start one month earlier so a single change still draws a line.
  const start = addMonthsToMonth(i.startMonth, -1)
  return monthsBetween(start, end).map((m) => {
    let inEffect: BudgetAmountDTO | undefined
    for (const a of ascending) {
      if (a.month > m) break
      inEffect = a
    }
    return { date: m, values: { amount: inEffect?.amount ?? null }, notes: m > currentMonth ? ['Planned'] : [] }
  })
})

// Modals
const editOpen = ref(false)
const amountOpen = ref(false)
const editingAmount = ref<BudgetAmountDTO | null>(null)

function changeAmount() {
  editingAmount.value = null
  amountOpen.value = true
}

function correctAmount(a: BudgetAmountDTO) {
  editingAmount.value = a
  amountOpen.value = true
}

const removing = ref<BudgetAmountDTO | null>(null)
const removeOpen = computed({
  get: () => removing.value !== null,
  set: (v: boolean) => {
    if (!v) removing.value = null
  },
})
const removeBusy = ref(false)

async function confirmRemove() {
  if (!removing.value || !item.value) return
  removeBusy.value = true
  try {
    await $fetch(`/api/budget/items/${item.value.id}/amounts/${removing.value.month}`, { method: 'DELETE' })
    toast.add({ title: 'Change removed', color: 'success', icon: 'i-lucide-check' })
    removing.value = null
    await refresh()
  }
  catch (e) {
    toast.add({ title: 'Could not remove change', description: apiErrorMessage(e), color: 'error', icon: 'i-lucide-triangle-alert' })
  }
  finally {
    removeBusy.value = false
  }
}

const deleteOpen = ref(false)
const deleteBusy = ref(false)

async function confirmDelete() {
  if (!item.value) return
  const name = item.value.name
  deleteBusy.value = true
  try {
    await $fetch(`/api/budget/items/${item.value.id}`, { method: 'DELETE' })
    deleteOpen.value = false
    toast.add({ title: 'Budget item deleted', description: `${name} and its history were removed.`, color: 'success', icon: 'i-lucide-check' })
    await navigateTo('/budget')
  }
  catch (e) {
    toast.add({ title: 'Could not delete budget item', description: apiErrorMessage(e), color: 'error', icon: 'i-lucide-triangle-alert' })
  }
  finally {
    deleteBusy.value = false
  }
}

const UButton = resolveComponent('UButton')
const UBadge = resolveComponent('UBadge')

function diffLabel(a: BudgetAmountDTO) {
  if (a.previousAmount === null) return h(UBadge, { color: 'info', variant: 'subtle', size: 'sm', label: 'Start' })
  if (a.amount === '0.00') return h(UBadge, { color: 'neutral', variant: 'subtle', size: 'sm', label: 'Set to 0' })
  const d = parseDecimalToMinor(a.amount) - parseDecimalToMinor(a.previousAmount)
  if (d === 0) return h('span', { class: 'text-muted' }, 'No change')
  return h('span', { class: 'tabular-nums text-muted' }, `${d > 0 ? '+' : '−'}${formatMoney(minorToDecimal(Math.abs(d)))}`)
}

const columns = computed<TableColumn<BudgetAmountDTO>[]>(() => [
  {
    accessorKey: 'month',
    header: 'From',
    cell: ({ row }) => h('div', { class: 'flex items-center gap-2' }, [
      formatMonth(row.original.month),
      row.original.month > currentMonth ? h(UBadge, { color: 'info', variant: 'subtle', size: 'sm', label: 'Planned' }) : null,
    ]),
  },
  {
    accessorKey: 'amount',
    header: () => h('div', { class: 'text-right' }, 'Monthly'),
    cell: ({ row }) => h('div', { class: 'text-right tabular-nums text-highlighted' }, formatMoney(row.original.amount)),
  },
  { id: 'change', header: 'Change', cell: ({ row }) => diffLabel(row.original) },
  {
    accessorKey: 'updatedAt',
    header: 'Last edited',
    meta: { class: { th: 'hidden md:table-cell', td: 'hidden md:table-cell' } },
    cell: ({ row }) => formatTimestamp(row.original.updatedAt),
  },
  {
    id: 'actions',
    header: () => h('span', { class: 'sr-only' }, 'Actions'),
    cell: ({ row }) => h('div', { class: 'flex justify-end gap-1' }, [
      h(UButton, { icon: 'i-lucide-pencil', color: 'neutral', variant: 'ghost', size: 'sm', 'aria-label': 'Correct amount', onClick: () => correctAmount(row.original) }),
      h(UButton, {
        icon: 'i-lucide-trash-2',
        color: 'error',
        variant: 'ghost',
        size: 'sm',
        'aria-label': 'Remove change',
        disabled: (item.value?.amountCount ?? 0) <= 1,
        onClick: () => { removing.value = row.original },
      }),
    ]),
  },
])
</script>

<template>
  <UPage v-if="item">
    <UPageHeader :title="item.name" :description="item.notes ?? undefined" :headline="budgetKindLabel(item.kind)">
      <template #links>
        <UButton label="Edit" icon="i-lucide-pencil" color="neutral" variant="outline" @click="editOpen = true" />
        <UButton label="Change amount" icon="i-lucide-plus" @click="changeAmount" />
      </template>
    </UPageHeader>

    <UPageBody>
      <div class="grid gap-6 lg:grid-cols-3">
        <UCard>
          <template #header>
            <h2 class="font-semibold text-highlighted">
              This month
            </h2>
          </template>
          <template v-if="item.status === 'planned'">
            <p class="text-3xl font-semibold text-muted">
              Not started
            </p>
            <p class="mt-1 text-sm text-muted">
              Starts {{ formatMonth(item.startMonth) }}
            </p>
          </template>
          <template v-else>
            <p class="text-3xl font-semibold tabular-nums" :class="item.status === 'stopped' ? 'text-muted' : 'text-highlighted'">
              {{ formatMoney(item.currentAmount) }}
            </p>
            <p class="mt-1 text-sm text-muted">
              per month since {{ formatMonth(item.currentSince) }}
            </p>
          </template>
          <p v-if="item.nextChange" class="mt-3 text-sm text-info">
            → {{ formatMoney(item.nextChange.amount) }} from {{ formatMonth(item.nextChange.month) }}
          </p>
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
                Kind
              </dt>
              <dd>
                <UBadge :color="kindColor" variant="subtle" :label="budgetKindLabel(item.kind)" />
              </dd>
            </div>
            <div>
              <dt class="text-muted">
                Since
              </dt>
              <dd class="text-highlighted">
                {{ formatMonth(item.startMonth) }}
              </dd>
            </div>
            <div>
              <dt class="text-muted">
                Amount changes
              </dt>
              <dd class="text-highlighted">
                {{ item.amountCount }}
              </dd>
            </div>
            <div>
              <dt class="text-muted">
                Created / updated
              </dt>
              <dd class="text-highlighted">
                {{ formatTimestamp(item.createdAt) }} / {{ formatTimestamp(item.updatedAt) }}
              </dd>
            </div>
          </dl>
        </UCard>
      </div>

      <UCard>
        <template #header>
          <h2 class="font-semibold text-highlighted">
            Amount over time
          </h2>
          <p class="text-sm text-muted">
            Monthly amount, carried forward from each change
          </p>
        </template>
        <HistoryChart
          :rows="chartRows"
          :series="[{ key: 'amount', name: item.name, color: kindColor === 'success' ? 'var(--ui-success)' : 'var(--ui-error)' }]"
          monthly
          :height="240"
          :label="`${item.name} monthly amount over time`"
        />
      </UCard>

      <UCard :ui="{ body: 'p-0 sm:p-0' }">
        <template #header>
          <h2 class="font-semibold text-highlighted">
            History
          </h2>
          <p class="text-sm text-muted">
            Each change applies from its month until the next one
          </p>
        </template>
        <UTable :data="item.amounts" :columns="columns" />
      </UCard>

      <UAlert
        color="error"
        variant="subtle"
        icon="i-lucide-triangle-alert"
        title="Delete this item"
        :description="`To stop ${item.name}, change its amount to 0 instead: that keeps its history. Deleting removes the item and all ${item.amountCount} amounts, including from past months. This cannot be undone.`"
        orientation="horizontal"
        :actions="[{ label: 'Delete item', color: 'error', icon: 'i-lucide-trash-2', onClick: () => { deleteOpen = true } }]"
      />
    </UPageBody>

    <BudgetItemFormModal v-model:open="editOpen" :item="item" @saved="() => refresh()" />
    <BudgetAmountFormModal v-model:open="amountOpen" :item="item" :amount="editingAmount" @saved="() => refresh()" />

    <UModal v-model:open="removeOpen" title="Remove this change?" :description="removing ? `${formatMonth(removing.month)} · ${formatMoney(removing.amount)}` : undefined">
      <template #body>
        <p class="text-sm text-muted">
          The previous amount will carry on through that month instead.
        </p>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="outline" label="Cancel" @click="removing = null" />
          <UButton color="error" label="Remove" :loading="removeBusy" @click="confirmRemove" />
        </div>
      </template>
    </UModal>

    <UModal v-model:open="deleteOpen" :title="`Delete ${item.name}?`" :dismissible="!deleteBusy">
      <template #body>
        <p class="text-sm text-muted">
          This permanently deletes the item and its {{ item.amountCount }} {{ item.amountCount === 1 ? 'amount' : 'amounts' }}.
          It disappears from every month of the budget, past ones included. The only way back is restoring a database backup.
        </p>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="outline" label="Cancel" :disabled="deleteBusy" @click="deleteOpen = false" />
          <UButton color="error" icon="i-lucide-trash-2" label="Delete item and history" :loading="deleteBusy" @click="confirmDelete" />
        </div>
      </template>
    </UModal>
  </UPage>

  <UAlert v-else-if="error" color="error" variant="subtle" title="Could not load budget item" :description="apiErrorMessage(error)" class="my-8" />
</template>
