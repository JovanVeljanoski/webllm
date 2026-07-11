/** @file Incremental / brace-aware Gemma tool-call detection. */

export {
  ESCAPE_TOKEN,
  scanBalancedBraces,
  parseToolCallArguments,
  findCompleteToolCall,
  hasCompleteToolCall,
  findCompleteWebSearchCall,
  hasCompleteWebSearchToolCall,
} from "./tool-call-syntax.js";
