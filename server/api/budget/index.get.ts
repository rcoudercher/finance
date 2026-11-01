import { budgetMonthQuerySchema } from '../../../shared/utils/validation'

// GET /api/budget?month=YYYY-MM -> the budget in effect that month (defaults to the current month)
export default defineEventHandler((event) => {
  const q = parseQuery(event, budgetMonthQuerySchema)
  return handleDomain(() => budgetMonth(useDb(), q.month))
})
