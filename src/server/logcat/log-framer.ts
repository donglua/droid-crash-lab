export type RawLogLine = {
  readonly lineNumber: number;
  readonly raw: string;
};

/** Frames logcat chunks into lines numbered from one. Line terminators are excluded. */
export class LogFramer {
  private readonly decoder = new TextDecoder();
  private buffered = "";
  private nextLineNumber = 1;
  private decoderHasBytes = false;

  push(chunk: string | Uint8Array): readonly RawLogLine[] {
    const text =
      typeof chunk === "string" ? this.decodeBeforeString(chunk) : this.decodeBytes(chunk);
    this.buffered += text;
    return this.drainCompleteLines();
  }

  flush(): readonly RawLogLine[] {
    if (this.decoderHasBytes) {
      this.buffered += this.decoder.decode();
      this.decoderHasBytes = false;
    }
    const complete = this.drainCompleteLines();
    if (this.buffered.length === 0) {
      return complete;
    }
    const finalLine = this.numberLine(this.stripCrDelimiter(this.buffered));
    this.buffered = "";
    return [...complete, finalLine];
  }

  private decodeBeforeString(chunk: string): string {
    if (!this.decoderHasBytes) {
      return chunk;
    }
    const pending = this.decoder.decode();
    this.decoderHasBytes = false;
    return pending + chunk;
  }

  private decodeBytes(chunk: Uint8Array): string {
    this.decoderHasBytes = true;
    return this.decoder.decode(chunk, { stream: true });
  }

  private drainCompleteLines(): readonly RawLogLine[] {
    const lines: RawLogLine[] = [];
    let newlineIndex = this.buffered.indexOf("\n");
    while (newlineIndex >= 0) {
      lines.push(this.numberLine(this.stripCrDelimiter(this.buffered.slice(0, newlineIndex))));
      this.buffered = this.buffered.slice(newlineIndex + 1);
      newlineIndex = this.buffered.indexOf("\n");
    }
    return lines;
  }

  private stripCrDelimiter(raw: string): string {
    return raw.endsWith("\r") ? raw.slice(0, -1) : raw;
  }

  private numberLine(raw: string): RawLogLine {
    const line = { lineNumber: this.nextLineNumber, raw };
    this.nextLineNumber += 1;
    return line;
  }
}
