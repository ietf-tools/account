export default async function healthRoutes(app) {
  app.get('/health', async () => ({ status: 'ok' }))
}
