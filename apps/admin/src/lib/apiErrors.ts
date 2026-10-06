import { ApiError } from '../api/client';

/**
 * One way to turn an API refusal into words, shared by every form.
 *
 * A 400 VALIDATION_ERROR carries per-field details. Two shapes reach the
 * browser: the validate middleware's `{ field, message }` and a raw zod /
 * lifecycle issue's `{ path: [...], message }`. Showing only "Request
 * validation failed" hides which field the server refused and why.
 */
export interface FieldIssue {
  /** Dotted field name ("purchase_cost"); empty when the issue has no field. */
  field: string;
  message: string;
}

export function validationIssues(err: unknown): FieldIssue[] {
  if (!(err instanceof ApiError) || err.code !== 'VALIDATION_ERROR' || !Array.isArray(err.details)) return [];
  return err.details.flatMap((raw: unknown) => {
    if (!raw || typeof raw !== 'object') return [];
    const detail = raw as { field?: unknown; path?: unknown; message?: unknown };
    if (typeof detail.message !== 'string' || !detail.message) return [];
    const field =
      typeof detail.field === 'string'
        ? detail.field
        : Array.isArray(detail.path)
          ? detail.path.join('.')
          : '';
    return [{ field, message: detail.message }];
  });
}

/** The first server message for each field, keyed by the API's field name. */
export function fieldErrors(err: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of validationIssues(err)) {
    if (issue.field && !(issue.field in out)) out[issue.field] = issue.message;
  }
  return out;
}

/** "purchase_cost" -> "Purchase cost". */
export function fieldLabel(field: string): string {
  const words = field.split('.').pop()!.replace(/_/g, ' ').trim();
  return words ? words[0]!.toUpperCase() + words.slice(1) : field;
}

/** Upload refusals (backend media limits) in the operator's words. */
export const IMAGE_TOO_LARGE_MESSAGE = 'Images must be 2 MB or smaller.';

/**
 * The message to show for a failed request. Validation details are listed
 * per field; `skipFields` leaves out the fields a form already shows inline.
 */
export function errorMessage(err: unknown, fallback: string, skipFields: ReadonlyArray<string> = []): string {
  if (err instanceof ApiError) {
    const issues = validationIssues(err);
    if (issues.length > 0) {
      const rest = issues.filter((issue) => !skipFields.includes(issue.field));
      if (rest.length === 0) return 'Check the highlighted fields.';
      return rest.map((issue) => (issue.field ? `${fieldLabel(issue.field)}: ${issue.message}` : issue.message)).join(' ');
    }
    if (err.code === 'FILE_TOO_LARGE' || err.code === 'PAYLOAD_TOO_LARGE') return IMAGE_TOO_LARGE_MESSAGE;
    return err.message || fallback;
  }
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

/**
 * Splits server field errors into those the form can show next to an input
 * (`inlineFields`) and one message for everything else.
 */
export function splitServerErrors(
  err: unknown,
  inlineFields: ReadonlyArray<string>,
  fallback: string
): { inline: Record<string, string>; message: string } {
  const all = fieldErrors(err);
  const inline: Record<string, string> = {};
  for (const field of inlineFields) if (all[field]) inline[field] = all[field]!;
  return { inline, message: errorMessage(err, fallback, Object.keys(inline)) };
}
