import { describe, expect, it } from "vitest";

import { LogFramer } from "./log-framer.js";

describe("LogFramer", () => {
  it("emits complete lines in order when one chunk contains several lines", () => {
    // Given
    const framer = new LogFramer();

    // When
    const lines = framer.push("alpha\nbeta\n");

    // Then
    expect(lines).toEqual([
      { lineNumber: 1, raw: "alpha" },
      { lineNumber: 2, raw: "beta" },
    ]);
  });

  it("waits for a newline before emitting a line split across chunks", () => {
    // Given
    const framer = new LogFramer();

    // When
    const first = framer.push("part");
    const second = framer.push("ial\n");

    // Then
    expect(first).toEqual([]);
    expect(second).toEqual([{ lineNumber: 1, raw: "partial" }]);
  });

  it("flushes a final unterminated line once", () => {
    // Given
    const framer = new LogFramer();
    framer.push("last line");

    // When
    const flushed = framer.flush();

    // Then
    expect(flushed).toEqual([{ lineNumber: 1, raw: "last line" }]);
    expect(framer.flush()).toEqual([]);
  });

  it("starts raw line numbering at one and strictly increases it", () => {
    // Given
    const framer = new LogFramer();

    // When
    const first = framer.push("one\ntwo\n");
    const second = framer.push("three\n");

    // Then
    expect([...first, ...second].map((line) => line.lineNumber)).toEqual([1, 2, 3]);
  });

  it("removes CRLF delimiters but preserves an embedded carriage return", () => {
    // Given
    const framer = new LogFramer();

    // When
    const lines = framer.push("one\r\ntw\ro\n");

    // Then
    expect(lines.map((line) => line.raw)).toEqual(["one", "tw\ro"]);
  });

  it("decodes UTF-8 safely when a multibyte character spans byte chunks", () => {
    // Given
    const framer = new LogFramer();
    const bytes = new TextEncoder().encode("崩溃\n");

    // When
    const first = framer.push(bytes.slice(0, 2));
    const second = framer.push(bytes.slice(2));

    // Then
    expect(first).toEqual([]);
    expect(second).toEqual([{ lineNumber: 1, raw: "崩溃" }]);
  });
});
