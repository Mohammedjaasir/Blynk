import crypto from 'crypto';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import {
  notificationRepository,
  NotificationRepository,
} from './notification.repository.js';
import { notificationService, NotificationService } from './notification.service.js';

export interface WorkerOptions {
  intervalMs?: number;
  batchSize?: number;
  leaseTimeoutMs?: number;
  workerId?: string;
}

export class NotificationWorker {
  private timer: NodeJS.Timeout | null = null;
  private isProcessing = false;
  private isStopping = false;
  private activeDispatchPromise: Promise<number> | null = null;

  readonly workerId: string;
  readonly intervalMs: number;
  readonly batchSize: number;
  readonly leaseTimeoutMs: number;

  constructor(
    options: WorkerOptions = {},
    private repo: NotificationRepository = notificationRepository,
    private service: NotificationService = notificationService
  ) {
    this.workerId = options.workerId || `worker_${process.pid}_${crypto.randomBytes(4).toString('hex')}`;
    this.intervalMs = options.intervalMs ?? env.NOTIFICATION_WORKER_INTERVAL_MS;
    this.batchSize = options.batchSize ?? env.NOTIFICATION_WORKER_BATCH_SIZE;
    this.leaseTimeoutMs = options.leaseTimeoutMs ?? env.NOTIFICATION_PROCESSING_TIMEOUT_MS;
  }

  /**
   * Starts the background worker polling loop.
   */
  start(): void {
    if (this.timer) {
      logger.warn({ workerId: this.workerId }, 'NotificationWorker is already running');
      return;
    }

    this.isStopping = false;
    logger.info(
      {
        workerId: this.workerId,
        intervalMs: this.intervalMs,
        batchSize: this.batchSize,
        leaseTimeoutMs: this.leaseTimeoutMs,
      },
      'Starting Notification Outbox Worker daemon'
    );

    this.timer = setInterval(() => {
      void this.tick();
    }, this.intervalMs);

    // Run first batch immediately
    void this.tick();
  }

  /**
   * Gracefully stops the worker loop and awaits completion of any in-flight batch.
   */
  async stop(): Promise<void> {
    this.isStopping = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    if (this.activeDispatchPromise) {
      logger.info({ workerId: this.workerId }, 'Waiting for active notification batch to complete...');
      await this.activeDispatchPromise;
    }

    logger.info({ workerId: this.workerId }, 'Notification Outbox Worker stopped cleanly');
  }

  /**
   * Internal polling tick. Prevents re-entrant overlaps.
   */
  private async tick(): Promise<void> {
    if (this.isProcessing || this.isStopping) {
      return;
    }

    this.isProcessing = true;
    try {
      // The polling loop yields to the outbox pause lock; direct calls do not.
      this.activeDispatchPromise = this.processBatch({ yieldToPause: true });
      await this.activeDispatchPromise;
    } catch (err) {
      logger.error({ workerId: this.workerId, err }, 'Unhandled error in notification worker tick');
    } finally {
      this.isProcessing = false;
      this.activeDispatchPromise = null;
    }
  }

  /**
   * Processes a single batch of claimed notification jobs.
   * Exposed directly for deterministic testing and manual drainage.
   */
  async processBatch(options: { yieldToPause?: boolean } = {}): Promise<number> {
    // 1. Claim ready or stale jobs with row-level locks
    const jobs = await this.repo.claimPendingBatch(
      this.batchSize,
      this.workerId,
      this.leaseTimeoutMs,
      undefined,
      options
    );

    if (jobs.length === 0) {
      return 0;
    }

    logger.info(
      { workerId: this.workerId, jobCount: jobs.length },
      'Claimed notification batch from outbox'
    );

    // 2. Dispatch each job independently (isolated error handling)
    let processedCount = 0;
    for (const job of jobs) {
      if (this.isStopping) {
        break;
      }

      try {
        await this.service.dispatchJob(job);
        processedCount++;
      } catch (jobErr) {
        logger.error(
          { workerId: this.workerId, notificationId: job.id, err: jobErr },
          'Error dispatching notification job'
        );
      }
    }

    return processedCount;
  }
}

export const notificationWorker = new NotificationWorker();
