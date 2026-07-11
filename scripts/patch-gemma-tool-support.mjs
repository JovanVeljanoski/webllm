#!/usr/bin/env node
/**
 * Reproducible patch for gemma-4-e2b.js tool-calling support.
 * Run after updating the vendored bundle: node scripts/patch-gemma-tool-support.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  INLINE_STOP_TOOL_FN,
  INLINE_STOP_CONDITION,
  REGEX_STOP_CONDITION,
} from "./tool-call-stop-inline.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BUNDLE = path.join(__dirname, "..", "gemma-4-e2b.js");

const OLD_ENCODE =
  "encodePrompt(n){let r=this.#t.render({messages:n,tools:null,bos_token:this.#i.bos_token,eos_token:this.#i.eos_token,add_generation_prompt:!0,enable_thinking:!0});return this.#a.encode(r,{add_special_tokens:!1}).ids}";

const NEW_ENCODE =
  "encodePrompt(n){let r=this.#t.render({messages:n,tools:this._agentTools??null,bos_token:this.#i.bos_token,eos_token:this.#i.eos_token,add_generation_prompt:!0,enable_thinking:this._enableThinking??!0});return this.#a.encode(r,{add_special_tokens:!1}).ids}";

const OLD_GENERATE =
  'async*generate(n,r={}){if(this.#l)throw new Error("Gemma4Mobile has been disposed");let t=r.maxNewTokens??512,a=r.eosTokenId??this.#s,s=this.encodePrompt(n),o=Gp(this.#u,s);o!==this.#u.length&&(this.#c(),o=0);let i=s.slice(o);i.length===0&&(this.#c(),i=s.slice());let u=[],l="",c=!1;try{for await(let d of this.#n.streamTokenIdsFromCache({input_ids:[i],generation_state:this.#o,max_new_tokens:t,eos_token_id:a,stop_on_eos:!0})){if(r.signal?.aborted){c=!0;break}u.push(d);let p=this.#a.decode(u,{skip_special_tokens:!0}),f=p.startsWith(l)?p.slice(l.length):this.#a.decode([d],{skip_special_tokens:!0});l=p,yield{token:d,delta:f,text:l}}}finally{if(c)this.#c();else{let d=u.length<t;this.#u=s.concat(d?u:u.slice(0,-1))}}}';

const GENERATE_INIT_OLD = "this._stopOnToolCall=!!r.stopOnToolCall;";
const GENERATE_INIT_NEW =
  'this._stopMode=r.stopMode??null;this._stopToolNames=r.stopToolNames??null;this._stopOnToolCall=!!(r.stopOnToolCall||r.stopMode==="tool_call");';
const GENERATE_VARS_OLD = "let u=[],l=\"\",c=!1,g=!1,m=!this._preserveControlTokens";
const GENERATE_VARS_NEW =
  `let u=[],l="",c=!1,g=!1,m=!this._preserveControlTokens;${INLINE_STOP_TOOL_FN};let _wllmStopNames=r.stopToolNames??(this._stopOnToolCall?["web_search"]:null)`;

const NEW_GENERATE =
  'async*generate(n,r={}){if(this.#l)throw new Error("Gemma4Mobile has been disposed");this._agentTools=r.tools??null;this._preserveControlTokens=!!r.preserveControlTokens;this._enableThinking=r.enableThinking??!0;' +
  GENERATE_INIT_NEW +
  'let t=r.maxNewTokens??512,a=r.eosTokenId??this.#s,s=this.encodePrompt(n),o=Gp(this.#u,s);o!==this.#u.length&&(this.#c(),o=0);let i=s.slice(o);i.length===0&&(this.#c(),i=s.slice());' +
  GENERATE_VARS_NEW +
  ',P=!1,h=null;if(i.length>0)yield{phase:"prefill",status:"start",prefillTokens:i.length,promptTokens:s.length,cachedTokens:o};try{for await(let d of this.#n.streamTokenIdsFromCache({input_ids:[i],generation_state:this.#o,max_new_tokens:t,eos_token_id:a,stop_on_eos:!0,onPrefillDone:e=>{h=e;r.onPrefillDone?.(e)}})){if(!P&&h){P=!0;yield{phase:"prefill",status:"done",prefillTokens:h.tokens,cacheLength:h.cache_length}}if(r.signal?.aborted){c=!0;break}u.push(d);let p=this.#a.decode(u,{skip_special_tokens:m}),f=p.startsWith(l)?p.slice(l.length):this.#a.decode([d],{skip_special_tokens:m});l=p,yield{token:d,delta:f,text:l,rawText:p,phase:"decode"};if(' +
  INLINE_STOP_CONDITION +
  '){g=!0;break}}}finally{if(c)this.#c();else{let d=u.length<t&&!g;this.#u=s.concat(d?u:u.slice(0,-1))}}}';

const PREVIOUS_GENERATE =
  'async*generate(n,r={}){if(this.#l)throw new Error("Gemma4Mobile has been disposed");this._agentTools=r.tools??null;this._preserveControlTokens=!!r.preserveControlTokens;this._enableThinking=r.enableThinking??!0;this._stopOnToolCall=!!r.stopOnToolCall;let t=r.maxNewTokens??512,a=r.eosTokenId??this.#s,s=this.encodePrompt(n),o=Gp(this.#u,s);o!==this.#u.length&&(this.#c(),o=0);let i=s.slice(o);i.length===0&&(this.#c(),i=s.slice());let u=[],l="",c=!1,g=!1,m=!this._preserveControlTokens;try{for await(let d of this.#n.streamTokenIdsFromCache({input_ids:[i],generation_state:this.#o,max_new_tokens:t,eos_token_id:a,stop_on_eos:!0})){if(r.signal?.aborted){c=!0;break}u.push(d);let p=this.#a.decode(u,{skip_special_tokens:m}),f=p.startsWith(l)?p.slice(l.length):this.#a.decode([d],{skip_special_tokens:m});l=p,yield{token:d,delta:f,text:l,rawText:p};if(this._stopOnToolCall&&!g&&/<\\|tool_call>(?:call:)?\\w+\\{[\\s\\S]*\\}(?:<tool_call\\|>|<turn\\|>)\\s*$/.test(p)){g=!0;break}}}finally{if(c)this.#c();else{let d=u.length<t&&!g;this.#u=s.concat(d?u:u.slice(0,-1))}}}';

const OLD_STOP =
  'if(this._stopOnToolCall&&!g&&/<\\|tool_call>(?:call:)?\\w+\\{[\\s\\S]*\\}<tool_call\\|>\\s*$/.test(p)){g=!0;break}';
const NEW_STOP =
  'if(this._stopOnToolCall&&!g&&/<\\|tool_call\\|?>(?:call:)?\\w+\\{[\\s\\S]*\\}(?:<tool_call\\|>|<turn\\|>|$)?\\s*$/.test(p)){g=!0;break}';

const OLD_STOP_V2 =
  'if(this._stopOnToolCall&&!g&&/<\\|tool_call>(?:call:)?\\w+\\{[\\s\\S]*\\}(?:<tool_call\\|>|<turn\\|>)\\s*$/.test(p)){g=!0;break}';

let src = fs.readFileSync(BUNDLE, "utf8");
let changed = false;
const alreadyPatched = src.includes(NEW_ENCODE) && src.includes("_agentTools=r.tools");

if (alreadyPatched) {
  if (src.includes(PREVIOUS_GENERATE) && !src.includes('phase:"prefill"')) {
    src = src.replace(PREVIOUS_GENERATE, NEW_GENERATE);
    changed = true;
    console.log("Upgraded generate() for prefill progress events");
  } else if (!src.includes("_wllmStopTool") && src.includes(REGEX_STOP_CONDITION)) {
    if (src.includes(GENERATE_INIT_OLD) && !src.includes("_stopMode=r.stopMode")) {
      src = src.replace(GENERATE_INIT_OLD, GENERATE_INIT_NEW);
      changed = true;
    }
    if (src.includes("let u=[],l=\"\",c=!1,g=!1,m=!this._preserveControlTokens,P=!1")) {
      src = src.replace(
        "let u=[],l=\"\",c=!1,g=!1,m=!this._preserveControlTokens,P=!1",
        `${GENERATE_VARS_NEW},P=!1`,
      );
      changed = true;
    }
    src = src.replace(REGEX_STOP_CONDITION, INLINE_STOP_CONDITION);
    changed = true;
    console.log("Upgraded stopOnToolCall to shared brace-aware scanner");
  } else if (src.includes(OLD_STOP)) {
    src = src.replace(OLD_STOP, NEW_STOP);
    changed = true;
    console.log("Upgraded stopOnToolCall regex (<turn|> end tag support)");
  } else if (src.includes(OLD_STOP_V2) && !src.includes("tool_call\\\\|?>")) {
    src = src.replace(OLD_STOP_V2, NEW_STOP);
    changed = true;
    console.log("Upgraded stopOnToolCall regex (malformed <|tool_call|> opener)");
  } else if (src.includes('phase:"prefill"')) {
    console.log("gemma-4-e2b.js already patched for tool support + prefill");
  } else {
    console.log("gemma-4-e2b.js already patched for tool support");
  }
} else {
  if (!src.includes(OLD_ENCODE)) {
    console.error("encodePrompt pattern not found — bundle may have changed");
    process.exit(1);
  }
  src = src.replace(OLD_ENCODE, NEW_ENCODE);
  changed = true;

  if (!src.includes(OLD_GENERATE)) {
    console.error("generate pattern not found — bundle may have changed");
    process.exit(1);
  }
  src = src.replace(OLD_GENERATE, NEW_GENERATE);
  changed = true;
  console.log("Patched gemma-4-e2b.js for tool calling support");
}

if (changed) {
  fs.writeFileSync(BUNDLE, src);
}
