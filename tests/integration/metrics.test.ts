import { afterAll, describe, expect, it } from "vitest";
import { GET as getMetrics } from "@/app/api/metrics/route";

const originalMetricsToken = process.env.VEYLORA_METRICS_TOKEN;

afterAll(() => {
  if (originalMetricsToken === undefined) delete process.env.VEYLORA_METRICS_TOKEN;
  else process.env.VEYLORA_METRICS_TOKEN = originalMetricsToken;
});

describe("metrics endpoint", () => {
  it("requires a configured bearer token and reports dependency, worker, and queue gauges", async () => {
    delete process.env.VEYLORA_METRICS_TOKEN;
    expect((await getMetrics(new Request("http://localhost/api/metrics"))).status).toBe(404);

    const token = "integration-metrics-token-that-is-at-least-32-characters";
    process.env.VEYLORA_METRICS_TOKEN = token;
    expect((await getMetrics(new Request("http://localhost/api/metrics", {
      headers: { authorization: "Bearer wrong-token" },
    }))).status).toBe(401);

    const response = await getMetrics(new Request("http://localhost/api/metrics", {
      headers: { authorization: `Bearer ${token}` },
    }));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain; version=0.0.4");
    const metrics = await response.text();
    expect(metrics).toContain("veylora_database_available 1");
    expect(metrics).toContain('veylora_worker_started{worker="scan"}');
    expect(metrics).toContain('veylora_jobs{queue="scan",status="queued"}');
    expect(metrics).toContain('veylora_queue_oldest_queued_seconds{queue="upload"}');
  });
});
