import { ratesQuerySchema } from '../../../shared/utils/validation'

// GET /api/rates?currency=BTC[&from=YYYY-MM-DD&to=YYYY-MM-DD] -> [{ date, rate, source }] (EUR per unit, oldest first)
export default defineEventHandler((event) => {
  const query = parseQuery(event, ratesQuerySchema)
  return listRates(useDb(), query)
})
