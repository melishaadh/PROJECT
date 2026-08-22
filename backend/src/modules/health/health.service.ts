import { Injectable, Logger } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(@InjectConnection() private readonly connection: Connection) {}

  async checkDatabase(): Promise<{
    status: 'ok' | 'error';
    database: string;
    readyState: number;
    host?: string;
    timestamp: string;
  }> {
    const readyState = this.connection.readyState;
    // 1 = connected, 2 = connecting, 3 = disconnecting, 0 = disconnected
    const isConnected = readyState === 1;

    const result = {
      status: (isConnected ? 'ok' : 'error') as 'ok' | 'error',
      database: this.connection.name || 'unknown',
      readyState,
      host: this.connection.host || undefined,
      timestamp: new Date().toISOString(),
    };

    if (isConnected) {
      this.logger.log(`Health check OK — connected to "${result.database}" at ${result.host}`);
    } else {
      this.logger.warn(`Health check FAILED — readyState=${readyState}`);
    }

    return result;
  }
}
