import type { EmbeddedRunTrigger } from "./params.js";

export function buildEmbeddedAttemptToolRunContext(params: {
  trigger?: EmbeddedRunTrigger;
  memoryFlushWritePath?: string;
  memoryFlushAllowedToolNames?: string[];
}): {
  trigger?: EmbeddedRunTrigger;
  memoryFlushWritePath?: string;
  memoryFlushAllowedToolNames?: string[];
} {
  return {
    trigger: params.trigger,
    memoryFlushWritePath: params.memoryFlushWritePath,
    memoryFlushAllowedToolNames: params.memoryFlushAllowedToolNames,
  };
}
