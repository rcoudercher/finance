// DELETE /api/budget/items/:id -> removes the item and its whole amount history (204)
export default defineEventHandler((event) => {
  const id = requireParam(event, 'id')
  handleDomain(() => deleteBudgetItem(useDb(), id))
  setResponseStatus(event, 204)
  return null
})
