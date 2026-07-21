import { OnGatewayConnection, OnGatewayInit, WebSocketGateway } from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import { RealtimeService } from './realtime.service';

@WebSocketGateway({ cors: { origin: true } })
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection {
  constructor(
    private readonly jwt: JwtService,
    private readonly realtime: RealtimeService,
  ) {}

  afterInit(server: Server): void {
    this.realtime.attach(server);
  }

  handleConnection(socket: Socket): void {
    const token: string | undefined = socket.handshake.auth?.token;
    let role = '';
    if (token) {
      try {
        role = (this.jwt.verify(token) as { role?: string }).role || '';
      } catch {
        role = '';
      }
    }
    if (role === 'superadmin') {
      socket.join('superadmin');
      socket.join('workers');
    } else if (role === 'worker') {
      socket.join('workers');
    }
    socket.join('public');
  }
}
