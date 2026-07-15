import { open, rm } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

type UploadFailurePhase = "write" | "close";

class UploadThrownValueError extends Error {
  override readonly name = "UploadThrownValueError";

  constructor(readonly phase: UploadFailurePhase, cause: unknown) {
    super(`APK upload ${phase} threw a non-Error value`, { cause });
  }
}

export async function writeOwnedUpload(
  storedPath: string,
  content: Uint8Array | Readable,
): Promise<void> {
  const handle = await open(storedPath, "wx");
  let operationError: Error | undefined;
  try {
    if (content instanceof Readable) {
      const output = handle.createWriteStream({ autoClose: false });
      await pipeline(content, output);
      if (!output.closed) {
        await new Promise<void>((resolveClose) => {
          output.once("close", resolveClose);
          output.destroy();
        });
      }
    } else {
      await handle.writeFile(content);
    }
  } catch (error) {
    operationError =
      error instanceof Error
        ? error
        : new UploadThrownValueError("write", error);
  }

  try {
    await handle.close();
  } catch (closeError) {
    const normalizedCloseError =
      closeError instanceof Error
        ? closeError
        : new UploadThrownValueError("close", closeError);
    operationError = operationError === undefined
      ? normalizedCloseError
      : new SuppressedError(
          normalizedCloseError,
          operationError,
          "APK upload write and close both failed",
        );
  }

  if (operationError === undefined) {
    return;
  }
  try {
    await rm(storedPath, { force: true });
  } catch (cleanupError) {
    throw new SuppressedError(
      cleanupError,
      operationError,
      "APK upload failed and partial-file cleanup also failed",
    );
  }
  throw operationError;
}
