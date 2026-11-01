import { budgetItemCreateSchema } from '../../../../shared/utils/validation'

// POST /api/budget/items { name, kind, category, notes?, month, amount } -> item with its first amount
export default defineEventHandler(async (event) => {
  const input = await parseBody(event, budgetItemCreateSchema)
  setResponseStatus(event, 201)
  return handleDomain(() => createBudgetItem(useDb(), input))
})
