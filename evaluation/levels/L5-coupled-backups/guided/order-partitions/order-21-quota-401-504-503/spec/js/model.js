const E = name => bp.Event(name);
const REQUESTS = any(/^(POST|PUT|GET) \/.*/);
const RESPONSES = any(/^(200|201|204|401|409|503|504) /);

function chooseWork(pA,pB,hasCheckpoint,expirySeen) {
  if (pA<1) return "UPLOAD_A";
  if (pB<1) return "UPLOAD_B";
  if (!hasCheckpoint && !expirySeen) return "CHECKPOINT";
  if (pA<2) return "UPLOAD_A";
  if (pB<2) return "UPLOAD_B";
  return "COMMIT";
}

bthread("Guided coupled-backup controller", function () {
  let phase="CREATE_A", pA=0, pB=0, cpA=0, cpB=0;
  let hasCheckpoint=false, expirySeen=false, lastTarget="", ambiguousTarget="", observed;
  while (true) {
    if (phase==="CREATE_A") bp.sync({request:E("POST /sessions/A"),block:RESPONSES});
    else if (phase==="CREATE_B") bp.sync({request:E("POST /sessions/B"),block:RESPONSES});
    else if (phase==="RECREATE_A") bp.sync({request:E("POST /sessions/A"),block:RESPONSES});
    else if (phase==="RECREATE_B") bp.sync({request:E("POST /sessions/B"),block:RESPONSES});
    else if (phase==="UPLOAD_A") { lastTarget="A"; bp.sync({request:E("PUT /sessions/A/chunks/"+(pA+1)),block:RESPONSES}); }
    else if (phase==="UPLOAD_B") { lastTarget="B"; bp.sync({request:E("PUT /sessions/B/chunks/"+(pB+1)),block:RESPONSES}); }
    else if (phase==="STATUS") bp.sync({request:E("GET /sessions/"+ambiguousTarget+"/status"),block:RESPONSES});
    else if (phase==="CHECKPOINT") bp.sync({request:E("POST /checkpoint-all"),block:RESPONSES});
    else if (phase==="REFRESH") bp.sync({request:E("POST /auth/refresh"),block:RESPONSES});
    else if (phase==="RESTORE") bp.sync({request:E("POST /restore-all"),block:RESPONSES});
    else bp.sync({request:E("POST /commit-all"),block:RESPONSES});

    observed=bp.sync({waitFor:RESPONSES,block:REQUESTS});
    if (observed.name.equals("503 Service Unavailable")) { /* repeat current create */ }
    else if (observed.name.equals("201 Created (A)")) phase=phase==="CREATE_A" ? "CREATE_B" : chooseWork(pA,pB,hasCheckpoint,expirySeen);
    else if (observed.name.equals("201 Created (B)")) phase=chooseWork(pA,pB,hasCheckpoint,expirySeen);
    else if (observed.name.equals("204 No Content")) {
      if (lastTarget==="A") pA++; else pB++;
      phase=chooseWork(pA,pB,hasCheckpoint,expirySeen);
    } else if (observed.name.equals("504 Gateway Timeout")) {
      ambiguousTarget=lastTarget; phase="STATUS";
    } else if (observed.name.indexOf("200 A Prefix(")===0) {
      pA=parseInt(observed.name.substring(13)); phase=chooseWork(pA,pB,hasCheckpoint,expirySeen);
    } else if (observed.name.indexOf("200 B Prefix(")===0) {
      pB=parseInt(observed.name.substring(13)); phase=chooseWork(pA,pB,hasCheckpoint,expirySeen);
    } else if (observed.name.equals("401 Unauthorized")) phase="REFRESH";
    else if (observed.name.equals("200 OK (token refreshed)")) {
      expirySeen=true;
      if (hasCheckpoint) phase="RESTORE";
      else { pA=0; pB=0; phase="CREATE_A"; }
    } else if (observed.name.equals("201 Checkpointed")) {
      hasCheckpoint=true; cpA=pA; cpB=pB; phase=chooseWork(pA,pB,hasCheckpoint,expirySeen);
    } else if (observed.name.equals("201 Restored")) {
      pA=cpA; pB=cpB; phase=chooseWork(pA,pB,hasCheckpoint,expirySeen);
    } else if (observed.name.equals("409 QuotaRebalance(A)")) {
      if (hasCheckpoint && 1+(pA-cpA)+(pB-cpB) <= 1+pA) phase="RESTORE";
      else { pA=0; phase="RECREATE_A"; }
    } else if (observed.name.equals("409 QuotaRebalance(B)")) {
      if (hasCheckpoint && 1+(pA-cpA)+(pB-cpB) <= 1+pB) phase="RESTORE";
      else { pB=0; phase="RECREATE_B"; }
    } else if (observed.name.equals("201 Committed")) break;
    else bp.ASSERT(false,"STRATEGY_FAILURE: "+observed.name);
  }
});

bthread("Open coupled REST server", function () {
  // null means the original unrestricted environment.  Verification shards
  // replace this with one permutation of the four one-shot disruptions.
  let disruptionOrder=["QUOTA","401","504","503"], disruptionIndex=0;
  let outageUsed=false, expiryUsed=false, expired=false, timeoutUsed=false, quotaUsed=false;
  let tokenEpoch=0, validA=false, validB=false, epochA=-1, epochB=-1, pA=0, pB=0;
  let hasCheckpoint=false, cpA=0, cpB=0, ambiguousTarget="";
  let requestEvent,responseEvent,target="";
  while (true) {
    requestEvent=waitFor(REQUESTS);
    if (requestEvent.name.equals("POST /sessions/A") || requestEvent.name.equals("POST /sessions/B")) {
      target=requestEvent.name.equals("POST /sessions/A") ? "A" : "B";
      if (expired) bp.sync({request:E("401 Unauthorized")});
      else {
        responseEvent=bp.sync({request:(outageUsed || (disruptionOrder!==null && disruptionOrder[disruptionIndex]!=="503")) ? E("201 Created ("+target+")") : [E("201 Created ("+target+")"),E("503 Service Unavailable")]});
        if (responseEvent.name.equals("503 Service Unavailable")) { outageUsed=true; if(disruptionOrder!==null) disruptionIndex++; }
        else if (target==="A") { validA=true; epochA=tokenEpoch; pA=0; }
        else { validB=true; epochB=tokenEpoch; pB=0; }
      }
    } else if (requestEvent.name.indexOf("PUT /sessions/")===0) {
      target=requestEvent.name.indexOf("/A/")>0 ? "A" : "B";
      if (expired) bp.sync({request:E("401 Unauthorized")});
      else if ((target==="A" && !validA) || (target==="B" && !validB)) bp.sync({request:E("409 Invalid Session")});
      else {
        let legal=[E("204 No Content")];
        if (!expiryUsed && (disruptionOrder===null || disruptionOrder[disruptionIndex]==="401")) legal.push(E("401 Unauthorized"));
        if (!timeoutUsed && (disruptionOrder===null || disruptionOrder[disruptionIndex]==="504")) legal.push(E("504 Gateway Timeout"));
        if (!quotaUsed && validA && (disruptionOrder===null || disruptionOrder[disruptionIndex]==="QUOTA")) legal.push(E("409 QuotaRebalance(A)"));
        if (!quotaUsed && validB && (disruptionOrder===null || disruptionOrder[disruptionIndex]==="QUOTA")) legal.push(E("409 QuotaRebalance(B)"));
        responseEvent=bp.sync({request:legal});
        if (responseEvent.name.equals("401 Unauthorized")) { expiryUsed=true; expired=true; if(disruptionOrder!==null) disruptionIndex++; }
        else if (responseEvent.name.equals("504 Gateway Timeout")) { timeoutUsed=true; ambiguousTarget=target; if(disruptionOrder!==null) disruptionIndex++; }
        else if (responseEvent.name.equals("409 QuotaRebalance(A)")) { quotaUsed=true; validA=false; if(disruptionOrder!==null) disruptionIndex++; }
        else if (responseEvent.name.equals("409 QuotaRebalance(B)")) { quotaUsed=true; validB=false; if(disruptionOrder!==null) disruptionIndex++; }
        else if (target==="A") pA++; else pB++;
      }
    } else if (requestEvent.name.indexOf("GET /sessions/")===0) {
      target=requestEvent.name.indexOf("/A/")>0 ? "A" : "B";
      if (expired) bp.sync({request:E("401 Unauthorized")});
      else if (ambiguousTarget===target) {
        let prefix=target==="A" ? pA : pB;
        responseEvent=bp.sync({request:[E("200 "+target+" Prefix("+prefix+")"),E("200 "+target+" Prefix("+(prefix+1)+")")]});
        if (responseEvent.name.equals("200 "+target+" Prefix("+(prefix+1)+")")) { if(target==="A") pA++; else pB++; }
        ambiguousTarget="";
      } else bp.sync({request:E("200 "+target+" Prefix("+(target==="A"?pA:pB)+")")});
    } else if (requestEvent.name.equals("POST /auth/refresh")) {
      bp.sync({request:E("200 OK (token refreshed)")}); tokenEpoch++; expired=false; validA=false; validB=false;
    } else if (requestEvent.name.equals("POST /checkpoint-all")) {
      if (expired) bp.sync({request:E("401 Unauthorized")});
      else if (validA && validB && epochA===tokenEpoch && epochB===tokenEpoch) {
        bp.sync({request:E("201 Checkpointed")}); hasCheckpoint=true; cpA=pA; cpB=pB;
      } else bp.sync({request:E("409 Invalid Session")});
    } else if (requestEvent.name.equals("POST /restore-all")) {
      if (expired) bp.sync({request:E("401 Unauthorized")});
      else if (hasCheckpoint) {
        bp.sync({request:E("201 Restored")}); validA=true; validB=true; epochA=tokenEpoch; epochB=tokenEpoch; pA=cpA; pB=cpB;
      } else bp.sync({request:E("409 No Checkpoint")});
    } else {
      let valid=validA&&validB&&epochA===tokenEpoch&&epochB===tokenEpoch&&pA===2&&pB===2&&!expired;
      bp.sync({request:E(valid?"201 Committed":"409 Invalid Session")});
      if(valid) break;
    }
  }
});

bthread("L5 bounded-success monitor", function () {
  let count=0,responseEvent;
  while(true){
    waitFor(REQUESTS); count++;
    bp.ASSERT(count<=18,"BOUNDED_REACHABILITY_FAILURE: more than 18 requests");
    responseEvent=waitFor(RESPONSES);
    if(responseEvent.name.equals("201 Committed")) break;
  }
});
