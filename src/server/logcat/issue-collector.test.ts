import { describe, expect, it } from "vitest";
import type { Issue } from "../../shared/contracts.js";
import { IssueCollector } from "./issue-collector.js";

function javaIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: "parsed-10",
    type: "java",
    timestamp: "07-15 10:00:00.000",
    processName: "cn.example.app",
    summary: "java.lang.IllegalStateException: broken",
    exceptionClass: "java.lang.IllegalStateException",
    topApplicationFrame: "cn.example.app.Home.open(Home.kt:42)",
    fingerprint: "java|java.lang.IllegalStateException|cn.example.app.Home.open(Home.kt:42)",
    occurrenceCount: 1,
    occurrenceTimestamps: ["07-15 10:00:00.000"],
    rawLogStartLine: 10,
    rawLogEndLine: 18,
    ...overrides,
  };
}

describe("IssueCollector", () => {
  it("merges the same fingerprint and preserves every occurrence timestamp", () => {
    const collector = new IssueCollector();
    const first = collector.add(javaIssue());

    const second = collector.add(
      javaIssue({
        id: "parsed-30",
        timestamp: "07-15 10:01:00.000",
        occurrenceTimestamps: ["07-15 10:01:00.000"],
        rawLogStartLine: 30,
        rawLogEndLine: 39,
      }),
    );

    expect(first.occurrenceCount).toBe(1);
    expect(second).toMatchObject({
      id: "parsed-10",
      occurrenceCount: 2,
      rawLogStartLine: 10,
      rawLogEndLine: 18,
    });
    expect(second.occurrenceTimestamps).toEqual([
      "07-15 10:00:00.000",
      "07-15 10:01:00.000",
    ]);
    expect(collector.list()).toEqual([second]);
  });

  it("keeps crashes with different application frames separate", () => {
    const collector = new IssueCollector();

    collector.add(javaIssue());
    collector.add(
      javaIssue({
        id: "parsed-20",
        fingerprint: "java|java.lang.IllegalStateException|cn.example.app.Detail.open(Detail.kt:9)",
        topApplicationFrame: "cn.example.app.Detail.open(Detail.kt:9)",
        rawLogStartLine: 20,
        rawLogEndLine: 28,
      }),
    );

    expect(collector.list()).toHaveLength(2);
  });
});
