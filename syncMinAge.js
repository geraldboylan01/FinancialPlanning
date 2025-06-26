document.addEventListener('DOMContentLoaded', () => {
  const dobField = document.getElementById('dob');
  const ageField = document.getElementById('retireAge');

  const syncMinAge = () => {
    if (!dobField.value) return;
    const today   = new Date();
    const dobDate = new Date(dobField.value);
    const curAge  = Math.floor((today - dobDate) / (365.25 * 24 * 3600 * 1000));
    ageField.min  = String(curAge + 1);
  };

  dobField.addEventListener('change', syncMinAge);
  syncMinAge();
});
