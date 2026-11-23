import {
  type DynamicModule,
  Module,
  type ModuleMetadata,
} from '@nestjs/common';
import { z } from 'zod';
import {
  createLoggerModule,
  PUBLIC_ORIGINS,
  WorkerMessagingModule,
  WorkerModule,
} from '@dax/platform-core';
import { DatabaseModule } from '@dax/platform-db';

const blankAsUnset = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (v === '' ? undefined : v), schema.optional());

const WorkerEnvSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
    .default('info'),
  DATABASE_URL: z
    .string()
    .url()
    .refine(
      (url) => /^postgres(ql)?:\/\//.test(url),
      'DATABASE_URL must be a postgres:// URL',
    )
    .refine(
      (url) => !/\/\/(postgres|dax_migrator)[:@]/.test(url),
      'DATABASE_URL must use the app role',
    ),
  WORKER_POLL_MS: z.coerce.number().int().min(100).max(60_000).default(2000),
  WORKER_BATCH_SIZE: z.coerce.number().int().min(1).max(500).default(20),
  WORKER_HEARTBEAT_FILE: blankAsUnset(z.string().min(1)),
  WEB_ORIGIN: z.url().default('http://localhost:3000'),
  RESEND_API_KEY: blankAsUnset(z.string().min(1)),
  MAIL_FROM: blankAsUnset(z.string().min(3)),
});

export type WorkerEnv = z.infer<typeof WorkerEnvSchema>;

export function loadWorkerEnv(
  source: NodeJS.ProcessEnv = process.env,
): WorkerEnv {
  const parsed = WorkerEnvSchema.safeParse(source);
  if (!parsed.success) {
    const names = [
      ...new Set(parsed.error.issues.map((i) => i.path.join('.'))),
    ];
    throw new Error(`Invalid worker environment: ${names.join(', ')}`);
  }
  return parsed.data;
}

type ModuleImports = NonNullable<ModuleMetadata['imports']>;

@Module({})
export class WorkerAppModule {
  static forRoot(
    env: WorkerEnv,
    subscribers: ModuleImports = [],
  ): DynamicModule {
    return {
      module: WorkerAppModule,
      imports: [
        createLoggerModule({
          level: env.LOG_LEVEL,
          pretty: env.NODE_ENV === 'development',
        }),
        DatabaseModule.forRoot({
          url: env.DATABASE_URL,
          applicationName: 'dax-worker',
          poolMax: 5,
        }),
        WorkerModule.forRoot({
          pollIntervalMs: env.WORKER_POLL_MS,
          batchSize: env.WORKER_BATCH_SIZE,
          heartbeatFile: env.WORKER_HEARTBEAT_FILE,
        }),
        WorkerMessagingModule.forRoot({
          resend:
            env.RESEND_API_KEY && env.MAIL_FROM
              ? { apiKey: env.RESEND_API_KEY, from: env.MAIL_FROM }
              : undefined,
        }),
        ...subscribers,
      ],
      providers: [
        {
          provide: PUBLIC_ORIGINS,
          useValue: {
            web: env.WEB_ORIGIN,
            admin: env.WEB_ORIGIN,
            labels: env.WEB_ORIGIN,
          },
        },
      ],
      exports: [PUBLIC_ORIGINS],
      global: true,
    };
  }
}
