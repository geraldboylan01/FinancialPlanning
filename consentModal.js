import { profile } from "./profile.js";
export function showConsent(pdfUrl) {
  return new Promise(res=>{
    const overlay=document.createElement("div");
    overlay.className="modal";
    overlay.innerHTML=`<div class="wizard-card" style="max-width:460px">
      <h2>Looking for more personalised financial guidance?</h2>
      <p>With your permission, we can share your results with a vetted Irish financial adviser. If your situation aligns with their expertise, they may get in touch to explore how they can support your goals.</p>
      <p><strong>Why we need your permission:</strong> To protect your privacy under GDPR, your information is only shared with your explicit consent. You can withdraw this at any time.</p>
      <div style="margin-top:1rem; display:flex; gap:1rem">
        <button id="cNo">Not now</button>
        <button id="cYes">Share & Continue</button>
      </div>
      <small>Encrypted, EU-hosted, auto-deleted after 90 days.</small>
    </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#cNo').onclick=()=>{document.body.removeChild(overlay);res(false);};
    overlay.querySelector('#cYes').onclick=()=>{
      fetch("/api/shareWithAdviser",{method:"POST",headers:{'Content-Type':'application/json'},
        body:JSON.stringify({profile,pdfUrl})}).finally(()=>{
          document.body.removeChild(overlay);res(true);
      });
    };
  });
}
