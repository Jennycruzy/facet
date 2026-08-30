const root = document.documentElement;
const saved = localStorage.getItem("facet-theme");
if (saved === "light" || saved === "dark") root.dataset.theme = saved;
else if (window.matchMedia?.("(prefers-color-scheme: light)").matches) root.dataset.theme = "light";

const nav = document.querySelector(".appnav");
let toggle = document.getElementById("theme-toggle");
if (!toggle && nav) {
  toggle = document.createElement("button");
  toggle.id = "theme-toggle";
  toggle.className = "theme-toggle";
  toggle.type = "button";
  toggle.setAttribute("aria-label", "Switch color theme");
  nav.append(toggle);
}
function render() {
  if (toggle) toggle.textContent = root.dataset.theme === "light" ? "Dark" : "Light";
}
if (toggle) toggle.onclick = () => {
  root.dataset.theme = root.dataset.theme === "light" ? "dark" : "light";
  localStorage.setItem("facet-theme", root.dataset.theme);
  render();
};
render();
