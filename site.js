
const API_URL = "http://127.0.0.1:4000";

const $ = (id) => document.getElementById(id);

let allPosts = [];
let requestController = null;

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function formatDate(value) {
  if (!value) return "";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  return date.toLocaleDateString("en-PK", {
    day: "numeric",
    month: "short",
    year: "numeric"
  });
}

function categoryIcon(category) {
  const icons = {
    "Assignments": "✎",
    "Articles & Notes": "▤",
    "Chapters": "▧"
  };

  return icons[category] || "📚";
}

function showMessage(message, className = "") {
  const grid = $("resourceGrid");
  if (!grid) return;

  grid.innerHTML = `
    <div class="resource-message ${className}">
      ${escapeHTML(message)}
    </div>
  `;
}

async function loadResources() {
  if (requestController) {
    requestController.abort();
  }

  requestController = new AbortController();

  showMessage("Loading your study resources...");

  try {
    const response = await fetch(`${API_URL}/api/posts`, {
      method: "GET",
      headers: { "Accept": "application/json" },
      cache: "no-store",
      signal: requestController.signal
    });

    if (!response.ok) {
      throw new Error(`Server returned HTTP ${response.status}`);
    }

    const data = await response.json();

    if (!Array.isArray(data)) {
      throw new Error("Unexpected response from the server.");
    }

    allPosts = data;
    renderResources();

  } catch (error) {
    if (error.name === "AbortError") return;

    console.error("Could not load study resources:", error);

    showMessage(
      "Study resources could not be loaded. Please check that the backend is running.",
      "resource-error"
    );
  }
}

function renderResources() {
  const grid = $("resourceGrid");
  if (!grid) return;

  const query = ($("searchInput")?.value || "")
    .toLowerCase()
    .trim();

  const category = $("categoryFilter")?.value || "all";

  const posts = allPosts.filter((post) => {
    const matchesCategory =
      category === "all" || post.category === category;

    const searchableText = [
      post.title,
      post.description,
      post.category
    ].join(" ").toLowerCase();

    return matchesCategory && searchableText.includes(query);
  });

  if (posts.length === 0) {
    showMessage(
      allPosts.length === 0
        ? "No study resources have been published yet."
        : "No resources match your search. Try another keyword or category.",
      "resource-empty"
    );

    if ($("emptyState")) $("emptyState").hidden = true;
    return;
  }

  grid.innerHTML = posts.map((post, index) => {
    const title = escapeHTML(post.title || "Untitled resource");
    const description = escapeHTML(
      post.description || "Open this resource to view its details."
    );
    const categoryName = escapeHTML(post.category || "Study Resources");
    const date = escapeHTML(formatDate(post.created_at));
    const icon = categoryIcon(post.category);

    const hasPdf = Boolean(post.pdf_name);
    const pdfUrl = `${API_URL}/api/posts/${encodeURIComponent(post.id)}/pdf`;

    return `
      <article class="resource-card" style="--card-index:${index}">
        <div class="resource-card-top">
          <div class="resource-icon" aria-hidden="true">
            ${icon}
          </div>
          <span class="resource-badge">${categoryName}</span>
        </div>

        <h3>${title}</h3>
        <p>${description}</p>

        <div class="resource-meta">
          <span>${date}</span>
          ${
            hasPdf
              ? `<span class="pdf-indicator">PDF attached</span>`
              : `<span>No PDF attached</span>`
          }
        </div>

        ${
          hasPdf
            ? `
              <a
                class="resource-link"
                href="${pdfUrl}"
                target="_blank"
                rel="noopener"
              >
                Open / Download PDF <span aria-hidden="true">↗</span>
              </a>
            `
            : `
              <span class="resource-link resource-link-disabled">
                Study resource
              </span>
            `
        }
      </article>
    `;
  }).join("");

  if ($("emptyState")) $("emptyState").hidden = true;
}

document.addEventListener("DOMContentLoaded", () => {
  const year = $("year");
  if (year) year.textContent = new Date().getFullYear();

  $("searchInput")?.addEventListener("input", renderResources);
  $("categoryFilter")?.addEventListener("change", renderResources);

  $("menuToggle")?.addEventListener("click", () => {
    $("siteNav")?.classList.toggle("open");
  });

  document.querySelectorAll("#siteNav a").forEach((link) => {
    link.addEventListener("click", () => {
      $("siteNav")?.classList.remove("open");
    });
  });

  loadResources();
});
