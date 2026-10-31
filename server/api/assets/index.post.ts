import { assetCreateSchema } from '../../../shared/utils/validation'

export default defineEventHandler(async (event) => {
  const input = await parseBody(event, assetCreateSchema)
  setResponseStatus(event, 201)
  return handleDomain(() => createAsset(useDb(), input))
})
