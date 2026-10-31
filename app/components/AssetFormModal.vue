<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import { z } from 'zod'
import type { AssetDetailDTO, AssetDTO } from '#shared/types/api'
import { SUPPORTED_CURRENCIES } from '#shared/utils/money'

const props = defineProps<{
  /** Asset to edit; omit to create a new one. */
  asset?: AssetDTO | null
}>()

const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ saved: [AssetDetailDTO] }>()

const toast = useToast()

const schema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100),
  category: z.enum(['bank', 'investment', 'crypto', 'real_estate', 'cash', 'other']),
  currency: z.enum(SUPPORTED_CURRENCIES),
  description: z.string().max(1000).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Pick a color').optional(),
})
type Schema = z.output<typeof schema>

const state = reactive<Partial<Schema>>({})
const useColor = ref(false)
const saving = ref(false)

watch(open, (isOpen) => {
  if (!isOpen) return
  const a = props.asset
  state.name = a?.name ?? ''
  state.category = a?.category ?? 'bank'
  state.currency = (a?.currency as Schema['currency']) ?? 'EUR'
  state.description = a?.description ?? ''
  state.color = a?.color ?? a?.displayColor ?? '#3b82f6'
  useColor.value = !!a?.color
}, { immediate: true })

const currencyItems = SUPPORTED_CURRENCIES.map(c => ({ label: c, value: c }))
const currencyLocked = computed(() => !!props.asset?.currencyLocked)

async function onSubmit(event: FormSubmitEvent<Schema>) {
  saving.value = true
  const body = {
    name: event.data.name,
    category: event.data.category,
    ...(currencyLocked.value ? {} : { currency: event.data.currency }),
    description: event.data.description?.trim() || null,
    color: useColor.value ? event.data.color : null,
  }
  try {
    const saved = props.asset
      ? await $fetch<AssetDetailDTO>(`/api/assets/${props.asset.id}`, { method: 'PATCH', body })
      : await $fetch<AssetDetailDTO>('/api/assets', { method: 'POST', body: { ...body, currency: event.data.currency } })
    toast.add({ title: props.asset ? 'Asset updated' : 'Asset created', color: 'success', icon: 'i-lucide-check' })
    open.value = false
    emit('saved', saved)
  }
  catch (e) {
    toast.add({ title: 'Could not save asset', description: apiErrorMessage(e), color: 'error', icon: 'i-lucide-triangle-alert' })
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <UModal v-model:open="open" :title="asset ? 'Edit asset' : 'New asset'" :description="asset ? asset.name : 'Track a bank account, investment, property or other holding.'">
    <template #body>
      <UForm id="asset-form" :schema="schema" :state="state" class="space-y-4" @submit="onSubmit">
        <UFormField label="Name" name="name" required>
          <UInput v-model="state.name" class="w-full" autofocus />
        </UFormField>

        <UFormField label="Category" name="category" required>
          <USelect v-model="state.category" :items="[...CATEGORY_OPTIONS]" class="w-full" />
        </UFormField>

        <UFormField
          label="Currency"
          name="currency"
          required
          :help="currencyLocked ? 'Locked because this asset already has valuations.' : 'Only EUR assets are included in totals.'"
        >
          <USelect v-model="state.currency" :items="currencyItems" :disabled="currencyLocked" class="w-full" />
        </UFormField>

        <UFormField label="Description" name="description">
          <UTextarea v-model="state.description" :rows="3" autoresize class="w-full" />
        </UFormField>

        <UFormField name="color" label="Color" :help="useColor ? undefined : 'An automatic color is used.'">
          <div class="space-y-3">
            <USwitch v-model="useColor" label="Custom color" />
            <UColorPicker v-if="useColor" v-model="state.color" />
          </div>
        </UFormField>
      </UForm>
    </template>

    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton color="neutral" variant="outline" label="Cancel" @click="open = false" />
        <UButton type="submit" form="asset-form" label="Save" :loading="saving" />
      </div>
    </template>
  </UModal>
</template>
