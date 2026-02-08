/**
 * API response validation utility.
 * Parses API responses through Zod schemas to catch breaking API changes early.
 */
import { z, ZodError } from 'zod';
import { getLogger } from '../logger';

/**
 * Result of a validation attempt.
 * On success, contains the parsed data.
 * On failure, contains the original data and validation errors.
 */
export interface ValidationResult<T> {
  /** Whether validation succeeded */
  success: boolean;
  /** Parsed and validated data (only present on success) */
  data: T;
  /** Validation errors (only present on failure) */
  errors?: z.ZodIssue[];
}

/**
 * Options for response validation behavior
 */
export interface ValidateResponseOptions {
  /**
   * Whether to throw on validation failure.
   * When false (default), logs a warning and returns the original data.
   * When true, throws a ValidationResponseError.
   */
  strict?: boolean;
  /**
   * Label for logging purposes (e.g., "AlpacaAPI.getAccount")
   */
  label?: string;
}

/**
 * Error thrown when strict validation fails
 */
export class ValidationResponseError extends Error {
  /** The Zod validation issues */
  public readonly issues: z.ZodIssue[];
  /** The original data that failed validation */
  public readonly originalData: unknown;

  constructor(message: string, issues: z.ZodIssue[], originalData: unknown) {
    super(message);
    this.name = 'ValidationResponseError';
    this.issues = issues;
    this.originalData = originalData;
  }
}

/**
 * Validates an API response against a Zod schema.
 *
 * In non-strict mode (default), validation failures are logged as warnings
 * and the original data is returned. This allows the application to continue
 * operating even if the API response shape changes slightly, while still
 * alerting developers to the discrepancy.
 *
 * In strict mode, validation failures throw a ValidationResponseError.
 *
 * @param data - The API response data to validate
 * @param schema - The Zod schema to validate against
 * @param options - Validation options (strict mode, label)
 * @returns The validated (and potentially transformed) data
 * @throws ValidationResponseError if strict mode is enabled and validation fails
 *
 * @example
 * ```typescript
 * const account = await fetchAccountDetails(auth);
 * const validated = validateResponse(account, AlpacaAccountDetailsSchema, {
 *   label: 'AlpacaAPI.getAccount',
 * });
 * ```
 */
export function validateResponse<T>(
  data: unknown,
  schema: z.ZodType<T>,
  options: ValidateResponseOptions = {}
): T {
  const { strict = false, label = 'API response' } = options;

  try {
    const parsed = schema.parse(data);
    return parsed;
  } catch (error) {
    if (error instanceof ZodError) {
      const issuesSummary = error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ');

      const message = `${label} validation failed: ${issuesSummary}`;

      if (strict) {
        throw new ValidationResponseError(message, error.issues, data);
      }

      // Non-strict: log warning and return original data
      getLogger().warn(message, {
        source: 'validateResponse',
        label,
        issueCount: error.issues.length,
        issues: error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
          code: i.code,
        })),
      });

      return data as T;
    }

    // Re-throw non-Zod errors
    throw error;
  }
}

/**
 * Safely validates an API response, returning a result object instead of throwing.
 * Useful when you need to inspect validation results without try/catch.
 *
 * @param data - The API response data to validate
 * @param schema - The Zod schema to validate against
 * @returns A ValidationResult object with success status, data, and errors
 *
 * @example
 * ```typescript
 * const result = safeValidateResponse(data, AlpacaBarSchema);
 * if (result.success) {
 *   // result.data is typed and validated
 * } else {
 *   // result.errors contains Zod issues
 * }
 * ```
 */
export function safeValidateResponse<T>(
  data: unknown,
  schema: z.ZodType<T>
): ValidationResult<T> {
  const result = schema.safeParse(data);

  if (result.success) {
    return {
      success: true,
      data: result.data,
    };
  }

  return {
    success: false,
    data: data as T,
    errors: result.error.issues,
  };
}
