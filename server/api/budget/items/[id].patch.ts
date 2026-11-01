import { budgetItemUpdateSchema } from '../../../../shared/utils/validation'

export default defineEventHandler(async (event) => {
  const id = requireParam(event, 'id')
  const input = await parseBody(event, budgetItemUpdateSchema)
  return handleDomain(() => updateBudgetItem(useDb(), id, input))
})
