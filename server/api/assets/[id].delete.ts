export default defineEventHandler((event) => {
  const id = requireParam(event, 'id')
  handleDomain(() => deleteAsset(useDb(), id))
  setResponseStatus(event, 204)
  return null
})
