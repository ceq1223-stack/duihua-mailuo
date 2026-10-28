/* Only trusted extension pages receive small index/status notifications. */
const AtlasUpdates=(()=>{
  const ports=new Set();
  chrome.runtime.onConnect?.addListener(port=>{
    if(port.name!=='atlas-ui'||!AtlasTrust.isUI(port.sender)){port.disconnect();return;}
    ports.add(port);port.onDisconnect.addListener(()=>ports.delete(port));
  });
  return {notify(message){for(const port of ports){try{port.postMessage(message);}catch{ports.delete(port);}}}};
})();
