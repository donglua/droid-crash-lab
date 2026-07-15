import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { IssueList } from "./IssueList.js";

describe("IssueList", () => {
  it("shows duplicate occurrence count and raw log range", () => {
    render(
      <IssueList
        issues={[
          {
            id: "issue-1",
            type: "java",
            timestamp: "07-15 10:00:00.000",
            processName: "cn.example.app",
            summary: "IllegalStateException",
            fingerprint: "fingerprint",
            occurrenceCount: 3,
            occurrenceTimestamps: ["a", "b", "c"],
            rawLogStartLine: 10,
            rawLogEndLine: 18,
          },
        ]}
        selectedId="issue-1"
        onSelect={() => undefined}
      />,
    );
    expect(screen.getByText("出现 3 次")).toBeInTheDocument();
    expect(screen.getByText("原始日志 10–18 行")).toBeInTheDocument();
  });
});
