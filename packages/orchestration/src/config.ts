export type AppConfig = {
  env: string;
  databaseUrl: string;
  token: string;
  bind: string;
  port: number;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const controlEnv = env.CONTROL_PLANE_ENV ?? env.NODE_ENV ?? "development";
  if (controlEnv === "production") {
    throw new Error("Production is not authorized for Gate A");
  }
  const databaseUrl =
    env.DATABASE_URL ?? "postgres://control:control@127.0.0.1:5432/control_plane";
  const token = env.CONTROL_PLANE_TOKEN ?? "local-dev-controller-token";
  return {
    env: controlEnv,
    databaseUrl,
    token,
    bind: env.CONTROL_PLANE_BIND ?? "127.0.0.1",
    port: Number(env.CONTROL_PLANE_PORT ?? 3000),
  };
}
