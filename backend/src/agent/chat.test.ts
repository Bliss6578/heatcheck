import { describe, expect, it } from "vitest";
import { finalAnswerOnly } from "./chat";

describe("HeatCheck chatbot output boundary", () => {
  it("extracts the answer from structured output", () => {
    expect(finalAnswerOnly('{"answer":"Risk is low at 26/100."}')).toBe("Risk is low at 26/100.");
  });

  it("removes model thinking blocks", () => {
    expect(finalAnswerOnly("<think>private reasoning</think>\nCurrent risk is low.")).toBe("Current risk is low.");
  });

  it("does not expose verbose thinking-process prose", () => {
    const output = finalAnswerOnly("Here's a thinking process:\n1. Analyze User Input\n2. Extract data\n\nDraft Response: Based on the latest observation, risk is LOW at 26/100.");
    expect(output).toBe("Based on the latest observation, risk is LOW at 26/100.");
  });
});
