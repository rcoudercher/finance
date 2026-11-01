<script setup lang="ts">
// Month picker (YYYY-MM): a month select and a year field. Native <input type="month"> is missing in desktop Safari and Firefox.

const model = defineModel<string>({ required: true })

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const monthItems = MONTHS.map((label, i) => ({ label, value: String(i + 1).padStart(2, '0') }))

const year = computed({
  get: () => Number(model.value.slice(0, 4)),
  set: (y: number | null | undefined) => {
    if (y && y >= 1900 && y <= 2999) model.value = `${y}-${model.value.slice(5, 7)}`
  },
})

const month = computed({
  get: () => model.value.slice(5, 7),
  set: (m: string) => {
    model.value = `${model.value.slice(0, 4)}-${m}`
  },
})
</script>

<template>
  <div class="flex gap-2">
    <USelect v-model="month" :items="monthItems" class="min-w-36 flex-1" aria-label="Month" />
    <UInputNumber
      v-model="year"
      :min="1900"
      :max="2999"
      :format-options="{ useGrouping: false }"
      class="w-32"
      aria-label="Year"
    />
  </div>
</template>
