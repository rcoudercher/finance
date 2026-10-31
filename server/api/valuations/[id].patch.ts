import { valuationUpdateSchema } from '../../../shared/utils/validation'

export default defineEventHandler(async (event) => {
  const id = requireParam(event, 'id')
  const input = await parseBody(event, valuationUpdateSchema)
  return handleDomain(() => updateValuation(useDb(), id, input))
})
