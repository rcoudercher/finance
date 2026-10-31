import { assetUpdateSchema } from '../../../shared/utils/validation'

export default defineEventHandler(async (event) => {
  const id = requireParam(event, 'id')
  const input = await parseBody(event, assetUpdateSchema)
  return handleDomain(() => updateAsset(useDb(), id, input))
})
