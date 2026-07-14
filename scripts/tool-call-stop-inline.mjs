/** @file Inline tool-call stop scanner injected into gemma-4-e2b.js by patch script. */

/** Brace-aware stop check — keep behavior aligned with lib/tool-call-syntax.js. */
export const INLINE_STOP_TOOL_FN = `
function _wllmStopTool(p,n){
  if(!n?.length)return!1;
  const e='<|"|>',o=["<|channel>thought","<|think|>"],c="<channel|>";
  function i(s,t){
    let r=!1,l=0;
    while(l<t){
      let a=-1,u=0;
      for(const v of o){
        const d=s.indexOf(v,l);
        if(d!==-1&&(a===-1||d<a)){a=d;u=v.length}
      }
      const h=s.indexOf(c,l);
      if(a!==-1&&(h===-1||a<h)){r=!0;l=a+u}
      else if(h!==-1){r=!1;l=h+c.length}
      else break
    }
    return r
  }
  for(const a of n){
    const r=new RegExp("(?:<\\\\|tool_call\\\\|?>(?:call:)?|\\\\b(?:call:)?)"+a+"\\\\{","g");
    let t;
    while((t=r.exec(p))!==null){
      if(i(p,t.index))continue;
      const u=t.index+t[0].length-1;
      let depth=0,quoted=!1,escaped=!1;
      for(let d=u;d<p.length;d++){
        if(p.startsWith(e,d)){
          const v=p.indexOf(e,d+e.length);
          if(v===-1){depth=0;break}
          d=v+e.length-1;continue
        }
        const v=p[d];
        if(v==="\\\\"&&quoted){escaped=!escaped;continue}
        if(v==='"'&&!escaped){quoted=!quoted;continue}
        escaped=!1;
        if(quoted)continue;
        if(v==="{")depth++;
        else if(v==="}"){
          depth--;
          if(depth===0){
            return!0
          }
        }
      }
    }
  }
  return!1
}`;

export const INLINE_STOP_CONDITION =
  "_wllmStopNames&&!g&&_wllmStopTool(p,_wllmStopNames)";
