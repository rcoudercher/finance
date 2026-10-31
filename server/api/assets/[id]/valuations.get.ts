import { valuationListQuerySchema } from '../../../../shared/utils/validation'

export default defineEventHandler((event) => {
  const id = requireParam(event, 'id')
  const query = parseQuery(event, valuationListQuerySchema)
  return handleDomain(() => listValuations(useDb(), id, query))
})
