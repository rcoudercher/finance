import { budgetHistoryQuerySchema } from '../../../shared/utils/validation'

// GET /api/budget/history?range=12M|24M|ALL or ?from=YYYY-MM&to=YYYY-MM -> monthly totals and amount changes
export default defineEventHandler((event) => {
  const q = parseQuery(event, budgetHistoryQuerySchema)
  return handleDomain(() => budgetHistory(useDb(), q))
})
