import { tmpdir } from "node:os";
import { join } from "node:path";
import { Global, Inject, Logger, Module, type OnModuleInit } from "@nestjs/common";
import { ENV, type Env } from "../../config/env";
import { DOCUMENT_STORAGE } from "./document-storage";
import { LocalDiskStorage } from "./local-disk.storage";

/**
 * Provides the one `DocumentStorage` the application uses.
 *
 * THE SWAP TO OBJECT STORAGE IS THIS FILE. Write an `S3Storage` with the same
 * four methods, choose between them here on an env variable, and no repository,
 * controller or test changes. That is the whole reason the interface exists;
 * assessment 12 wants object storage and the business runs a disk today, and
 * this defers that decision without letting it leak into the modules.
 *
 * Global, like ConfigModule, so a feature module need not import it to inject
 * the token.
 */
@Global()
@Module({
  providers: [
    {
      provide: DOCUMENT_STORAGE,
      inject: [ENV],
      useFactory: (env: Env) => new LocalDiskStorage(storageRoot(env)),
    },
  ],
  exports: [DOCUMENT_STORAGE],
})
export class StorageModule implements OnModuleInit {
  private readonly logger = new Logger(StorageModule.name);

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(DOCUMENT_STORAGE) private readonly storage: LocalDiskStorage,
  ) {}

  /**
   * Proves the directory exists and is writable at BOOT.
   *
   * The alternative is finding out on someone's first upload of the day, as a
   * 500 with a stack trace, an unknown number of deploys after the permissions
   * changed.
   */
  async onModuleInit(): Promise<void> {
    await this.storage.verifyWritable();
    this.logger.log(`Document storage: local disk at ${storageRoot(this.env)}`);
  }
}

/**
 * Production must say where. Everywhere else gets a sensible throwaway.
 *
 * The development default is the OS temp directory rather than somewhere in the
 * repository: development already runs on an in-memory PGlite that is reseeded
 * on every restart, so an upload's row does not survive a restart either, and
 * writing the orphaned bytes into the working tree would only leave litter for
 * `git status` to find.
 */
export function storageRoot(env: Env): string {
  if (env.STORAGE_DIR) {
    return env.STORAGE_DIR;
  }
  return join(tmpdir(), `accountbook-uploads-${env.NODE_ENV}`);
}
