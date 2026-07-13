#!/usr/bin/env node
/** Apply the reproducible WebLLM integration patch to the upstream bundle. */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  INLINE_STOP_TOOL_FN,
  INLINE_STOP_CONDITION,
} from "./tool-call-stop-inline.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const bundlePath = path.join(__dirname, "..", "gemma-4-e2b.js");

const upstreamEncode =
  "encodePrompt(n){let r=this.#t.render({messages:n,tools:null,bos_token:this.#i.bos_token,eos_token:this.#i.eos_token,add_generation_prompt:!0,enable_thinking:!0});return this.#a.encode(r,{add_special_tokens:!1}).ids}";
const patchedEncode =
  "encodePrompt(n){let r=this.#t.render({messages:n,tools:this._agentTools??null,bos_token:this.#i.bos_token,eos_token:this.#i.eos_token,add_generation_prompt:!0,enable_thinking:this._enableThinking??!0});return this.#a.encode(r,{add_special_tokens:!1}).ids}";

const upstreamGenerate =
  'async*generate(n,r={}){if(this.#l)throw new Error("Gemma4Mobile has been disposed");let t=r.maxNewTokens??512,a=r.eosTokenId??this.#s,s=this.encodePrompt(n),o=Gp(this.#u,s);o!==this.#u.length&&(this.#c(),o=0);let i=s.slice(o);i.length===0&&(this.#c(),i=s.slice());let u=[],l="",c=!1;try{for await(let d of this.#n.streamTokenIdsFromCache({input_ids:[i],generation_state:this.#o,max_new_tokens:t,eos_token_id:a,stop_on_eos:!0})){if(r.signal?.aborted){c=!0;break}u.push(d);let p=this.#a.decode(u,{skip_special_tokens:!0}),f=p.startsWith(l)?p.slice(l.length):this.#a.decode([d],{skip_special_tokens:!0});l=p,yield{token:d,delta:f,text:l}}}finally{if(c)this.#c();else{let d=u.length<t;this.#u=s.concat(d?u:u.slice(0,-1))}}}';

const patchedGenerate =
  'async*generate(n,r={}){if(this.#l)throw new Error("Gemma4Mobile has been disposed");this._agentTools=r.tools??null;this._preserveControlTokens=!!r.preserveControlTokens;this._enableThinking=r.enableThinking??!0;this._stopMode=r.stopMode??null;this._stopToolNames=r.stopToolNames??null;this._stopOnToolCall=!!(r.stopOnToolCall||r.stopMode==="tool_call");if(r.signal?.aborted)return;let t=r.maxNewTokens??512,a=r.eosTokenId??this.#s,s=this.encodePrompt(n),o=Gp(this.#u,s);o!==this.#u.length&&(this.#c(),o=0);let i=s.slice(o);i.length===0&&(this.#c(),i=s.slice());let u=[],l="",c=!1,g=!1,m=!this._preserveControlTokens;' +
  INLINE_STOP_TOOL_FN +
  ';let _wllmStopNames=r.stopToolNames??(this._stopOnToolCall?["web_search"]:null),P=!1,h=null;if(i.length>0)yield{phase:"prefill",status:"start",prefillTokens:i.length,promptTokens:s.length,cachedTokens:o};try{for await(let d of this.#n.streamTokenIdsFromCache({input_ids:[i],generation_state:this.#o,max_new_tokens:t,eos_token_id:a,stop_on_eos:!0,signal:r.signal,onPrefillDone:e=>{h=e;r.onPrefillDone?.(e)}})){if(!P&&h){P=!0;yield{phase:"prefill",status:"done",prefillTokens:h.tokens,cacheLength:h.cache_length}}if(r.signal?.aborted){c=!0;break}u.push(d);let p=this.#a.decode(u,{skip_special_tokens:m}),f=p.startsWith(l)?p.slice(l.length):this.#a.decode([d],{skip_special_tokens:m});l=p,yield{token:d,delta:f,text:l,rawText:p,phase:"decode"};if(' +
  INLINE_STOP_CONDITION +
  '){g=!0;break}}}finally{if(c)this.#c();else{let d=u.length<t&&!g;this.#u=s.concat(d?u:u.slice(0,-1))}}}';

let source = fs.readFileSync(bundlePath, "utf8");
const hasPatchedRuntime = source.includes(patchedEncode)
  && source.includes("function _wllmStopTool(p,n){")
  && source.includes('signal:r.signal,onPrefillDone');
const currentScanner = INLINE_STOP_TOOL_FN.trim();

if (hasPatchedRuntime && source.includes(currentScanner)) {
  console.log("gemma-4-e2b.js already patched");
  process.exit(0);
}
if (hasPatchedRuntime) {
  const scannerStart = source.indexOf("function _wllmStopTool(p,n){");
  const scannerEndMarker = "\n  return!1\n}";
  const scannerEnd = source.indexOf(scannerEndMarker, scannerStart);
  if (scannerStart < 0 || scannerEnd < 0) {
    console.error("Could not locate the existing inline stop scanner");
    process.exit(1);
  }
  source = source.slice(0, scannerStart)
    + currentScanner
    + source.slice(scannerEnd + scannerEndMarker.length);
  fs.writeFileSync(bundlePath, source);
  console.log("Updated tool-call stop scanner in gemma-4-e2b.js");
  process.exit(0);
}
if (!source.includes(upstreamEncode) || !source.includes(upstreamGenerate)) {
  console.error("Expected upstream Gemma bundle patterns were not found");
  process.exit(1);
}

source = source
  .replace(upstreamEncode, patchedEncode)
  .replace(upstreamGenerate, patchedGenerate);
fs.writeFileSync(bundlePath, source);
console.log("Patched gemma-4-e2b.js");
