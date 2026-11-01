import { ratesUpsertSchema } from '../../../shared/utils/validation'

// PUT /api/rates { currency: "BTC", source, rates: [{ date, rate }] } -> insert or replace those days
export default defineEventHandler(async (event) => {
  const input = await parseBody(event, ratesUpsertSchema)
  return handleDomain(() => upsertRates(useDb(), input))
})
