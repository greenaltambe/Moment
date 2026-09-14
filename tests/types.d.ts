declare module 'node:test' {
  export function describe(name: string, fn: () => void): void;
  export function it(name: string, fn: () => void | Promise<void>): void;
  export function test(name: string, fn: () => void | Promise<void>): void;
}

declare module 'node:assert/strict' {
  export function equal(actual: any, expected: any, message?: string): void;
  export function deepEqual(actual: any, expected: any, message?: string): void;
  export function ok(value: any, message?: string): void;
  export function fail(message?: string): never;
}

declare module 'node:fs' {
  export function existsSync(path: string): boolean;
  export function readFileSync(path: string, encoding: string): string;
  export function readdirSync(path: string, options?: any): any[];
}

declare module 'node:path' {
  export function join(...paths: string[]): string;
  export function relative(from: string, to: string): string;
  export function resolve(...paths: string[]): string;
}

declare const process: {
  cwd(): string;
  exit(code?: number): never;
};
