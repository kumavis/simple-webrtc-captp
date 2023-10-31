import { Buffer } from "buffer";
import process from "process";

// patch for "randombytes" module
globalThis.global = globalThis;
globalThis.Buffer = Buffer;
globalThis.process = process;