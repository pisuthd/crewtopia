import type { APIGatewayProxyHandler } from 'aws-lambda';

// Fallback for unmatched routes (proxy: false + explicit resources).
// Anything reaching here is not a real route — 404, never a false 200.
export const handler: APIGatewayProxyHandler = async () => ({
  statusCode: 404,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ error: 'unknown route' }),
});
