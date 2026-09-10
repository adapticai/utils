/**
 * Typed access to the error a call was supposed to raise.
 *
 * `await promise.catch((error) => error)` types the result as the union of the
 * error and the value the promise might have resolved to, which erases exactly
 * the properties an assertion wants to read. Worse, a call that wrongly
 * SUCCEEDS then surfaces as a missing property rather than as the contract
 * violation it is. This narrows once, and fails loudly on a resolution.
 *
 * @module __tests__/llm/client/support/rejections
 */

/**
 * Await a call that must fail, and return its error at the expected type.
 *
 * @param promise The call under test.
 * @param expected The error class the call is contracted to raise.
 * @returns The raised error.
 * @throws When the call resolves, or raises something of another type.
 */
export async function rejection<E extends Error>(
  promise: Promise<unknown>,
  expected: new (...args: never[]) => E,
): Promise<E> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof expected) {
      return error;
    }
    throw error;
  }
  throw new Error(`expected the call to raise ${expected.name}, but it resolved`);
}
