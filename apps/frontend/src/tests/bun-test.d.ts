declare module "bun:test" {
  export interface Expectation<T = unknown> {
    toBe(expected: T): void;
    toEqual(expected: unknown): void;
    toBeNull(): void;
    toBeUndefined(): void;
    toBeDefined(): void;
    toBeTruthy(): void;
    toBeFalsy(): void;
    toBeGreaterThan(expected: number): void;
    toBeLessThan(expected: number): void;
    toContain(expected: unknown): void;
    toThrow(expected?: string | RegExp | Error): void;
    not: Expectation<T>;
  }

  export type MockFn<T = (...args: unknown[]) => unknown> = T & {
    mockClear: () => void;
    mockReset: () => void;
    mockRestore: () => void;
    mockImplementation: (fn: T) => MockFn<T>;
    mockReturnValue: (val: unknown) => MockFn<T>;
    mockResolvedValue: (val: unknown) => MockFn<T>;
    mockRejectedValue: (val: unknown) => MockFn<T>;
  };

  export const describe: (name: string, fn: () => void) => void;
  export const it: (name: string, fn: () => void | Promise<void>) => void;
  export const test: (name: string, fn: () => void | Promise<void>) => void;
  export const expect: <T = unknown>(actual: T) => Expectation<T>;
  export const beforeEach: (fn: () => void | Promise<void>) => void;
  export const afterEach: (fn: () => void | Promise<void>) => void;
  export const beforeAll: (fn: () => void | Promise<void>) => void;
  export const afterAll: (fn: () => void | Promise<void>) => void;
  export const mock: <T extends (...args: never[]) => unknown>(fn?: T) => MockFn<T>;
  export const spyOn: (obj: unknown, method: string) => MockFn<(...args: never[]) => unknown>;
}
