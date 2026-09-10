import { describe, expect, it } from "vitest";

import { UnsupportedCapabilityError, normaliseParams } from "../../../llm/param-matrix";
import type { AliasCallOptions, LlmResponseFormat } from "../../../llm/types";
import { CLOSED_PROVIDER, OPEN_PROVIDER, makeRoute } from "./support/routes";

/** The alias these constructed legs stand in for. */
const ALIAS = "llm.extract";

/** A route-declared output cap, low enough that a caller can plausibly exceed it. */
const ROUTE_OUTPUT_CAP = 4_096;

/** An output request deliberately larger than the route's declared cap. */
const OVER_CAP_REQUEST = 32_000;

/** An output request comfortably under the route's declared cap. */
const UNDER_CAP_REQUEST = 512;

/** A sampling temperature a caller might choose. */
const CALLER_TEMPERATURE = 0.2;

/** A strict schema a caller may require. */
const STRICT_SCHEMA: LlmResponseFormat = {
  type: "json_schema",
  schema: {
    type: "object",
    properties: { symbol: { type: "string" } },
    required: ["symbol"],
  },
};

/** A tool definition; its contents are irrelevant to normalisation. */
const TOOL_DEFINITION = {
  type: "function",
  function: { name: "lookup", parameters: { type: "object", properties: {} } },
} as const;

describe("per-provider parameter normalisation", () => {
  it("omits temperature entirely where the route does not support it", () => {
    const route = makeRoute({
      alias: ALIAS,
      params: { supports_temperature: false, temperature: null },
    });

    const params = normaliseParams(
      { alias: ALIAS, temperature: CALLER_TEMPERATURE },
      route,
      "text",
    );

    // Sending a default would assert a value the caller did not choose, and a
    // model that accepts only its own default rejects the parameter's presence.
    expect(Object.keys(params)).not.toContain("temperature");
    expect("temperature" in params).toBe(false);
  });

  it("passes temperature through where the route does support it", () => {
    const route = makeRoute({ alias: ALIAS, params: { supports_temperature: true } });

    const params = normaliseParams(
      { alias: ALIAS, temperature: CALLER_TEMPERATURE },
      route,
      "text",
    );

    expect(params.temperature).toBe(CALLER_TEMPERATURE);
  });

  it("caps the caller's output request at the route's declared ceiling", () => {
    const route = makeRoute({
      alias: ALIAS,
      provider: OPEN_PROVIDER,
      params: { max_output_tokens: ROUTE_OUTPUT_CAP },
    });

    const capped = normaliseParams(
      { alias: ALIAS, maxOutputTokens: OVER_CAP_REQUEST },
      route,
      "text",
    );
    expect(capped.max_completion_tokens).toBe(ROUTE_OUTPUT_CAP);

    const uncapped = normaliseParams(
      { alias: ALIAS, maxOutputTokens: UNDER_CAP_REQUEST },
      route,
      "text",
    );
    expect(uncapped.max_completion_tokens).toBe(UNDER_CAP_REQUEST);
  });

  it("names the output cap by the wire format each provider actually speaks", () => {
    const anthropicLeg = makeRoute({
      alias: ALIAS,
      role: "closed_incumbent",
      provider: CLOSED_PROVIDER,
      params: { max_output_tokens: ROUTE_OUTPUT_CAP },
    });
    const openAiLeg = makeRoute({
      alias: ALIAS,
      provider: OPEN_PROVIDER,
      params: { max_output_tokens: ROUTE_OUTPUT_CAP },
    });
    const options: AliasCallOptions = { alias: ALIAS, maxOutputTokens: UNDER_CAP_REQUEST };

    const anthropicParams = normaliseParams(options, anthropicLeg, "text");
    expect(anthropicParams.max_tokens).toBe(UNDER_CAP_REQUEST);
    expect("max_completion_tokens" in anthropicParams).toBe(false);

    const openAiParams = normaliseParams(options, openAiLeg, "text");
    expect(openAiParams.max_completion_tokens).toBe(UNDER_CAP_REQUEST);
    expect("max_tokens" in openAiParams).toBe(false);
  });

  it("drops reasoning effort on a route that declares no such knob", () => {
    const nonReasoning = makeRoute({ alias: ALIAS, params: { supports_temperature: true } });
    const reasoning = makeRoute({ alias: ALIAS, params: { reasoning_effort: null } });
    const options: AliasCallOptions = { alias: ALIAS, reasoningEffort: "high" };

    // Translating an unsupported knob into some other parameter would change
    // the request's meaning silently; dropping it leaves the model's default.
    expect("reasoning_effort" in normaliseParams(options, nonReasoning, "text")).toBe(false);
    expect(normaliseParams(options, reasoning, "text").reasoning_effort).toBe("high");
  });

  it("refuses a strict schema on a route that cannot enforce one", () => {
    const route = makeRoute({ alias: ALIAS, params: { supports_json_schema: false } });

    expect(() => normaliseParams({ alias: ALIAS }, route, STRICT_SCHEMA)).toThrow(
      UnsupportedCapabilityError,
    );
    try {
      normaliseParams({ alias: ALIAS }, route, STRICT_SCHEMA);
      expect.unreachable("a route without schema enforcement must not serve a schema request");
    } catch (error) {
      expect(error).toBeInstanceOf(UnsupportedCapabilityError);
      if (error instanceof UnsupportedCapabilityError) {
        expect(error.capability).toBe("json_schema");
        expect(error.routeKey).toBe(route.routeKey);
      }
    }

    // The failure must be a refusal, not a quiet downgrade to free-form JSON:
    // that would return prose where the caller's parser expects an object.
    const capable = makeRoute({ alias: ALIAS, params: { supports_json_schema: true } });
    const params = normaliseParams({ alias: ALIAS }, capable, STRICT_SCHEMA);
    expect(params.response_format).toEqual({
      type: "json_schema",
      json_schema: { name: "structured_response", strict: true, schema: STRICT_SCHEMA.schema },
    });
  });

  it("refuses tools on a route that does not support them", () => {
    const route = makeRoute({ alias: ALIAS, params: { supports_tools: false } });

    expect(() =>
      normaliseParams({ alias: ALIAS, tools: [TOOL_DEFINITION] }, route, "text"),
    ).toThrow(UnsupportedCapabilityError);

    const capable = makeRoute({ alias: ALIAS, params: { supports_tools: true } });
    const params = normaliseParams(
      { alias: ALIAS, tools: [TOOL_DEFINITION] },
      capable,
      "text",
    );
    expect(params.tools).toEqual([TOOL_DEFINITION]);
    // Fanned-out tool calls reorder their own effects, and ordering is part of
    // the meaning of a sequence of trading actions.
    expect(params.parallel_tool_calls).toBe(false);
  });

  it("normalises ONE caller option bag for legs of both wire formats", () => {
    const options: AliasCallOptions = {
      alias: ALIAS,
      temperature: CALLER_TEMPERATURE,
      maxOutputTokens: OVER_CAP_REQUEST,
      reasoningEffort: "medium",
      tools: [TOOL_DEFINITION],
      metadata: { correlation: "abc123" },
    };
    const openAiLeg = makeRoute({
      alias: ALIAS,
      provider: OPEN_PROVIDER,
      params: {
        supports_temperature: true,
        supports_tools: true,
        supports_json_schema: true,
        max_output_tokens: ROUTE_OUTPUT_CAP,
        reasoning_effort: null,
      },
    });
    const anthropicLeg = makeRoute({
      alias: ALIAS,
      role: "closed_incumbent",
      provider: CLOSED_PROVIDER,
      params: {
        supports_temperature: true,
        supports_tools: true,
        supports_json_schema: true,
        max_output_tokens: ROUTE_OUTPUT_CAP,
      },
    });

    // A fallback that failed on the leg it fell back to would turn the
    // mechanism that exists to survive an outage into a second way to fail.
    const openAiParams = normaliseParams(options, openAiLeg, "json");
    const anthropicParams = normaliseParams(options, anthropicLeg, "json");

    expect(openAiParams.max_completion_tokens).toBe(ROUTE_OUTPUT_CAP);
    expect(anthropicParams.max_tokens).toBe(ROUTE_OUTPUT_CAP);
    expect(openAiParams.temperature).toBe(CALLER_TEMPERATURE);
    expect(anthropicParams.temperature).toBe(CALLER_TEMPERATURE);
    expect(openAiParams.reasoning_effort).toBe("medium");
    expect("reasoning_effort" in anthropicParams).toBe(false);
    expect(openAiParams.response_format).toEqual({ type: "json_object" });
    expect(anthropicParams.response_format).toEqual({ type: "json_object" });
    expect(openAiParams.metadata).toEqual({ correlation: "abc123" });
  });
});
