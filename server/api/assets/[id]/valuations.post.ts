import { valuationCreateSchema } from '../../../../shared/utils/validation'

export default defineEventHandler(async (event) => {
  const id = requireParam(event, 'id')
  const input = await parseBody(event, valuationCreateSchema)
  setResponseStatus(event, 201)
  return handleDomain(() => createValuation(useDb(), id, input))
})
