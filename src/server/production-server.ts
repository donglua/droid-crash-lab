import type { FastifyInstance } from "fastify";

type ProductionServerOptions = {
  readonly app: FastifyInstance;
  readonly host: string;
  readonly port: number;
};

export async function listenProductionApp(options: ProductionServerOptions): Promise<URL> {
  const address = await options.app.listen({ host: options.host, port: options.port });
  return new URL(address);
}
