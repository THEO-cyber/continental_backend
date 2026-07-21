import { Injectable } from '@nestjs/common';
import { Server } from 'socket.io';

/**
 * Broadcast surface used by the domain services.
 * Rooms: 'public' (client sites), 'workers', 'superadmin'.
 * Public sockets only ever receive a lightweight "catalog changed" ping —
 * prices, quantities and sales data are never broadcast to them.
 */
@Injectable()
export class RealtimeService {
  private server: Server | null = null;

  attach(server: Server): void {
    this.server = server;
  }

  /** Any product create/update/delete/stock or public-settings change. */
  catalogChanged(): void {
    this.server?.to('public').emit('catalog:changed', { at: Date.now() });
  }

  /** A worker recorded a sale — full details go to superadmin only. */
  saleRecorded(sale: unknown): void {
    this.server?.to('superadmin').emit('sale:recorded', sale);
  }
}
