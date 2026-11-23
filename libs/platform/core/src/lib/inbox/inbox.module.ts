import {
  type DynamicModule,
  Global,
  Logger,
  Module,
  type Provider,
} from '@nestjs/common';
import { PolicyService } from '../acm/policy.service';
import { LogMailer, type Mailer, ResendMailer } from '../auth/mailer';
import { InboxService } from './inbox.service';

export const MAILER = Symbol.for('dax.platform-core.mailer');

export interface MailOptions {
  resend?: { apiKey: string; from: string };
}

export function mailerProvider(options: MailOptions = {}): Provider {
  return {
    provide: MAILER,
    useFactory: (): Mailer => {
      if (options.resend) {
        return new ResendMailer(options.resend.apiKey, options.resend.from);
      }
      const logger = new Logger('Mail');
      return new LogMailer((fields, message) => logger.warn(fields, message));
    },
  };
}

/** Inbox and mail for the worker, which runs without the HTTP platform module. */
@Global()
@Module({})
export class WorkerMessagingModule {
  static forRoot(options: MailOptions = {}): DynamicModule {
    return {
      module: WorkerMessagingModule,
      providers: [PolicyService, InboxService, mailerProvider(options)],
      exports: [PolicyService, InboxService, MAILER],
    };
  }
}
