import { profile } from "./profile.js";
export function showConsent(pdfUrl) {
  return new Promise(res=>{
    const overlay=document.createElement("div");
    overlay.className="modal";
    overlay.innerHTML=`<div class="wizard-card" style="max-width:460px">
      <h2>Want a personalised second opinion?</h2>
      <p>Share these results with a vetted Irish financial adviser in one click. They’ll review your numbers and offer a free 15-minute call.</p>
      <p><strong>Why we need your OK:</strong> To protect your privacy (GDPR) we only pass your answers with explicit consent. You can revoke at any time.</p>
      <label><input type="checkbox" id="consentChk"> Yes—securely send my data</label>
      <div style="margin-top:1rem; display:flex; gap:1rem">
        <button id="cNo">Not now</button>
        <button id="cYes" disabled>Share & Continue</button>
      </div>
      <small>Encrypted, EU-hosted, auto-deleted after 90 days.</small>
    </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#consentChk').onchange=e=>{
      overlay.querySelector('#cYes').disabled=!e.target.checked;
    };
    overlay.querySelector('#cNo').onclick=()=>{document.body.removeChild(overlay);res(false);};
    overlay.querySelector('#cYes').onclick=()=>{
      fetch("/api/shareWithAdviser",{method:"POST",headers:{'Content-Type':'application/json'},
        body:JSON.stringify({profile,pdfUrl})}).finally(()=>{
          document.body.removeChild(overlay);res(true);
      });
    };
  });
}
