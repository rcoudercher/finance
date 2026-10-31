import { dashboardQuerySchema } from '../../shared/utils/validation'

export default defineEventHandler((event) => {
  const query = parseQuery(event, dashboardQuerySchema)
  return handleDomain(() => dashboard(useDb(), query))
})
