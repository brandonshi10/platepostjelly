import { httpActionGeneric } from "convex/server";
import type { HttpRouter } from "convex/server";

export function registerJellyhuntHttpRoutes(http: HttpRouter): void {
  http.route({
    path: "/jellyhunt/webhooks/rewards",
    method: "POST",
    handler: httpActionGeneric(async (ctx, request) => {
      const signature = request.headers.get("x-jelly-signature") ?? "";
      const keyId = request.headers.get("x-jelly-key-id") ?? "";
      const rawBody = await request.text();

      if (!signature || !keyId || !rawBody) {
        return new Response(JSON.stringify({ error: "missing_signature" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      const currentKey = process.env.JELLYHUNT_WEBHOOK_SECRET_CURRENT;
      if (!currentKey) {
        return new Response(JSON.stringify({ error: "webhook_not_configured" }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        });
      }

      const { verifyWebhookSignature } = await import("./webhooks");
      const previousKey = process.env.JELLYHUNT_WEBHOOK_SECRET_PREVIOUS;
      const valid = verifyWebhookSignature(rawBody, signature, keyId, currentKey, previousKey);
      if (!valid) {
        return new Response(JSON.stringify({ error: "invalid_signature" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }

      let parsed: any;
      try {
        parsed = JSON.parse(rawBody);
      } catch {
        return new Response(JSON.stringify({ error: "invalid_json" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      const { ingestWebhookEvent } = await import("./webhooks");
      const anyApi = (await import("convex/server")).anyApi;

      const result = await ctx.runMutation(anyApi.jellyhunt.webhooks.ingestWebhookEvent, {
        jellyEventId: parsed.eventId ?? "",
        keyId,
        rawBody,
        entityType: parsed.entityType ?? "unknown",
        entityId: parsed.entityId ?? "",
        sequence: parsed.sequence ?? 0,
        eventType: parsed.type ?? "unknown",
      });

      return new Response(JSON.stringify({ ok: true }), {
        status: result.status,
        headers: { "Content-Type": "application/json" },
      });
    }),
  });
}
