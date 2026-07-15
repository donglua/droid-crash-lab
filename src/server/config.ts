import { homedir } from "node:os";
import { join } from "node:path";

export const SERVER_HOST = "127.0.0.1";
export const SERVER_PORT = 4319;
export const DATA_ROOT = join(homedir(), ".droid-crash-lab");
