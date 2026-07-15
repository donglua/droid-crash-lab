import type { Issue } from "../../shared/contracts.js";

/** Mutable accumulator whose purpose is to merge duplicate issues within one run. */
export class IssueCollector {
  private readonly issuesByFingerprint = new Map<string, Issue>();

  add(issue: Issue): Issue {
    const existing = this.issuesByFingerprint.get(issue.fingerprint);
    if (existing === undefined) {
      this.issuesByFingerprint.set(issue.fingerprint, issue);
      return issue;
    }

    const merged: Issue = {
      ...existing,
      occurrenceCount: existing.occurrenceCount + issue.occurrenceCount,
      occurrenceTimestamps: [
        ...existing.occurrenceTimestamps,
        ...issue.occurrenceTimestamps,
      ],
    };
    this.issuesByFingerprint.set(issue.fingerprint, merged);
    return merged;
  }

  list(): readonly Issue[] {
    return [...this.issuesByFingerprint.values()];
  }
}
