import RedisMemoryServer from "redis-memory-server";

export default async function setup() {
  const server = new RedisMemoryServer({ instance: { port: 8479 } });
  await server.start();

  return async function teardown() {
    await server.stop();
  };
}
