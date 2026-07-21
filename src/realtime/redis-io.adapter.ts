import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import { ServerOptions } from 'socket.io';

/**
 * Horizontal-scaling seam: when REDIS_URL is set, Socket.IO events are relayed
 * through Redis pub/sub so any number of server replicas behind a load balancer
 * broadcast to every connected client. Without REDIS_URL the app runs
 * single-instance with the default in-memory adapter.
 */
export class RedisIoAdapter extends IoAdapter {
  private adapterConstructor?: ReturnType<typeof createAdapter>;

  async connectToRedis(redisUrl: string): Promise<void> {
    const pubClient = new Redis(redisUrl, { maxRetriesPerRequest: 3 });
    const subClient = pubClient.duplicate();
    this.adapterConstructor = createAdapter(pubClient, subClient);
  }

  createIOServer(port: number, options?: ServerOptions) {
    const server = super.createIOServer(port, options);
    if (this.adapterConstructor) server.adapter(this.adapterConstructor);
    return server;
  }
}
