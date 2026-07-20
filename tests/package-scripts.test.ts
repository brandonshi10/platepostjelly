import { describe, expect, it } from "vitest";
import packageJson from "../package.json";

describe("JellyHunt verification scripts", () => {
  it("defines separate contract and Convex gates", () => {
    expect(packageJson.scripts["test:contracts"]).toBe("vitest run tests/jellyhunt-v1-compatibility.test.ts tests/jellyhunt-v2-openapi.test.ts tests/jellyhunt-v2-fixtures.test.ts");
    expect(packageJson.scripts["test:convex"]).toBe("vitest run --config vitest.convex.config.ts");
    expect(packageJson.scripts["validate:openapi"]).toBe("redocly lint openapi/jellyhunt-v2.yaml");
    expect(packageJson.scripts["typecheck:convex"]).toBe("convex dev --once --typecheck enable");
  });
});
