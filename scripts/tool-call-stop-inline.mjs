/** @file Inline tool-call stop scanner injected into gemma-4-e2b.js by patch script. */

/** Minified brace-aware stop check — keep in sync with lib/tool-call-syntax.js */
export const INLINE_STOP_TOOL_FN =
  'function _wllmStopTool(p,n){if(!n?.length)return!1;const e=\'<|"|>\';for(const o of n){const r=new RegExp("(?:<\\\\|tool_call\\\\|?>(?:call:)?|\\\\b(?:call:)?)"+o+"\\\\{","g");let t;while((t=r.exec(p))!==null){const a=t.index+t[0].length-1;let s=0;for(let i=a;i<p.length;i++){if(p.startsWith(e,i)){const l=p.indexOf(e,i+e.length);if(l===-1)break;i=l+e.length-1;continue}if(p[i]==="{")s++;else if(p[i]==="}"&&(s--,s===0)){const c=p.slice(a+1,i);if(/query\\s*:\\s*(?:<\\|\"\\|>\"[^\"]*\"|<\\|\"\\|>[^<]+<\\|\"\\|>|[^,}]+)/.test(c))return!0;break}}}}return!1}';

export const INLINE_STOP_CONDITION =
  "_wllmStopNames&&!g&&_wllmStopTool(p,_wllmStopNames)";

export const REGEX_STOP_CONDITION =
  'this._stopOnToolCall&&!g&&/<\\|tool_call\\|?>(?:call:)?\\w+\\{[\\s\\S]*\\}(?:<tool_call\\|>|<turn\\|>|$)?\\s*$/.test(p)';
