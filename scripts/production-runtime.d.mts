export interface ProductionRuntime {
  url: string;
  port: number;
  host: string;
  dispose: () => Promise<void>;
  signToken: (
    claims?: Record<string, unknown>,
    options?: Record<string, unknown>,
  ) => Promise<string>;
}

export function createProductionRuntime(options?: {
  root?: string;
  buildDir?: string;
  host?: string;
  port?: number;
}): Promise<ProductionRuntime>;
