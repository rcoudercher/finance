// Unknown API routes return a JSON 404 instead of falling through to the app.
export default defineEventHandler(() => notFound('API route'))
