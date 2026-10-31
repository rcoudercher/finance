import type { H3Event } from 'h3'
import type { z } from 'zod'
import { DomainError } from './repository'

// Consistent JSON error shape: { statusCode, statusMessage, message, data?: { issues } }

export function badRequest(message: string, issues?: { path: string, message: string }[]): never {
  throw createError({ statusCode: 400, statusMessage: 'Bad Request', message, data: { issues: issues ?? [] } })
}

export function notFound(what: string): never {
  throw createError({ statusCode: 404, statusMessage: 'Not Found', message: `${what} not found` })
}

export function conflict(message: string): never {
  throw createError({ statusCode: 409, statusMessage: 'Conflict', message })
}

function fail(error: z.ZodError): never {
  const issues = error.issues.map(i => ({ path: i.path.join('.'), message: i.message }))
  badRequest(issues.map(i => (i.path ? `${i.path}: ${i.message}` : i.message)).join('; '), issues)
}

export async function parseBody<S extends z.ZodType>(event: H3Event, schema: S): Promise<z.output<S>> {
  let body: unknown
  try {
    body = await readBody(event)
  }
  catch {
    badRequest('Request body must be valid JSON')
  }
  const result = schema.safeParse(body ?? {})
  if (!result.success) fail(result.error)
  return result.data
}

export function parseQuery<S extends z.ZodType>(event: H3Event, schema: S): z.output<S> {
  const result = schema.safeParse(getQuery(event))
  if (!result.success) fail(result.error)
  return result.data
}

export function requireParam(event: H3Event, name: string): string {
  const value = getRouterParam(event, name)
  if (!value || value.length > 100) badRequest(`Invalid ${name}`)
  return value
}

/** Run a route body, mapping DomainError to a consistent HTTP error. */
export function handleDomain<T>(fn: () => T): T {
  try {
    return fn()
  }
  catch (e) {
    if (e instanceof DomainError) {
      if (e.status === 404) notFound(e.message.replace(/ not found$/, ''))
      if (e.status === 409) conflict(e.message)
      badRequest(e.message)
    }
    throw e
  }
}
