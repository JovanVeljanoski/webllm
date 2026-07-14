#!/usr/bin/env node
/** Preserve LFM control tokens so the adapter can parse native tool calls. */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const bundlePath = path.join(__dirname, "..", "lfm2_5.js");

const upstreamStart =
  'async*generate(n,t={}){if(this.#u)throw new Error("Lfm2Mobile has been disposed");let r=t.maxNewTokens??1024';
const patchedStart =
  'async*generate(n,t={}){if(this.#u)throw new Error("Lfm2Mobile has been disposed");let m=!t.preserveControlTokens,r=t.maxNewTokens??1024';
const upstreamDecode =
  "this.#r.decode(u,{skip_special_tokens:!0}),f=p.startsWith(l)?p.slice(l.length):this.#r.decode([c],{skip_special_tokens:!0});l=p,yield{token:c,delta:f,text:l}";
const patchedDecode =
  "this.#r.decode(u,{skip_special_tokens:m}),f=p.startsWith(l)?p.slice(l.length):this.#r.decode([c],{skip_special_tokens:m});l=p,yield{token:c,delta:f,text:l,rawText:p}";

let source = fs.readFileSync(bundlePath, "utf8");
if (source.includes(patchedStart) && source.includes(patchedDecode)) {
  console.log("lfm2_5.js already patched");
  process.exit(0);
}
if (!source.includes(upstreamStart) || !source.includes(upstreamDecode)) {
  console.error("Expected upstream LFM bundle patterns were not found");
  process.exit(1);
}

source = source
  .replace(upstreamStart, patchedStart)
  .replace(upstreamDecode, patchedDecode);
fs.writeFileSync(bundlePath, source);
console.log("Patched lfm2_5.js");
