const API_URL = "http://127.0.0.1:4000";
const $ = (id) => document.getElementById(id);

let posts = [];
let isCheckingSession = false;
let isRedirecting = false;

// ---------- Helpers ----------

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function showMessage(message, type = "error") {
  const el = $("formMessage");
  if (!el) return;

  el.textContent = message;
  el.style.color = type === "success" ? "#176b50" : "#b42318";
}

function redirectToLogin() {
  if (isRedirecting) return;

  isRedirecting = true;
  window.location.replace("login.html");
}

async function apiFetch(path, options = {}) {
  let response;

  try {
    response = await fetch(`${API_URL}${path}`, {
      ...options,
      credentials: "include"
    });
  } catch (error) {
    throw new Error(
      "Backend se connection nahi ho raha. Check karein ke server port 4000 par chal raha hai."
    );
  }

  const text = await response.text();
  let data = {};

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(
      `Server ka response samajh nahi aaya. HTTP ${response.status}`
    );
  }

  if (response.status === 401) {
    const error = new Error(
      data.error || "Session expire ho gaya hai. Dobara login karein."
    );
    error.status = 401;
    throw error;
  }

  if (!response.ok) {
    throw new Error(
      data.error || `Request failed. HTTP ${response.status}`
    );
  }

  return data;
}

// ---------- Session ----------

async function checkAdminSession() {
  if (isCheckingSession) return false;

  isCheckingSession = true;

  try {
    const data = await apiFetch("/api/admin/me");
    return Boolean(data && (data.authenticated === true || data.admin));
  } finally {
    isCheckingSession = false;
  }
}

// ---------- Posts ----------

async function loadPosts() {
  try {
    const data = await apiFetch("/api/posts");

    if (!Array.isArray(data)) {
      throw new Error("Posts API ne unexpected response diya.");
    }

    posts = data;
    renderAdmin();
    return true;
  } catch (error) {
    console.error("Load posts error:", error);

    const recent = $("recentPosts");
    const allPosts = $("allPosts");
    const empty = $("postsEmpty");

    if (recent) {
      recent.textContent = "Posts load nahi ho sake.";
    }

    if (allPosts) allPosts.innerHTML = "";
    if (empty) empty.hidden = false;

    // Posts endpoint error se admin ko automatically logout na karein.
    return false;
  }
}

function formatDate(value) {
  if (!value) return "—";

  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleDateString();
}

function renderAdmin() {
  const sorted = [...posts].sort(
    (a, b) =>
      new Date(b.created_at || 0) - new Date(a.created_at || 0)
  );

  if ($("totalCount")) {
    $("totalCount").textContent = sorted.length;
  }

  if ($("assignmentCount")) {
    $("assignmentCount").textContent = sorted.filter(
      (post) => post.category === "Assignments"
    ).length;
  }

  if ($("articleCount")) {
    $("articleCount").textContent = sorted.filter(
      (post) => post.category === "Articles & Notes"
    ).length;
  }

  if ($("recentPosts")) {
    $("recentPosts").innerHTML = sorted.length
      ? `<div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>POST TITLE</th>
                <th>CATEGORY</th>
                <th>DATE</th>
              </tr>
            </thead>
            <tbody>
              ${sorted.slice(0, 4).map((post) => `
                <tr>
                  <td>${escapeHTML(post.title)}</td>
                  <td>${escapeHTML(post.category)}</td>
                  <td>${escapeHTML(formatDate(post.created_at))}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>`
      : `<p class="table-empty">No posts yet. Create your first post.</p>`;
  }

  if ($("allPosts")) {
    $("allPosts").innerHTML = sorted.map((post) => `
      <tr>
        <td>${escapeHTML(post.title)}</td>
        <td>${escapeHTML(post.category)}</td>
        <td>
          ${post.pdf_name
            ? `<a class="pdf-label"
                 href="${API_URL}/api/posts/${encodeURIComponent(post.id)}/pdf"
                 target="_blank"
                 rel="noopener noreferrer">Download PDF ↓</a>`
            : "—"}
        </td>
        <td>${escapeHTML(formatDate(post.created_at))}</td>
        <td>
          <button type="button" class="action-btn"
            data-edit="${escapeHTML(post.id)}">Edit</button>
          <button type="button" class="action-btn delete"
            data-delete="${escapeHTML(post.id)}">Delete</button>
        </td>
      </tr>
    `).join("");
  }

  if ($("postsEmpty")) {
    $("postsEmpty").hidden = sorted.length > 0;
  }
}

// ---------- Navigation ----------

function go(view) {
  document.querySelectorAll(".view").forEach((section) => {
    section.hidden = true;
  });

  const selected = $("view-" + view);

  if (!selected) {
    console.warn("Dashboard view nahi mili:", view);
    return;
  }

  selected.hidden = false;

  document.querySelectorAll(".side-nav [data-view]").forEach((link) => {
    link.classList.toggle("active", link.dataset.view === view);
  });

  if ($("pageTitle")) {
    $("pageTitle").textContent = ({
      dashboard: "Dashboard",
      posts: "All Posts",
      create: "Create Post"
    })[view] || "Dashboard";
  }

  if (view === "create" && $("postId") && !$("postId").value) {
    resetForm();
  }

  window.scrollTo({ top: 0, behavior: "smooth" });
}

function resetForm() {
  if ($("postForm")) $("postForm").reset();
  if ($("postId")) $("postId").value = "";
  if ($("formHeading")) $("formHeading").textContent = "Create a new post";
  if ($("currentFile")) $("currentFile").textContent = "";
  if ($("formMessage")) $("formMessage").textContent = "";
}

// ---------- Create Post / PDF Upload ----------

async function submitPost(event) {
  event.preventDefault();

  const title = $("postTitle")?.value.trim() || "";
  const category = $("postCategory")?.value || "";
  const description = $("postDescription")?.value.trim() || "";
  const file = $("postPdf")?.files?.[0];

  if (!title || !description || !category) {
    showMessage("Title, category aur description fill karein.");
    return;
  }

  if ($("postId")?.value) {
    showMessage(
      "Edit feature ke liye server.js mein secure update API route bhi chahiye."
    );
    return;
  }

  if (file) {
    if (
      file.type !== "application/pdf" ||
      !file.name.toLowerCase().endsWith(".pdf")
    ) {
      showMessage("Sirf valid PDF file select karein.");
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      showMessage("PDF ka size 5 MB se zyada nahi hona chahiye.");
      return;
    }
  }

  const formData = new FormData();
  formData.append("title", title);
  formData.append("category", category);
  formData.append("description", description);

  if (file) formData.append("pdf", file);

  const submitButton = $("postForm")?.querySelector(
    'button[type="submit"]'
  );

  if (submitButton) {
    submitButton.disabled = true;
    submitButton.textContent = "Publishing...";
  }

  try {
    await apiFetch("/api/admin/posts", {
      method: "POST",
      body: formData
    });

    showMessage("Post database mein save ho gaya.", "success");
    resetForm();

    await loadPosts();
    go("posts");
  } catch (error) {
    console.error("Publish post error:", error);
    showMessage(error.message || "Post publish nahi ho saka.");

    if (error.status === 401) {
      showMessage("Session expire hai. Dobara login karein.");
      setTimeout(redirectToLogin, 1000);
    }
  } finally {
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.textContent = "Publish Post →";
    }
  }
}

// ---------- Click Events ----------

document.addEventListener("click", (event) => {
  const nav = event.target.closest("[data-view]");

  if (nav) {
    event.preventDefault();
    go(nav.dataset.view);
    return;
  }

  const action = event.target.closest("[data-go]");

  if (action) {
    event.preventDefault();
    go(action.dataset.go);
    return;
  }

  const editButton = event.target.closest("[data-edit]");

  if (editButton) {
    const post = posts.find(
      (item) => String(item.id) === editButton.dataset.edit
    );

    if (!post) return;

    resetForm();

    if ($("postId")) $("postId").value = post.id;
    if ($("postTitle")) $("postTitle").value = post.title || "";
    if ($("postCategory")) {
      $("postCategory").value = post.category || "Assignments";
    }
    if ($("postDescription")) {
      $("postDescription").value = post.description || "";
    }
    if ($("formHeading")) $("formHeading").textContent = "Edit post";

    if ($("currentFile")) {
      $("currentFile").textContent = post.pdf_name
        ? `Current PDF: ${post.pdf_name}. Update API abhi required hai.`
        : "No PDF attached";
    }

    go("create");
    return;
  }

  const deleteButton = event.target.closest("[data-delete]");

  if (deleteButton) {
    alert(
      "Delete feature ke liye server.js mein secure DELETE API route add karna hoga."
    );
  }
});

// ---------- Logout ----------

async function logoutAdmin() {
  try {
    await apiFetch("/api/admin/logout", { method: "POST" });
  } catch (error) {
    console.warn("Logout request:", error.message);
  }

  redirectToLogin();
}

// HTML mein logout button par id="logoutBtn" lagaya ja sakta hai.
document.addEventListener("click", (event) => {
  if (event.target.closest("#logoutBtn")) {
    event.preventDefault();
    logoutAdmin();
  }
});

// ---------- Initialization ----------

async function initAdmin() {
  try {
    const authenticated = await checkAdminSession();

    if (!authenticated) {
      console.warn("Admin session active nahi hai.");
      redirectToLogin();
      return;
    }

    // Session verified hai; posts load hone ke dauran dashboard ko redirect na karein.
    await loadPosts();

    if (location.hash === "#create") {
      go("create");
    } else if (location.hash === "#posts") {
      go("posts");
    } else {
      go("dashboard");
    }
  } catch (error) {
    console.error("Admin initialization error:", error);

    if (error.status === 401) {
      redirectToLogin();
      return;
    }

    // Network/server error par automatic redirect loop se bachein.
    const message = $("formMessage");
    if (message) {
      message.textContent =
        "Backend se connection/session check fail hua. F12 Console aur Network tab check karein.";
      message.style.color = "#b42318";
    }
  }
}

if ($("postForm")) {
  $("postForm").addEventListener("submit", submitPost);
}

initAdmin();
