#!/usr/bin/env node
/** Preserve Bonsai control tokens, expose rawText, and enable Qwen tool calls. */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BONSAI_INLINE_STOP_CONDITION,
  BONSAI_INLINE_STOP_TOOL_FN,
} from "./bonsai-tool-stop-inline.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const bundlePath = path.join(__dirname, "..", "bonsai-27b.js");

const controlOnlyStart =
  "async*generate(t,n={}){let r=this.acquireGenerationLease();this.#o=null;let m=!n.preserveControlTokens,s=this.#i(),a=[],o=\"\",i=false;try{";
const toolPatchedStart =
  "async*generate(t,n={}){let r=this.acquireGenerationLease();this.#o=null;this._agentTools=n.tools??null;this._stopMode=n.stopMode??null;this._stopToolNames=n.stopToolNames??null;this._stopOnToolCall=!!(n.stopOnToolCall||n.stopMode===\"tool_call\");let m=!n.preserveControlTokens,s=this.#i(),a=[],o=\"\",i=false,_wllmStopped=false;try{";

const upstreamRender =
  "#d(t,n,r){return this.#n.render({...r,messages:t,tools:null,bos_token:this.#r.bos_token,eos_token:this.#r.eos_token,add_generation_prompt:n})}";
const patchedRender =
  "#d(t,n,r){return this.#n.render({...r,messages:t,tools:this._agentTools??null,bos_token:this.#r.bos_token,eos_token:this.#r.eos_token,add_generation_prompt:n})}";

const upstreamDecodeLoop =
  "for await(let L of this.streamTokens({suffixIds:g,maxNewTokens:A,eosTokenId:l,stopOnEos:true},n)){if(n.signal?.aborted)return;a.push(L);let Z=w.push(L);o=w.text,yield{token:L,delta:Z,text:o,rawText:o}";
const toolOnlyDecodeLoop =
  `${BONSAI_INLINE_STOP_TOOL_FN};let _wllmStopNames=n.stopToolNames??(this._stopOnToolCall?["web_search"]:null);for await(let L of this.streamTokens({suffixIds:g,maxNewTokens:A,eosTokenId:l,stopOnEos:true},n)){if(n.signal?.aborted)return;a.push(L);let Z=w.push(L);o=w.text,yield{token:L,delta:Z,text:o,rawText:o};if(${BONSAI_INLINE_STOP_CONDITION}){_wllmStopped=true;break}`;
const patchedDecodeLoop =
  `${BONSAI_INLINE_STOP_TOOL_FN};let _wllmStopNames=n.stopToolNames??(this._stopOnToolCall?["web_search"]:null),_wllmPrefillInfo=null,_wllmPrefillEmitted=false,_wllmStreamOptions={...n,onPrefillDone:e=>{_wllmPrefillInfo=e;n.onPrefillDone?.(e)}};if(g.length>0)yield{phase:"prefill",status:"start",prefillTokens:g.length,promptTokens:p.length,cachedTokens:f};for await(let L of this.streamTokens({suffixIds:g,maxNewTokens:A,eosTokenId:l,stopOnEos:true},_wllmStreamOptions)){if(!_wllmPrefillEmitted&&_wllmPrefillInfo){_wllmPrefillEmitted=true;yield{phase:"prefill",status:"done",prefillTokens:_wllmPrefillInfo.tokens??g.length,promptTokens:p.length,cachedTokens:f,cacheLength:_wllmPrefillInfo.cache_length}}if(n.signal?.aborted)return;a.push(L);let Z=w.push(L);o=w.text,yield{token:L,delta:Z,text:o,rawText:o};if(${BONSAI_INLINE_STOP_CONDITION}){_wllmStopped=true;break}`;

const upstreamStreamTokens =
  "streamTokens(t,n){return this.model.streamTokenIdsFromCache({input_ids:[t.suffixIds],generation_state:this.#t,max_new_tokens:t.maxNewTokens,eos_token_id:t.eosTokenId,stop_on_eos:t.stopOnEos,decode_pipeline_depth:n.decodePipelineDepth??this.#r})}";
const patchedStreamTokens =
  "streamTokens(t,n){return this.model.streamTokenIdsFromCache({input_ids:[t.suffixIds],generation_state:this.#t,max_new_tokens:t.maxNewTokens,eos_token_id:t.eosTokenId,stop_on_eos:t.stopOnEos,signal:n.signal,onPrefillDone:n.onPrefillDone,decode_pipeline_depth:n.decodePipelineDepth??this.#r})}";

let source = fs.readFileSync(bundlePath, "utf8");

function hasControlPatch(text) {
  return text.includes("let m=!n.preserveControlTokens")
    && text.includes("rawText:o");
}

function hasToolPatch(text) {
  return text.includes("this._agentTools=n.tools??null")
    && text.includes("function _wllmBonsaiStopTool(")
    && text.includes("tools:this._agentTools??null");
}

function refreshPrefillTelemetry(text) {
  let next = text;
  if (next.includes(upstreamStreamTokens)) {
    next = next.replace(upstreamStreamTokens, patchedStreamTokens);
  } else if (!next.includes(patchedStreamTokens)) {
    throw new Error("Expected Bonsai streamTokens pattern was not found");
  }

  if (next.includes(toolOnlyDecodeLoop)) {
    next = next.replace(toolOnlyDecodeLoop, patchedDecodeLoop);
  } else if (!next.includes('yield{phase:"prefill",status:"start"')) {
    throw new Error("Expected Bonsai decode loop pattern was not found");
  }
  return { source: next, changed: next !== text };
}

function refreshInlineStopScanner(text) {
  const start = text.indexOf("function _wllmBonsaiStopTool(");
  if (start === -1) return { source: text, changed: false };
  const end = text.indexOf(";let _wllmStopNames=", start);
  if (end === -1) {
    throw new Error("Existing Bonsai stop scanner boundary was not found");
  }
  const existing = text.slice(start, end);
  if (existing === BONSAI_INLINE_STOP_TOOL_FN) {
    return { source: text, changed: false };
  }
  return {
    source:
      text.slice(0, start)
      + BONSAI_INLINE_STOP_TOOL_FN
      + text.slice(end),
    changed: true,
  };
}

if (hasToolPatch(source)) {
  const refreshed = refreshInlineStopScanner(source);
  const instrumented = refreshPrefillTelemetry(refreshed.source);
  if (refreshed.changed || instrumented.changed) {
    fs.writeFileSync(bundlePath, instrumented.source);
    console.log("Refreshed bonsai-27b.js tool scanner and prefill telemetry");
  } else {
    console.log("bonsai-27b.js already patched (tools + control tokens + prefill)");
  }
  process.exit(0);
}

if (!source.includes(upstreamRender)) {
  console.error("Expected upstream Bonsai render pattern was not found");
  process.exit(1);
}
source = source.replace(upstreamRender, patchedRender);

if (source.includes(controlOnlyStart)) {
  source = source.replace(controlOnlyStart, toolPatchedStart);
} else if (!source.includes("this._agentTools=n.tools??null")) {
  console.error("Expected Bonsai generate entry pattern was not found");
  process.exit(1);
}

if (source.includes(upstreamDecodeLoop)) {
  source = source.replace(upstreamDecodeLoop, patchedDecodeLoop);
} else if (!source.includes("function _wllmBonsaiStopTool(")) {
  console.error("Expected Bonsai decode loop pattern was not found");
  process.exit(1);
}

source = refreshPrefillTelemetry(source).source;

if (!hasControlPatch(source)) {
  console.error("Control-token patch markers missing before tool patch");
  process.exit(1);
}

fs.writeFileSync(bundlePath, source);
console.log("Patched bonsai-27b.js (tools + control tokens + prefill)");
