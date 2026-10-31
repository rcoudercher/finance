export default defineEventHandler((event) => {
  const id = requireParam(event, 'id')
  return handleDomain(() => getAsset(useDb(), id))
})
