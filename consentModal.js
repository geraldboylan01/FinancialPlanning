import { profile } from "./profile.js";
export function showConsent(pdfUrl) {
  return new Promise(res=>{
    const overlay=document.createElement("div");
    overlay.className="modal";
    overlay.innerHTML=`<div class="wizard-card" style="max-width:460px">
      <h2>Looking for more personalised financial guidance?</h2>
      <p>With your permission, we can share your results with a vetted Irish financial adviser. If your situation aligns with their expertise, they may get in touch to explore how they can support your goals.</p>
      <p><strong>Why we need your permission:</strong> To protect your privacy under GDPR, your information is only shared with your explicit consent. You can withdraw this at any time.</p>
      <label for="consentName" style="margin-top:1rem">Name</label>
      <input id="consentName" type="text" style="width:100%;padding:.55rem .7rem;margin-top:.25rem;border:none;border-radius:8px;background:#404040;color:#fff" />
      <label for="consentEmail" style="margin-top:1rem">Email</label>
      <input id="consentEmail" type="email" style="width:100%;padding:.55rem .7rem;margin-top:.25rem;border:none;border-radius:8px;background:#404040;color:#fff" />
      <div id="consentErr" class="error" style="display:none"></div>
      <div style="margin-top:1rem; display:flex; gap:1rem">
        <button id="cNo">Not now</button>
        <button id="cYes">Share & Continue</button>
      </div>
      <small>Encrypted, EU-hosted, auto-deleted after 90 days.</small>
    </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#cNo').onclick=()=>{document.body.removeChild(overlay);res(false);};
    const nameInput=overlay.querySelector('#consentName');
    const emailInput=overlay.querySelector('#consentEmail');
    const errBox=overlay.querySelector('#consentErr');
    overlay.querySelector('#cYes').onclick=()=>{
      const name=nameInput.value.trim();
      const email=emailInput.value.trim();
      if(!name){
        errBox.textContent='Please enter your name.';
        errBox.style.display='block';
        return;
      }
      if(!/^([^\s@]+)@([^\s@]+)\.[^\s@]+$/.test(email)){
        errBox.textContent='Please enter a valid email address.';
        errBox.style.display='block';
        return;
      }
      errBox.style.display='none';
      fetch("/api/shareWithAdviser",{method:"POST",headers:{'Content-Type':'application/json'},
        body:JSON.stringify({profile,pdfUrl,name,email})}).finally(()=>{
          document.body.removeChild(overlay);res(true);
      });
    };
  });
}
