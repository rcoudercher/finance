import { budgetAmountSetSchema, monthString } from '../../../../../../shared/utils/validation'

// PUT /api/budget/items/:id/amounts/:month { amount } -> set the monthly amount from that month on ("0" = stopped)
export default defineEventHandler(async (event) => {
  const id = requireParam(event, 'id')
  const month = requireParam(event, 'month')
  if (!monthString.safeParse(month).success) badRequest('month must be a valid month in YYYY-MM format')
  const { amount } = await parseBody(event, budgetAmountSetSchema)
  return handleDomain(() => setBudgetAmount(useDb(), id, month, amount))
})
