/**
 * In-process business metrics counter.
 *
 * A lightweight, zero-dependency singleton that tracks key operational
 * counters in memory. No external observability platform (Prometheus,
 * Grafana, Datadog) is required.  Counters reset on process restart —
 * they are intended for operational dashboards and alerting, not
 * long-term analytics (use PostgreSQL for that).
 *
 * SECURITY: This module must NEVER expose PII, OTPs, secrets, or raw
 * financial data.  All metrics are aggregate counters only.
 */

export interface MetricsSnapshot {
  /** Wall-clock timestamp when this snapshot was captured */
  capturedAt: string;
  /** Seconds since the process started */
  uptimeSeconds: number;
  auth: {
    otpRequested: number;
    otpVerified: number;
    otpFailed: number;
    tokenRefreshed: number;
    tokenRevoked: number;
  };
  orders: {
    checkoutAttempts: number;
    checkoutSucceeded: number;
    checkoutFailed: number;
    ordersCreated: number;
    ordersCancelled: number;
    ordersDelivered: number;
  };
  notifications: {
    enqueued: number;
    dispatched: number;
    failed: number;
    permanentlyFailed: number;
  };
  errors: {
    /** HTTP 4xx client errors */
    clientErrors: number;
    /** HTTP 5xx server errors */
    serverErrors: number;
    /** Unhandled promise rejections caught at process level */
    unhandledRejections: number;
  };
  http: {
    requestsTotal: number;
    /** Requests resulting in 2xx */
    requests2xx: number;
    /** Requests resulting in 4xx */
    requests4xx: number;
    /** Requests resulting in 5xx */
    requests5xx: number;
  };
}

class MetricsService {
  // ── Auth ──────────────────────────────────────────────────────────────────
  private _otpRequested = 0;
  private _otpVerified = 0;
  private _otpFailed = 0;
  private _tokenRefreshed = 0;
  private _tokenRevoked = 0;

  // ── Orders ────────────────────────────────────────────────────────────────
  private _checkoutAttempts = 0;
  private _checkoutSucceeded = 0;
  private _checkoutFailed = 0;
  private _ordersCreated = 0;
  private _ordersCancelled = 0;
  private _ordersDelivered = 0;

  // ── Notifications ─────────────────────────────────────────────────────────
  private _notificationsEnqueued = 0;
  private _notificationsDispatched = 0;
  private _notificationsFailed = 0;
  private _notificationsPermanentlyFailed = 0;

  // ── Errors ────────────────────────────────────────────────────────────────
  private _clientErrors = 0;
  private _serverErrors = 0;
  private _unhandledRejections = 0;

  // ── HTTP ──────────────────────────────────────────────────────────────────
  private _requestsTotal = 0;
  private _requests2xx = 0;
  private _requests4xx = 0;
  private _requests5xx = 0;

  // ── Auth Counters ─────────────────────────────────────────────────────────
  incrementOtpRequested(): void { this._otpRequested++; }
  incrementOtpVerified(): void  { this._otpVerified++; }
  incrementOtpFailed(): void    { this._otpFailed++; }
  incrementTokenRefreshed(): void { this._tokenRefreshed++; }
  incrementTokenRevoked(): void   { this._tokenRevoked++; }

  // ── Order Counters ────────────────────────────────────────────────────────
  incrementCheckoutAttempts(): void  { this._checkoutAttempts++; }
  incrementCheckoutSucceeded(): void { this._checkoutSucceeded++; }
  incrementCheckoutFailed(): void    { this._checkoutFailed++; }
  incrementOrdersCreated(): void     { this._ordersCreated++; }
  incrementOrdersCancelled(): void   { this._ordersCancelled++; }
  incrementOrdersDelivered(): void   { this._ordersDelivered++; }

  // ── Notification Counters ─────────────────────────────────────────────────
  incrementNotificationsEnqueued(): void          { this._notificationsEnqueued++; }
  incrementNotificationsDispatched(): void        { this._notificationsDispatched++; }
  incrementNotificationsFailed(): void            { this._notificationsFailed++; }
  incrementNotificationsPermanentlyFailed(): void { this._notificationsPermanentlyFailed++; }

  // ── Error Counters ────────────────────────────────────────────────────────
  incrementClientErrors(): void       { this._clientErrors++; }
  incrementServerErrors(): void       { this._serverErrors++; }
  incrementUnhandledRejections(): void { this._unhandledRejections++; }

  // ── HTTP Counters ─────────────────────────────────────────────────────────
  incrementRequestsTotal(): void { this._requestsTotal++; }
  incrementRequests2xx(): void   { this._requests2xx++; }
  incrementRequests4xx(): void   { this._requests4xx++; }
  incrementRequests5xx(): void   { this._requests5xx++; }

  // ── Snapshot ──────────────────────────────────────────────────────────────
  snapshot(): MetricsSnapshot {
    return {
      capturedAt: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      auth: {
        otpRequested: this._otpRequested,
        otpVerified: this._otpVerified,
        otpFailed: this._otpFailed,
        tokenRefreshed: this._tokenRefreshed,
        tokenRevoked: this._tokenRevoked,
      },
      orders: {
        checkoutAttempts: this._checkoutAttempts,
        checkoutSucceeded: this._checkoutSucceeded,
        checkoutFailed: this._checkoutFailed,
        ordersCreated: this._ordersCreated,
        ordersCancelled: this._ordersCancelled,
        ordersDelivered: this._ordersDelivered,
      },
      notifications: {
        enqueued: this._notificationsEnqueued,
        dispatched: this._notificationsDispatched,
        failed: this._notificationsFailed,
        permanentlyFailed: this._notificationsPermanentlyFailed,
      },
      errors: {
        clientErrors: this._clientErrors,
        serverErrors: this._serverErrors,
        unhandledRejections: this._unhandledRejections,
      },
      http: {
        requestsTotal: this._requestsTotal,
        requests2xx: this._requests2xx,
        requests4xx: this._requests4xx,
        requests5xx: this._requests5xx,
      },
    };
  }

  /** Reset all counters (intended for testing only). */
  _reset(): void {
    this._otpRequested = 0;
    this._otpVerified = 0;
    this._otpFailed = 0;
    this._tokenRefreshed = 0;
    this._tokenRevoked = 0;
    this._checkoutAttempts = 0;
    this._checkoutSucceeded = 0;
    this._checkoutFailed = 0;
    this._ordersCreated = 0;
    this._ordersCancelled = 0;
    this._ordersDelivered = 0;
    this._notificationsEnqueued = 0;
    this._notificationsDispatched = 0;
    this._notificationsFailed = 0;
    this._notificationsPermanentlyFailed = 0;
    this._clientErrors = 0;
    this._serverErrors = 0;
    this._unhandledRejections = 0;
    this._requestsTotal = 0;
    this._requests2xx = 0;
    this._requests4xx = 0;
    this._requests5xx = 0;
  }
}

/** Process-scoped singleton — import and use directly in any module. */
export const metrics = new MetricsService();
