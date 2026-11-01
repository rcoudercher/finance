import { monthString } from '../../../../../../shared/utils/validation'

// DELETE /api/budget/items/:id/amounts/:month -> undo the change made that month; the previous amount carries on
export default defineEventHandler((event) => {
  const id = requireParam(event, 'id')
  const month = requireParam(event, 'month')
  if (!monthString.safeParse(month).success) badRequest('month must be a valid month in YYYY-MM format')
  return handleDomain(() => deleteBudgetAmount(useDb(), id, month))
})
