import { AppRoom, type Env } from './AppRoom';

export { AppRoom };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return new Response('ok', {
        headers: { 'Access-Control-Allow-Origin': env.FRONTEND_URL || '*' },
      });
    }

    if (url.pathname === '/connect') {
      // Single global room — mirrors the old ws-service's one-process
      // model. If you ever need to shard by e.g. region, derive the name
      // from a query param instead of a fixed string.
      const id = env.APP_ROOM.idFromName('global');
      const stub = env.APP_ROOM.get(id);
      return stub.fetch(request);
    }

    return new Response('Not found', { status: 404 });
  },
};
