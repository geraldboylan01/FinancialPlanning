export const profile = JSON.parse(localStorage.getItem("pp_profile") || "{}");
export function saveProfile() {
  localStorage.setItem("pp_profile", JSON.stringify(profile));
}
