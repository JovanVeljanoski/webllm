/** @file Inline Qwen XML tool-call stop scanner injected into bonsai-27b.js. */

/**
 * Stop on either a canonical `</tool_call>` or a wrapperless function whose
 * parameter contains complete JSON. Bonsai has emitted the latter in browsers.
 */
export const BONSAI_INLINE_STOP_TOOL_FN =
  "function _wllmBonsaiStopTool(p,n){if(!n?.length||!p)return!1;const o=\"<think>\",c=\"</think>\";let t=p.lastIndexOf(o),u=p.lastIndexOf(c);if(t!==-1&&t>u)return!1;for(const a of n){const r=\"<function=\"+a+\">\",l=p.indexOf(r);if(l===-1)continue;const f=p.lastIndexOf(\"<tool_call>\",l),h=p.indexOf(\"</tool_call>\",l);if(f!==-1&&h!==-1)return!0;const q=p.indexOf(\"<parameter=\",l);if(q===-1)continue;const g=p.indexOf(\">\",q);if(g===-1)continue;let v=p.slice(g+1).trim(),x=v.indexOf(\"<\");x!==-1&&(v=v.slice(0,x).trim());try{JSON.parse(v);return!0}catch{}}return!1}";

export const BONSAI_INLINE_STOP_CONDITION =
  "_wllmStopNames&&!_wllmStopped&&_wllmBonsaiStopTool(o,_wllmStopNames)";
